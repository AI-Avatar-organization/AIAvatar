/**
 * Speech gateway in the web app (ADR 0009): normalizes audio with ffmpeg, owns the slots, and forwards to the
 * STT Service of the requested language. It never starts Python itself and never queues.
 *
 * Slot contract: a language has as many slots as its STT Service has workers. The browser reserves one when the
 * mic is pressed (answer: a token, or "busy" at once). A reserved slot expires by itself after the longest
 * recording plus transcription. Audio sent with a valid token uses that slot; without one (or expired) it still
 * goes through when a slot is free, otherwise "busy, use fallback".
 *
 * Configuration (env): STT_SERVICE_TH / STT_SERVICE_EN (default http://127.0.0.1:3401 / :3402) · SLOT_TTL_MS (30000)
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
export const LANGUAGES = ['th', 'en'];
const CAPACITY_TTL_MS = 5_000; // how long a service's worker count is trusted before asking /health again

/** ffmpeg arguments that turn any uploaded audio into the 16 kHz mono 16-bit WAV the workers expect (also used by the benchmark). */
export const ffmpegArgs = (input, output) => ['-nostdin', '-v', 'error', '-y', '-i', input, '-t', '31', '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', output];

export const busyError = language => Object.assign(
  new Error(language === 'en' ? 'Speech service is busy; use the browser’s speech recognition instead.' : 'ระบบถอดเสียงไม่ว่าง ใช้การถอดเสียงของเบราว์เซอร์แทน'),
  { status: 503, busy: true });
const unavailableError = language => Object.assign(
  new Error(language === 'en' ? 'Voice commands are unavailable right now. Please type your command.' : 'ใช้คำสั่งเสียงไม่ได้ตอนนี้ กรุณาพิมพ์คำสั่งแทน'),
  { status: 503, unavailable: true });
const checkLanguage = language => {
  if (!LANGUAGES.includes(language)) throw Object.assign(new Error('language must be th or en'), { status: 400 });
};

export function createSpeechGateway({
  services = { th: process.env.STT_SERVICE_TH ?? 'http://127.0.0.1:3401', en: process.env.STT_SERVICE_EN ?? 'http://127.0.0.1:3402' },
  slotTtlMs = Number(process.env.SLOT_TTL_MS ?? 30_000),
  now = () => Date.now()
} = {}) {
  const lanes = Object.fromEntries(LANGUAGES.map(language => [language, { capacity: 0, checkedAt: -Infinity, reserved: new Map(), inUse: 0, health: null }]));

  async function capacity(language) {
    const lane = lanes[language];
    if (now() - lane.checkedAt < CAPACITY_TTL_MS) return lane.capacity;
    try {
      const response = await fetch(`${services[language]}/health`, { signal: AbortSignal.timeout(2_000) });
      const health = await response.json();
      lane.capacity = health.ok ? health.ready : 0;
      lane.health = health;
    } catch {
      lane.capacity = 0;
      lane.health = null;
    }
    lane.checkedAt = now();
    return lane.capacity;
  }

  const purge = lane => { for (const [token, expiresAt] of lane.reserved) if (expiresAt <= now()) lane.reserved.delete(token); };
  const free = (lane, total) => total - lane.reserved.size - lane.inUse;

  /** Reserve a slot for a Voice Command about to be spoken. Never waits. */
  async function reserve(language) {
    checkLanguage(language);
    const lane = lanes[language];
    const total = await capacity(language);
    if (total === 0) throw unavailableError(language);
    purge(lane);
    if (free(lane, total) <= 0) throw busyError(language);
    const token = randomUUID();
    lane.reserved.set(token, now() + slotTtlMs);
    return { token, expiresInMs: slotTtlMs, language };
  }

  /** Take a slot for this request: the caller's reservation, or a free one. Returns a release function. */
  async function claim(language, token) {
    const lane = lanes[language];
    purge(lane);
    if (token && lane.reserved.delete(token)) {
      lane.inUse += 1;
      return { release: () => { lane.inUse -= 1; }, path: 'slot' };
    }
    const total = await capacity(language);
    if (total === 0) throw unavailableError(language);
    if (free(lane, total) <= 0) throw busyError(language);
    lane.inUse += 1;
    return { release: () => { lane.inUse -= 1; }, path: token ? 'expired-slot' : 'no-slot' };
  }

  /** Transcribe uploaded audio. language: 'th' | 'en' (the UI language; auto-detect misreads short Thai clips). */
  async function transcribe(audio, { language = 'th', prompt = '', token = '' } = {}) {
    checkLanguage(language);
    const { release, path } = await claim(language, token);
    let directory;
    try {
      directory = await mkdtemp(join(tmpdir(), 'avatar3d-stt-'));
      const input = join(directory, 'capture');
      const wav = join(directory, 'audio.wav');
      await writeFile(input, audio, { mode: 0o600 });
      const converting = performance.now();
      await execute('ffmpeg', ffmpegArgs(input, wav), { timeout: 20_000 });
      const ffmpegMs = Math.round(performance.now() - converting);
      // Priming measured 2026-11-10 (ADR 0007): an English Gesture word list helps whisper-small.en, but ANY prompt
      // makes the Thai distil model loop ("ส ส ส …"), so Thai is never primed.
      const query = language === 'en' && prompt ? `?prompt=${encodeURIComponent(String(prompt).slice(0, 300))}` : '';
      const sent = performance.now();
      let response;
      try {
        response = await fetch(`${services[language]}/transcribe${query}`, { method: 'POST', body: await readFile(wav), signal: AbortSignal.timeout(90_000) });
      } catch {
        lanes[language].checkedAt = -Infinity; // ask /health again next time
        throw unavailableError(language);
      }
      const body = await response.json();
      if (response.status === 503 && body.busy) throw busyError(language);
      if (!response.ok) throw Object.assign(new Error(body.error ?? 'ถอดเสียงไม่สำเร็จ'), { status: 502 });
      const roundTrip = performance.now() - sent;
      const { transcribeMs, modelLoadMs, ...rest } = body;
      return {
        ...rest, transcribedBy: 'server', slot: path,
        // waitMs = time with the STT Service that was not transcription (hand-off overhead; workers never queue)
        timings: { ffmpegMs, workerStartMs: 0, waitMs: Math.max(0, Math.round(roundTrip - transcribeMs - modelLoadMs)), modelLoadMs, transcribeMs }
      };
    } catch (error) {
      if (error.status) throw error;
      throw Object.assign(new Error('ถอดเสียงไม่สำเร็จ: ' + (error.stderr?.toString().split('\n').filter(Boolean).pop() ?? error.message)), { status: 502 });
    } finally {
      release();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  /** Give a reservation back early (mic failed, recording too short, page closed). Unknown tokens are ignored. */
  function release(language, token) {
    checkLanguage(language);
    return { released: lanes[language].reserved.delete(token) };
  }

  /** Slots per language right now (for the benchmark and operators). */
  async function status() {
    return Object.fromEntries(await Promise.all(LANGUAGES.map(async language => {
      const lane = lanes[language];
      const total = await capacity(language);
      purge(lane);
      const { model = null, device = null, loadMs = [] } = lane.health ?? {};
      return [language, { slots: total, reserved: lane.reserved.size, inUse: lane.inUse, free: Math.max(0, free(lane, total)), model, device, loadMs }];
    })));
  }

  return { reserve, release, transcribe, status };
}
