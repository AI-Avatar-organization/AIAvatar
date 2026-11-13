import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, saveMap } from './maps.mjs';
import { loadGestures, upsertGesture, saveClip, patchGesture, deleteGesture } from './gestures.mjs';
import { createSpeechGateway } from './stt.mjs';
import { withPrebuiltNavigation } from './navigation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mapsDir = process.env.MAPS_DIR ?? join(root, 'maps');
const gesturesDir = process.env.GESTURES_DIR ?? join(root, 'gestures');
const navigationDir = join(root, 'navigation');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };

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
      const revalidate = ['.html', '.css', '.js', '.mjs', '.json'].includes(extension);
      const etag = 'W/"' + info.size.toString(16) + '-' + Math.trunc(info.mtimeMs).toString(16) + '"';
      const headers = {
        'Content-Type': types[extension] ?? 'application/octet-stream',
        'ETag': etag,
        'Cache-Control': revalidate ? 'no-cache'
          : pathname.startsWith('/navigation/') ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate'
      };
      const candidates = String(request.headers['if-none-match'] ?? '').split(',').map(value => value.trim());
      if (candidates.some(value => value === '*' || value.replace(/^W\//, '') === etag.replace(/^W\//, ''))) {
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

export function createApp({ speech = createSpeechGateway() } = {}) {
  return createServer(async (request, response) => {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    // manual-ntserver02: public deployment write guard
    if (process.env.AUTHOR_ENABLED === 'false' && (
      (request.method === 'PUT' && pathname.startsWith('/api/maps/')) ||
      (['POST', 'PATCH', 'DELETE'].includes(request.method) &&
        (pathname === '/api/gestures' || pathname.startsWith('/api/gestures/')))
    )) return json(response, 403, { error: 'Author API is disabled on this public deployment' });
    try {
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
      if (mapMatch && request.method === 'PUT') {
        const body = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
        return json(response, 200, await saveMap(mapsDir, mapMatch[1], body));
      }
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
  createApp().listen(port, host, () => console.log(`AI Avatar 3D → http://${host}:${port}`));
}
