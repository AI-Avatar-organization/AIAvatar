/**
 * How an answer is cut for the Guide's voice (ADR 0012). Shared by the browser (GuideVoice) and
 * scripts/voice-prebake.mjs, so a prebaked sentence is exactly the one the page later asks for and hits the cache.
 */

const words = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

/**
 * Where to cut `text` so the first part is at most `limit` characters: the last space if it leaves at least `min`
 * characters, else the last Thai/English word boundary (Thai is often written without spaces), else `limit`.
 */
export function cutAt(text, limit, min = Math.floor(limit / 2)) {
  if (text.length <= limit) return text.length;
  const space = text.lastIndexOf(' ', limit);
  if (space >= min) return space;
  if (words) {
    let best = 0;
    for (const { index } of words.segment(text)) { if (index > limit) break; best = index; }
    if (best >= Math.min(min, 8)) return best;
  }
  return limit;
}

/** Split an answer into short spoken sentences (Thai uses spaces between sentences, English uses punctuation). */
export function sentences(text, max = 160) {
  const parts = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?。])\s+|(?<=ครับ|ค่ะ|คะ)\s+/u).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (part.length <= max) { out.push(part); continue; }
    let rest = part;
    while (rest.length > max) {
      const at = cutAt(rest, max);
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * Pieces to synthesise, in order. The first is short (≤ firstMax) so the Guide starts talking a few seconds after the
 * answer arrives; the rest are joined up to `max` characters, because every F5 call also re-reads the 5-second
 * reference clip and fewer, longer calls keep generation close to playback speed (no gaps between pieces).
 */
export function speechChunks(text, { firstMax = 40, max = 100 } = {}) {
  const parts = sentences(text, max);
  if (!parts.length) return [];
  const out = [];
  let first = parts.shift();
  if (first.length > firstMax) {
    const cut = cutAt(first, firstMax, 8);
    parts.unshift(first.slice(cut).trim());
    first = first.slice(0, cut).trim();
  }
  out.push(first);
  let current = '';
  for (const part of parts) {
    if (current && current.length + 1 + part.length > max) { out.push(current); current = part; }
    else current = current ? `${current} ${part}` : part;
  }
  if (current && out.length > 1 && current.length < 15) out[out.length - 1] += ` ${current}`; // no lone "ครับ"
  else if (current) out.push(current);
  return out;
}
