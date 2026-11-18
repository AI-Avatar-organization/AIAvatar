/**
 * Voice adapter (ADR 0005, ADR 0012): the Guide speaks with the active Voice Profile (server/voice-profiles.mjs),
 * synthesised by F5-TTS-THAI through a persistent worker (scripts/tts-worker.py) that loads the model once.
 * Everything lives in this project: .runtime/voice (installed by `npm run setup:voice`) and data/voice-profiles.
 *
 * Environment overrides: F5_PYTHON, F5_MODEL_DIR, F5_VOCODER_DIR, F5_EN_MODEL_DIR (separate English checkpoint),
 * F5_HF_HOME, VOICE_PROFILE_DIR, TTS_NFE (flow steps, default 16), TTS_CACHE_DIR (default data/tts-cache).
 *
 * Speed: nfe_step 16 is twice as fast as F5's default 32 and, on our Thai test sentences, Whisper transcribes both
 * identically (12 starts to drop tones, 8 breaks). Every sentence is also kept on disk per Voice Profile, so a
 * sentence the Guide has said before (preset answers, Narration) comes back at once without the worker.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createProfileStore } from '../voice-profiles.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const voiceRuntime = join(root, '.runtime', 'voice');

export const defaults = {
  python: process.env.F5_PYTHON ?? join(voiceRuntime, 'venv', 'bin', 'python'),
  modelDir: process.env.F5_MODEL_DIR ?? join(voiceRuntime, 'models', 'f5-tts-thai-v1'),
  vocoderDir: process.env.F5_VOCODER_DIR ?? join(voiceRuntime, 'vocoders', 'vocos-mel-24khz'),
  englishModelDir: process.env.F5_EN_MODEL_DIR ?? '',
  hfHome: process.env.F5_HF_HOME ?? join(voiceRuntime, 'hf-cache'),
  nfe: Number(process.env.TTS_NFE ?? 16),
  cacheDir: process.env.TTS_CACHE_DIR ?? join(root, 'data', 'tts-cache')
};

const MAX_TEXT = 400;
const MAX_QUEUE = 20; // sentences waiting for the one F5 worker; beyond this answers stay captions-only
const fail = (message, status = 503) => Object.assign(new Error(message), { status, unavailable: status === 503 });

export function createVoice(options = {}) {
  const settings = { ...defaults, ...options };
  const profiles = options.profiles ?? createProfileStore();
  let worker = null;          // { proc, ready: Promise, pending: Map }
  let chain = Promise.resolve();
  let lastError = null;
  let queued = 0;

  function start() {
    const env = { ...process.env, F5_MODEL_DIR: settings.modelDir, F5_VOCODER_DIR: settings.vocoderDir,
      HF_HOME: settings.hfHome, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUNBUFFERED: '1',
      ...(settings.englishModelDir ? { F5_EN_MODEL_DIR: settings.englishModelDir } : {}) };
    const proc = spawn(settings.python, [join(root, 'scripts', 'tts-worker.py')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map();
    let buffer = '';
    let stderr = '';
    let markReady, markFailed;
    const ready = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
    ready.catch(() => {});
    proc.stdout.on('data', data => {
      buffer += data;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.ready) { markReady(message); continue; }
        const job = pending.get(message.id);
        if (!job) continue;
        pending.delete(message.id);
        if (message.error) job.reject(fail(`สร้างเสียงไม่สำเร็จ: ${message.error}`, 502));
        else job.resolve({ wav: Buffer.from(message.wav, 'base64'), ms: message.ms });
      }
    });
    proc.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
    const onExit = error => {
      lastError = error?.message ?? `worker exited (${stderr.trim().split('\n').at(-1) ?? 'no output'})`;
      const failure = fail(`ระบบเสียงหยุดทำงาน: ${lastError}`);
      markFailed(failure);
      for (const job of pending.values()) job.reject(failure);
      pending.clear();
      if (worker?.proc === proc) worker = null;
    };
    proc.on('error', onExit);
    proc.on('exit', () => onExit());
    return { proc, ready, pending };
  }

  async function ensureWorker() {
    try { await access(settings.python); } catch { throw fail('ยังไม่ได้ติดตั้งระบบเสียง — รัน npm run setup:voice'); }
    worker ??= start();
    return worker;
  }

  return {
    /** WAV (24 kHz mono) of text spoken with the Voice Profile. Requests run one at a time. */
    async speak(text, { lang = 'th', profileId = null } = {}) {
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!clean) throw fail('ไม่มีข้อความให้พูด', 400);
      if (clean.length > MAX_TEXT) throw fail(`ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร ให้แบ่งเป็นประโยค`, 400);
      if (queued >= MAX_QUEUE) throw fail('ระบบเสียงคิวเต็ม แสดงเป็นคำบรรยายแทน', 503);
      const profile = profileId ? await profiles.get(profileId) : await profiles.active();
      const voiceLang = lang === 'en' ? 'en' : 'th';
      const cacheFile = settings.cacheDir && join(settings.cacheDir, profile.id,
        `${createHash('sha256').update(`${voiceLang}|${settings.nfe}|${clean}`).digest('hex').slice(0, 32)}.wav`);
      if (cacheFile) {
        try { return { wav: await readFile(cacheFile), ms: 0, cached: true }; } catch { /* not said yet */ }
      }
      queued += 1;
      const run = chain.then(async () => {
        const { proc, ready, pending } = await ensureWorker();
        await ready;
        const id = randomUUID();
        const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        proc.stdin.write(JSON.stringify({ id, ref_audio: profile.audioPath, ref_text: profile.transcript, gen_text: clean,
          lang: voiceLang, nfe: settings.nfe }) + '\n');
        const spoken = await result;
        if (cacheFile) {
          const temp = `${cacheFile}.${id}.tmp`;
          await mkdir(join(settings.cacheDir, profile.id), { recursive: true })
            .then(() => writeFile(temp, spoken.wav)).then(() => rename(temp, cacheFile)).catch(() => {});
        }
        return spoken;
      });
      chain = run.catch(() => {});
      run.finally(() => { queued -= 1; }).catch(() => {});
      return run;
    },
    /** Delete every cached sentence of a Voice Profile (called when the profile is deleted: it is that person's voice). */
    async forget(profileId) {
      if (settings.cacheDir && /^[\w-]+$/.test(profileId)) await rm(join(settings.cacheDir, profileId), { recursive: true, force: true });
    },
    /** Start loading the model in the background so the first answer does not wait for it. */
    // …and say one word: the first generation after a load is ~3 s slower (GPU kernels), so a Visitor never pays it.
    warm() {
      ensureWorker().then(() => this.speak('สวัสดีครับ')).catch(error => { if (!error.unavailable) lastError = error.message; });
    },
    async status() {
      let profile = null;
      try { await access(settings.python); } catch { return { available: false, reason: 'ยังไม่ได้ติดตั้งระบบเสียง — รัน npm run setup:voice' }; }
      try { const p = await profiles.active(); profile = { id: p.id }; }
      catch (error) { return { available: false, reason: error.message }; }
      return { available: true, profile, worker: worker ? 'running' : 'stopped', englishModel: settings.englishModelDir ? 'separate' : 'thai', lastError };
    },
    stop() { worker?.proc.kill(); worker = null; }
  };
}
