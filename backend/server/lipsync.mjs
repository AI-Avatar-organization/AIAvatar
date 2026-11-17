/**
 * Lip-sync (copied from AI Study Companion Avatar speech.mjs, ADR 0005): Rhubarb analyses the same audio the
 * browser will play and returns mouth cues { start, end, value: A–F | X } on that audio's clock.
 * Any uploaded audio is normalised to 16 kHz mono WAV with ffmpeg first. Timings feed the Execution Time Benchmark.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
/** Rhubarb 1.14.0 release folder for the host OS: macOS on the dev Mac, Linux on the deploy servers. */
export const defaultRhubarbPath = (platform = process.platform) => fileURLToPath(new URL(
  `../.runtime/rhubarb/Rhubarb-Lip-Sync-1.14.0-${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'}/rhubarb`, import.meta.url));
/** Same 16 kHz mono WAV as STT, but without STT's 31 s cap: a long reply or Replay recording needs cues to the end. */
export const lipSyncFfmpegArgs = (input, output) => ['-nostdin', '-v', 'error', '-y', '-i', input, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', output];
const SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X']);

export const validCues = cues => Array.isArray(cues) && cues.length > 0 && cues.every(cue =>
  Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start && SHAPES.has(cue.value));

export function createLipSync({ rhubarb = process.env.RHUBARB_PATH ?? defaultRhubarbPath(), ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg', timeoutMs = 30_000 } = {}) {
  return {
    /** → { mouthCues, durationSeconds, timings: { ffmpegMs, rhubarbMs } } or { mouthCues: [], warning } when analysis fails. */
    async analyse(audio) {
      const directory = await mkdtemp(join(tmpdir(), 'avatar-lipsync-'));
      try {
        const input = join(directory, 'input'), wav = join(directory, 'speech.wav');
        await writeFile(input, audio);
        const t0 = performance.now();
        try {
          await execute(ffmpeg, lipSyncFfmpegArgs(input, wav), { timeout: timeoutMs });
        } catch {
          return { mouthCues: [], warning: 'แปลงไฟล์เสียงไม่ได้ รอบนี้ใช้ปากเป็นกลาง', timings: { ffmpegMs: Math.round(performance.now() - t0) } };
        }
        const t1 = performance.now();
        try {
          const { stdout } = await execute(rhubarb, ['-r', 'phonetic', '--extendedShapes', 'X', '-f', 'json', '-q', wav],
            { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
          const result = JSON.parse(stdout);
          const timings = { ffmpegMs: Math.round(t1 - t0), rhubarbMs: Math.round(performance.now() - t1) };
          if (!validCues(result.mouthCues)) return { mouthCues: [], warning: 'Rhubarb ไม่พบเสียงพูด ปากจะอยู่นิ่ง', timings };
          return { mouthCues: result.mouthCues, durationSeconds: result.metadata?.duration ?? null, timings };
        } catch {
          return { mouthCues: [], warning: 'Rhubarb วิเคราะห์ไม่ได้ รอบนี้ใช้ปากเป็นกลาง', timings: { ffmpegMs: Math.round(t1 - t0) } };
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
}
