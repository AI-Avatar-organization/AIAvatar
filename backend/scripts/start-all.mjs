#!/usr/bin/env node
/**
 * Start the three units on one machine: Thai STT Service, English STT Service and the web app (`npm run start:all`).
 * The web app keeps serving the 3D world and typed commands if an STT Service stops; Ctrl-C stops everything.
 *
 * env: PORT (web app, 3300) · HOST · STT_WORKERS_TH (default 3) · STT_WORKERS_EN (default 2)
 *      STT_PORT_TH (3401) · STT_PORT_EN (3402) · STT_ONLY=th|en (start just that STT Service, e.g. in its own container)
 *      STT_LISTEN (address the STT Services listen on, 127.0.0.1) · STT_HOST (where the web app finds them, 127.0.0.1)
 *      plus everything server/stt-service.mjs and server/index.mjs read (STT_MODEL_*, STT_QUANTIZE, STT_DEVICE, WHISPER_PYTHON …)
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORTS } from '../server/stt-service.mjs';

const serviceScript = fileURLToPath(new URL('../server/stt-service.mjs', import.meta.url));
const webScript = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
const env = process.env;
const ports = { th: Number(env.STT_PORT_TH ?? DEFAULT_PORTS.th), en: Number(env.STT_PORT_EN ?? DEFAULT_PORTS.en) };
const workers = { th: env.STT_WORKERS_TH ?? '3', en: env.STT_WORKERS_EN ?? '2' };
const sttHost = env.STT_HOST ?? '127.0.0.1';
const children = [];

function run(name, script, extraEnv) {
  const child = spawn(process.execPath, [script], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = line => line && process.stdout.write(`[${name}] ${line}\n`);
  createInterface({ input: child.stdout }).on('line', prefix);
  createInterface({ input: child.stderr }).on('line', prefix);
  child.on('exit', code => {
    prefix(`exited (${code})`);
    child.exited = true;
    // Without the web app there is nothing to serve; with STT_ONLY the service is all there is.
    // Exiting lets a supervisor (Docker restart policy) start us again.
    if (!stopping && (name === 'web' || children.every(c => c.exited))) stop(code || 1);
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

const only = env.STT_ONLY;
for (const language of only ? [only] : ['th', 'en']) {
  run(`stt-${language}`, serviceScript, { STT_LANG: language, STT_WORKERS: workers[language], STT_PORT: String(ports[language]), HOST: env.STT_LISTEN ?? '127.0.0.1' });
}
if (!only) {
  run('web', webScript, {
    STT_SERVICE_TH: env.STT_SERVICE_TH ?? `http://${sttHost}:${ports.th}`,
    STT_SERVICE_EN: env.STT_SERVICE_EN ?? `http://${sttHost}:${ports.en}`
  });
}
