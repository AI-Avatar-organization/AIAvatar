/**
 * Mouth cues for the Guide's spoken sentences (ADR 0005 Lip-sync, ADR 0012 voice).
 *
 * POST /api/tts answers with the sentence audio at once and starts Rhubarb on that same audio in the background;
 * the page fetches the cues by the audio's content key and switches the mouth from loudness to phonemes as soon as
 * they arrive. Successful analyses are kept as <dir>/<key>.json, so a sentence said again (prebaked presets,
 * Narration) has its cues immediately. A failed analysis is not kept: installing Rhubarb later fixes it.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const KEY = /^[0-9a-f]{32}$/;
const MAX_PENDING = 64; // analyses kept in memory while their sentence may still be playing

export function createSpeechCues({ lipSync, dir }) {
  const pending = new Map(); // key → Promise<{ mouthCues, warning? }>

  const fileOf = key => join(dir, `${key}.json`);

  async function analyse(key, wav) {
    try {
      const saved = JSON.parse(await readFile(fileOf(key), 'utf8'));
      if (Array.isArray(saved.mouthCues)) return saved;
    } catch { /* not analysed yet */ }
    const result = await lipSync.analyse(wav);
    const cues = { mouthCues: result.mouthCues ?? [], ...(result.warning ? { warning: result.warning } : {}) };
    if (cues.mouthCues.length) {
      const temp = `${fileOf(key)}.${process.pid}.tmp`;
      await mkdir(dir, { recursive: true }).then(() => writeFile(temp, JSON.stringify({ mouthCues: cues.mouthCues })))
        .then(() => rename(temp, fileOf(key))).catch(() => {});
    }
    return cues;
  }

  return {
    /** Start (or reuse) the analysis of this audio; returns its key for GET /api/tts/cues/:key. */
    start(wav) {
      const key = createHash('sha256').update(wav).digest('hex').slice(0, 32);
      if (!pending.has(key)) {
        if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
        pending.set(key, analyse(key, wav).catch(() => ({ mouthCues: [] })));
      }
      return key;
    },
    /** { mouthCues, warning? } for a key, waiting for a running analysis; null when the key is unknown. */
    async get(key) {
      if (!KEY.test(String(key))) return null;
      if (pending.has(key)) return pending.get(key);
      try {
        const saved = JSON.parse(await readFile(fileOf(key), 'utf8'));
        return Array.isArray(saved.mouthCues) ? saved : null;
      } catch { return null; }
    }
  };
}
