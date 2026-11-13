/**
 * STT Service: one language, a fixed number of workers, never a queue (ADR 0009).
 *
 * Each worker is a Python process (scripts/stt_worker.py) that loads the language's model once at start and
 * transcribes one job at a time. A request that finds no idle worker is answered "busy" at once.
 *
 * HTTP (localhost; the web app's speech gateway is the only client):
 *   GET  /health                     → { ok, language, model, device, workers, ready, busy, loadMs[] }
 *   POST /transcribe?prompt=…        body: 16 kHz mono 16-bit WAV
 *        200 { text, language, provider, transcribeMs, modelLoadMs }   503 { busy: true }   502 { error }
 *
 * Configuration (env): STT_LANG (th|en, required) · STT_WORKERS (default 1) · STT_PORT (th 3401, en 3402) · HOST (127.0.0.1)
 *   STT_MODEL_TH / STT_MODEL_EN · STT_QUANTIZE=int8 · STT_DEVICE=cpu · WHISPER_PYTHON (python with torch + transformers)
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const workerScript = fileURLToPath(new URL('../scripts/stt_worker.py', import.meta.url));
// Chosen in ADR 0009's appendix (2026-11-13): smaller models that pass the accuracy floor, float32 (MPS on a Mac).
export const DEFAULT_MODELS = { th: 'biodatlab/whisper-th-small-combined', en: 'openai/whisper-base.en' };
export const DEFAULT_PORTS = { th: 3401, en: 3402 };
const JOB_TIMEOUT_MS = 60_000;
const RESTART_DELAY_MS = 2_000; // doubles after each quick failure, up to 60 s
const MAX_BODY_BYTES = 4 * 1024 * 1024; // 31 s of 16 kHz 16-bit audio is ~1 MB

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

/** One Python worker process: loads the model at start, then one job at a time. Restarts itself if it dies. */
class Worker {
  constructor({ language, python, env, onLog }) {
    Object.assign(this, { language, python, env, onLog, busy: false, ready: false, stopped: false, loadMs: null, job: null, restartDelay: RESTART_DELAY_MS });
    this.start();
  }

  start() {
    const started = performance.now();
    this.child = spawn(this.python, [workerScript, this.language], { env: { ...this.env, STT_PRELOAD: this.language }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', error => this.onLog(`STT worker ${this.language}: ${error.message}`)); // e.g. WHISPER_PYTHON not found; 'exit' follows
    this.child.stdin.on('error', () => {}); // EPIPE when the worker dies mid-write; 'exit' handles the job
    let stderr = '';
    this.child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.ready) {
        Object.assign(this, { ready: true, device: message.device, loadMs: Math.round(performance.now() - started), restartDelay: RESTART_DELAY_MS });
        return;
      }
      const job = this.job;
      if (!job || message.id !== job.id) return;
      this.job = null;
      clearTimeout(job.timer);
      if (message.error) job.reject(new Error(message.error));
      else job.resolve(message);
    });
    this.child.on('exit', code => {
      this.ready = false;
      const error = new Error(`STT worker stopped (${code}): ${stderr.split('\n').filter(Boolean).pop() ?? ''}`);
      if (this.job) { clearTimeout(this.job.timer); this.job.reject(error); this.job = null; }
      this.busy = false;
      if (this.stopped) return;
      this.onLog(`${error.message} — restarting in ${this.restartDelay / 1000} s`);
      setTimeout(() => this.stopped || this.start(), this.restartDelay);
      this.restartDelay = Math.min(60_000, this.restartDelay * 2);
    });
  }

  run(path, prompt) {
    this.busy = true;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.job = null; this.ready = false; reject(new Error('ถอดเสียงนานเกินกำหนด')); this.child.kill(); }, JOB_TIMEOUT_MS);
      this.job = { id, resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ id, path, language: this.language, prompt }) + '\n');
    }).finally(() => { this.busy = false; });
  }

  stop() { this.stopped = true; this.child.kill(); }
}

export function createSttService({ language, workers = 1, python = process.env.WHISPER_PYTHON ?? 'python3', env = process.env, onLog = console.warn } = {}) {
  if (!DEFAULT_MODELS[language]) throw new Error('STT_LANG must be th or en');
  const modelKey = language === 'th' ? 'STT_MODEL_TH' : 'STT_MODEL_EN';
  const model = env[modelKey] ?? DEFAULT_MODELS[language];
  const pool = Array.from({ length: workers }, () => new Worker({ language, python, env: { ...env, [modelKey]: model }, onLog }));

  const health = () => ({
    ok: pool.some(w => w.ready), language, model, device: pool.find(w => w.device)?.device ?? null,
    workers: pool.length, ready: pool.filter(w => w.ready).length, busy: pool.filter(w => w.busy).length,
    loadMs: pool.map(w => w.loadMs)
  });

  async function transcribe(wav, prompt) {
    const worker = pool.find(w => w.ready && !w.busy);
    if (!worker) return null; // busy: never queue
    worker.busy = true; // claim before the first await so a simultaneous request cannot take the same worker
    const directory = await mkdtemp(join(tmpdir(), `avatar3d-stt-${language}-`));
    try {
      const path = join(directory, 'audio.wav');
      await writeFile(path, wav, { mode: 0o600 });
      const result = await worker.run(path, prompt);
      return {
        text: result.text, language: result.language, provider: result.provider, transcribeMs: Number(result.durationMs) || 0, modelLoadMs: Number(result.loadMs) || 0,
        ...(result.deviceMemoryBytes ? { deviceMemoryBytes: result.deviceMemoryBytes } : {}) // only with STT_REPORT_DEVICE_MEMORY=1 (benchmark)
      };
    } finally {
      worker.busy = false;
      await rm(directory, { recursive: true, force: true });
    }
  }

  const server = createServer(async (request, response) => {
    const { pathname, searchParams } = new URL(request.url, 'http://localhost');
    try {
      if (pathname === '/health' && request.method === 'GET') {
        const body = health();
        return json(response, body.ok ? 200 : 503, body);
      }
      if (pathname === '/transcribe' && request.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          if ((size += chunk.length) > MAX_BODY_BYTES) return json(response, 413, { error: 'audio too large' });
          chunks.push(chunk);
        }
        const result = await transcribe(Buffer.concat(chunks), (searchParams.get('prompt') ?? '').slice(0, 300));
        return result ? json(response, 200, result) : json(response, 503, { busy: true });
      }
      json(response, 404, { error: 'not found' });
    } catch (error) {
      json(response, 502, { error: 'ถอดเสียงไม่สำเร็จ: ' + error.message });
    }
  });

  return { server, health, stop: () => { pool.forEach(w => w.stop()); server.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const language = process.env.STT_LANG;
  const service = createSttService({ language, workers: Math.max(1, Number(process.env.STT_WORKERS ?? 1)) });
  const port = Number(process.env.STT_PORT ?? DEFAULT_PORTS[language]);
  const host = process.env.HOST ?? '127.0.0.1';
  service.server.listen(port, host, () => console.log(`STT Service ${language} → http://${host}:${port} (${service.health().workers} workers, loading)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { service.stop(); process.exit(0); });
}
