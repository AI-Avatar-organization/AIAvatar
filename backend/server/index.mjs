import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { loadRegistry, saveMap } from './maps.mjs';
import { loadGestures, upsertGesture, saveClip, patchGesture, deleteGesture } from './gestures.mjs';
import { createSpeechGateway } from './stt.mjs';
import { createKnowledgeStore } from './knowledge.mjs';
import { streamGuide } from './ask.mjs';
import { createRouter } from './router.mjs';
import { createChat } from './companion/chat.mjs';
import { createVoice } from './companion/tts.mjs';
import { createRecordingStore } from './recordings.mjs';
import { createProfileStore } from './voice-profiles.mjs';
import { createLipSync } from './lipsync.mjs';
import { createSpeechCues } from './speech-cues.mjs';
import { withPrebuiltNavigation } from './navigation.mjs';
import { createMangosAuth } from './auth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mapsDir = process.env.MAPS_DIR ?? join(root, 'maps');
const gesturesDir = process.env.GESTURES_DIR ?? join(root, 'gestures');
const recordingsDir = process.env.RECORDINGS_DIR ?? join(root, 'recordings');
const navigationDir = join(root, 'navigation'); // compiled walking paths, written by scripts/build-navigation.mjs
// Rhubarb mouth cues of spoken Guide sentences, next to the sentence audio cache (shared by worktrees, npm run link:shared).
const speechCuesDir = process.env.SPEECH_CUES_DIR ?? join(process.env.TTS_CACHE_DIR ?? join(root, 'data', 'tts-cache'), 'cues');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.vrm': 'model/gltf-binary', '.wav': 'audio/wav' };

/** Static mounts: URL prefix → directory. Paths are confined to each directory. */
const mounts = [
  ['/navigation/', navigationDir],
  ['/vendor/three/', join(root, 'node_modules', 'three')],
  ['/vendor/recast/', join(root, 'node_modules', '@recast-navigation')],
  ['/shared/', join(root, 'shared')],
  ['/maps/', mapsDir],
  ['/assets/', join(root, 'assets')],
  ['/gestures/', gesturesDir],
  ['/', join(root, 'public')]
];

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

/**
 * Every file carries an ETag. Code and JSON are revalidated on each load (no-cache → 304 when unchanged); models too,
 * through public/asset-loader.js; compiled walking paths are named by content, so they never change.
 * /v/<release>/… is accepted as an alias of /… so a deployment can cache-bust URLs if it wants to.
 */
async function serveFile(request, response, pathname) {
  pathname = pathname.replace(/^\/v\/[a-zA-Z0-9][a-zA-Z0-9._-]*\//, '/');
  for (const [prefix, dir] of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    const relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const file = normalize(join(dir, relative));
    if (!file.startsWith(dir + sep) && file !== dir) return false;
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      const extension = extname(file);
      const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
      const headers = {
        'Content-Type': types[extension] ?? 'application/octet-stream',
        'ETag': etag,
        'Cache-Control': ['.html', '.css', '.js', '.mjs', '.json'].includes(extension) ? 'no-cache'
          : prefix === '/navigation/' ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate'
      };
      const strip = value => value.trim().replace(/^W\//, '');
      const candidates = String(request.headers['if-none-match'] ?? '').split(',').map(strip);
      if (candidates.some(value => value === '*' || value === strip(etag))) {
        response.writeHead(304, headers);
        response.end();
        return true;
      }
      response.writeHead(200, { ...headers, 'Content-Length': info.size });
      createReadStream(file).pipe(response);
      return true;
    } catch { /* try next mount */ }
  }
  return false;
}

async function readBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('ข้อมูลใหญ่เกินกำหนด'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Author-only requests: editing Maps and Gestures, deleting Recordings, and everything about Voice Profiles
 * (cloning a voice needs consent). Through Tailscale Funnel the app is public (ADR 0010), so these need either
 * the AUTHOR_TOKEN (header X-Author-Token) or, when no token is configured, a direct request to localhost.
 */
const AUTHOR_ROUTES = [
  ['PUT', /^\/api\/maps\/[a-z0-9-]+$/], ['POST', /^\/api\/gestures/], ['PATCH', /^\/api\/gestures\//], ['DELETE', /^\/api\/gestures\//],
  ['DELETE', /^\/api\/recordings\//], ['GET', /^\/api\/voice\/profiles/], ['POST', /^\/api\/voice\//], ['DELETE', /^\/api\/voice\//]
];
export function isAuthor(request, token = process.env.AUTHOR_TOKEN) {
  if (token) {
    const given = Buffer.from(String(request.headers['x-author-token'] ?? ''));
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  const host = String(request.headers.host ?? '').replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(host) && !request.headers['x-forwarded-for'];
}

const answerCache = new WeakMap(); // knowledge index → Map(question key → answer)

export function createApp({ speech = createSpeechGateway(), chat = createChat(), router = null, profiles = createProfileStore(), voice = createVoice({ profiles }), knowledge = createKnowledgeStore(mapsDir), recordings = createRecordingStore(recordingsDir), lipSync = createLipSync(), speechCues = createSpeechCues({ lipSync, dir: speechCuesDir }),
  auth = createMangosAuth(), authorEnabled = process.env.AUTHOR_ENABLED !== 'false' } = {}) {
  return createServer(async (request, response) => {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    try {
      const authorRoute = AUTHOR_ROUTES.some(([method, path]) => method === request.method && path.test(pathname));
      // A public deployment (ntserver02) switches Author requests off entirely with AUTHOR_ENABLED=false.
      if (authorRoute && !authorEnabled) return json(response, 403, { error: 'เว็บสาธารณะนี้ปิดการแก้ไขข้อมูล (AUTHOR_ENABLED=false)' });
      if (authorRoute && !isAuthor(request)) {
        return json(response, 403, { error: 'ต้องเป็น Author (ตั้ง AUTHOR_TOKEN แล้วเปิด ?author=1&token=…)' });
      }
      // Guest or Member (ADR 0016). 401 is the normal Guest answer; every answer says where to log in and out.
      if (pathname === '/api/auth/me' && request.method === 'GET') {
        const links = { enabled: auth.enabled, loginUrl: auth.loginUrl, logoutUrl: auth.logoutUrl };
        let member = null;
        let failure = null;
        try { member = await auth.memberFrom(request); } catch (error) { failure = error; }
        if (member) return json(response, 200, { mode: 'member', member, ...links });
        return json(response, failure ? failure.status ?? 503 : 401, { mode: 'guest', member: null, ...links, ...(failure ? { error: failure.message } : {}) });
      }
      if (pathname === '/api/maps' && request.method === 'GET') {
        const { maps, errors } = await loadRegistry(mapsDir);
        return json(response, 200, { maps: [...maps.values()].map(({ id, name, nameEn, description, descriptionEn, stations }) => ({ id, name, nameEn, description, descriptionEn, stationCount: stations.length })), errors });
      }
      const mapMatch = pathname.match(/^\/api\/maps\/([a-z0-9-]+)$/);
      if (mapMatch && request.method === 'GET') {
        const { maps } = await loadRegistry(mapsDir);
        const map = maps.get(mapMatch[1]);
        return map ? json(response, 200, await withPrebuiltNavigation(map, { mapsDir, assetsDir: join(root, 'assets'), navigationDir })) : json(response, 404, { error: `ไม่พบ Map "${mapMatch[1]}"` });
      }
      // Stations whose knowledge has a Source: only these get Prompt Presets (spec R5.1).
      const sourcesMatch = pathname.match(/^\/api\/maps\/([a-z0-9-]+)\/sources$/);
      if (sourcesMatch && request.method === 'GET') {
        const { maps } = await loadRegistry(mapsDir);
        const map = maps.get(sourcesMatch[1]);
        if (!map) return json(response, 404, { error: `ไม่พบ Map "${sourcesMatch[1]}"` });
        const index = await knowledge.index(map);
        return json(response, 200, { stations: index.sourcedStations, documents: index.files });
      }
      if (mapMatch && request.method === 'PUT') {
        const body = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
        return json(response, 200, await saveMap(mapsDir, mapMatch[1], body));
      }
      // The Guide answers a question from the Map's documents, in the context of the Current Station (ADR 0011).
      if (pathname === '/api/ask' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 16 * 1024)).toString('utf8'));
        const { maps } = await loadRegistry(mapsDir);
        const map = maps.get(body.mapId);
        if (!map) return json(response, 404, { error: `ไม่พบ Map "${body.mapId}"` });
        const index = await knowledge.index(map);
        const ask = { question: String(body.question ?? '').trim(), stationId: body.stationId ?? null, lang: body.lang === 'en' ? 'en' : 'th' };
        // Same question at the same Station over the same documents → same answer (temperature 0.2, fixed seed):
        // Prompt Presets are asked again and again, so they come back at once. A new index (documents edited) starts over.
        const cache = answerCache.get(index) ?? answerCache.set(index, new Map()).get(index);
        const key = `${map.id}|${ask.stationId}|${ask.lang}|${ask.question}`;
        // Spec R11.2: pages that accept NDJSON get the answer while it is written, one JSON object per line:
        // {type:"queued",position} · {type:"text",delta} · {type:"done",answer,stations,sources,...} · {type:"error",error}.
        const streaming = String(request.headers.accept ?? '').includes('application/x-ndjson');
        if (cache.has(key)) {
          const cached = { ...cache.get(key), cached: true };
          if (!streaming) return json(response, 200, cached);
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
          return response.end(`${JSON.stringify({ type: 'text', delta: cached.answer })}\n${JSON.stringify({ type: 'done', ...cached })}\n`);
        }
        const events = streamGuide({ map, index, chat, router, ...ask });
        let done = null;
        if (!streaming) {
          for await (const event of events) if (event.type === 'done') done = event;
        } else {
          // Headers wait for the first event, so an error before any answer (e.g. Ollama is down) is still a normal HTTP error.
          const first = await events.next();
          response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
          const send = event => { if (event.type === 'done') done = event; response.write(`${JSON.stringify(event)}\n`); };
          try {
            if (!first.done) send(first.value);
            for await (const event of events) send(event);
          } catch (error) {
            response.write(`${JSON.stringify({ type: 'error', error: error.message })}\n`);
          }
        }
        if (done) {
          const { type, ...answer } = done;
          if (cache.size >= 500) cache.delete(cache.keys().next().value);
          cache.set(key, answer);
          if (!streaming) return json(response, 200, answer);
        }
        return response.end();
      }
      // The Guide's voice: one sentence → WAV spoken with the Voice Profile (ADR 0012).
      if (pathname === '/api/tts' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 8 * 1024)).toString('utf8'));
        const { wav, ms } = await voice.speak(body.text, { lang: body.lang });
        // Lip-sync starts on this exact audio now; the page fetches the cues while the sentence already plays.
        const speechKey = speechCues.start(wav);
        response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store', 'X-TTS-Ms': String(ms), 'X-Speech-Key': speechKey });
        return response.end(wav);
      }
      const cuesMatch = pathname.match(/^\/api\/tts\/cues\/([0-9a-f]{32})$/);
      if (cuesMatch && request.method === 'GET') {
        const cues = await speechCues.get(cuesMatch[1]);
        return cues ? json(response, 200, cues) : json(response, 404, { error: 'ไม่พบเสียงประโยคนี้' });
      }
      // Voice Profiles of the Guide (spec R6.3; managed from Author mode): list, add with consent, preview, choose, delete.
      if (pathname === '/api/voice/profiles' && request.method === 'GET') return json(response, 200, { profiles: await profiles.list() });
      if (pathname === '/api/voice/profiles' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 12 * 1024 * 1024)).toString('utf8'));
        return json(response, 201, await profiles.create({ ...body, audio: body.audioBase64 ? Buffer.from(body.audioBase64, 'base64') : null }));
      }
      const profileMatch = pathname.match(/^\/api\/voice\/profiles\/([a-f0-9-]{8,40})(\/activate)?$/);
      if (profileMatch && request.method === 'POST' && profileMatch[2]) return json(response, 200, await profiles.activate(profileMatch[1]));
      if (profileMatch && request.method === 'DELETE' && !profileMatch[2]) {
        const removed = await profiles.remove(profileMatch[1]);
        await voice.forget?.(profileMatch[1]);
        return json(response, 200, removed);
      }
      if (pathname === '/api/voice/preview' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 8 * 1024)).toString('utf8'));
        const { wav, ms } = await voice.speak(body.text, { lang: body.lang, profileId: body.profileId ?? null });
        response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length, 'Cache-Control': 'no-store', 'X-TTS-Ms': String(ms) });
        return response.end(wav);
      }
      if (pathname === '/api/tts/status' && request.method === 'GET') return json(response, 200, await voice.status());
      // Recordings (spec R3.3, ADR 0004): save once, list per Map, read, stream the voice, delete. Never edited.
      if (pathname === '/api/recordings' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 48 * 1024 * 1024)).toString('utf8'));
        const { maps } = await loadRegistry(mapsDir);
        if (!maps.has(body.recording?.mapId)) return json(response, 404, { error: `ไม่พบ Map "${body.recording?.mapId}"` });
        const audio = body.audioBase64 ? Buffer.from(body.audioBase64, 'base64') : null;
        return json(response, 201, await recordings.save(body.recording, { audio, audioType: body.audioType ?? 'audio/webm' }));
      }
      if (pathname === '/api/recordings' && request.method === 'GET') return json(response, 200, { recordings: await recordings.list(searchParams.get('map')) });
      const recordingMatch = pathname.match(/^\/api\/recordings\/([a-f0-9]{12})(\/voice)?$/);
      if (recordingMatch && request.method === 'GET' && recordingMatch[2]) {
        const { path, type, size } = await recordings.audio(recordingMatch[1]);
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': size });
        return createReadStream(path).pipe(response);
      }
      if (recordingMatch && request.method === 'GET') return json(response, 200, await recordings.read(recordingMatch[1]));
      if (recordingMatch && request.method === 'DELETE' && !recordingMatch[2]) return json(response, 200, await recordings.remove(recordingMatch[1]));
      if (pathname === '/api/gestures' && request.method === 'GET') return json(response, 200, await loadGestures(gesturesDir));
      if (pathname === '/api/stt' && request.method === 'POST') {
        // timings = server side of End-to-End Latency: receive (upload), ffmpeg, wait for worker, transcribe, server total.
        const started = performance.now();
        const audio = await readBody(request, 8 * 1024 * 1024);
        const receiveMs = Math.round(performance.now() - started);
        if (!audio.length) return json(response, 400, { error: 'ไม่มีข้อมูลเสียง' });
        const result = await speech.transcribe(audio, { language: searchParams.get('lang') ?? 'th', prompt: searchParams.get('prompt') ?? '', token: searchParams.get('token') ?? '' });
        return json(response, 200, { ...result, timings: { receiveMs, ...result.timings, serverMs: Math.round(performance.now() - started) } });
      }
      // Lip-sync: audio → Rhubarb mouth cues on that audio's clock (Companion pipeline). timings for the benchmark.
      if (pathname === '/api/lipsync' && request.method === 'POST') {
        const started = performance.now();
        const audio = await readBody(request, 8 * 1024 * 1024);
        if (!audio.length) return json(response, 400, { error: 'ไม่มีข้อมูลเสียง' });
        const result = await lipSync.analyse(audio);
        return json(response, 200, { ...result, timings: { ...result.timings, serverMs: Math.round(performance.now() - started) } });
      }
      // Reserve a slot when the mic is pressed: { token, expiresInMs } or 503 { busy } at once (ADR 0009).
      if (pathname === '/api/stt/reserve' && request.method === 'POST') return json(response, 200, await speech.reserve(searchParams.get('lang') ?? 'th'));
      if (pathname === '/api/stt/release' && request.method === 'POST') return json(response, 200, speech.release(searchParams.get('lang') ?? 'th', searchParams.get('token') ?? ''));
      if (pathname === '/api/stt/status' && request.method === 'GET') return json(response, 200, await speech.status());
      // Kept for older pages: STT Service workers load their model at start, so there is nothing to warm up.
      if (pathname === '/api/stt/warmup' && request.method === 'POST') return json(response, 200, { language: searchParams.get('lang') ?? 'th', warmed: false });
      // POST /api/gestures/clip?id=<id>  — save a raw .glb file
      if (pathname === '/api/gestures/clip' && request.method === 'POST') {
        const id = searchParams.get('id');
        const buffer = await readBody(request, 20 * 1024 * 1024); // 20 MB limit
        const file = await saveClip(gesturesDir, id, buffer);
        return json(response, 200, { file });
      }
      // POST /api/gestures  — upsert gesture metadata into manifest.json
      if (pathname === '/api/gestures' && request.method === 'POST') {
        const body = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8'));
        const updated = await upsertGesture(gesturesDir, body);
        return json(response, 200, updated);
      }
      const gestureMatch = pathname.match(/^\/api\/gestures\/([a-z0-9][a-z0-9-]{1,63})$/);
      if (gestureMatch && request.method === 'PATCH') {
        const body = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8'));
        return json(response, 200, await patchGesture(gesturesDir, gestureMatch[1], body));
      }
      if (gestureMatch && request.method === 'DELETE') return json(response, 200, await deleteGesture(gesturesDir, gestureMatch[1]));
      if (pathname.startsWith('/api/')) return json(response, 404, { error: 'ไม่พบ API' });
      if (request.method === 'GET' && await serveFile(request, response, pathname)) return;
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      json(response, error.status ?? (error.field ? 400 : 500), { error: error.message, ...(error.busy ? { busy: true, fallback: 'browser' } : {}), ...(error.unavailable ? { unavailable: true } : {}) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3300);
  // HOST=0.0.0.0 inside Docker so the published port is reachable; local dev stays loopback-only.
  const host = process.env.HOST ?? '127.0.0.1';
  const profiles = createProfileStore();
  const voice = createVoice({ profiles });
  const chat = createChat();
  const router = createRouter(); // ROUTER_SMALL_MODEL=off: no small model, the big one answers everything
  createApp({ profiles, voice, chat, router }).listen(port, host, () => console.log(`AI Avatar 3D → http://${host}:${port}`));
  // Load the voice model in the background so the Guide's first sentence does not wait for it (TTS_WARM=0 to skip).
  if (process.env.TTS_WARM !== '0') { voice.warm(); chat.warm(); }
}
