// Copied unchanged from AI Study Companion Avatar public/mouth-cues.js (ADR 0005).
// Rhubarb A–F/X weights follow the playing audio clock.
// Natural smoothness comes from two techniques:
//   1. Ease-in-out cubic over the first BLEND_IN ms of each cue (jaw acceleration).
//   2. Look-ahead coarticulation: in the last BLEND_OUT ms of a cue, start blending
//      toward the next cue so the mouth "anticipates" the coming phoneme.
const BLEND_IN_S  = 0.08;   // 80 ms – how long to blend from previous shape
const BLEND_OUT_S = 0.04;   // 40 ms – how early to start anticipating next shape

function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

export function sampleMouthCues(cues, elapsed) {
  const index = cues.findIndex(cue => elapsed >= cue.start && elapsed < cue.end);

  // No active cue – rest pose.
  if (index === -1) return { shape: 'X', weights: { X: 1 } };

  const cue      = cues[index];
  if (cue.value === 'X') return { shape: 'X', weights: { X: 1 } };
  const shape    = cue.value;
  const duration = cue.end - cue.start;

  // ── Blend-in from previous shape ────────────────────────────────────────────
  const sinceStart = elapsed - cue.start;
  const blendIn    = Math.min(BLEND_IN_S, duration * 0.5);
  const tIn        = sinceStart < blendIn ? easeInOut(sinceStart / blendIn) : 1;

  // ── Look-ahead blend toward next shape ──────────────────────────────────────
  const untilEnd    = cue.end - elapsed;
  const blendOut    = Math.min(BLEND_OUT_S, duration * 0.4);
  const next        = cues[index + 1];
  const tOut        = (next && untilEnd < blendOut) ? easeInOut(1 - untilEnd / blendOut) : 0;

  const previous    = cues[index - 1];
  const prevShape   = previous?.value ?? 'X';
  const nextShape   = next?.value ?? 'X';

  // Mix = (1 - tOut) * [tIn * current + (1-tIn) * previous] + tOut * next
  const weights = {};
  const add = (key, v) => { weights[key] = (weights[key] ?? 0) + v; };

  const fromPrev = (1 - tIn);
  const inCurrent = tIn;

  // Contribution from [previous → current] blend
  add(shape,     inCurrent  * (1 - tOut));
  add(prevShape, fromPrev   * (1 - tOut));
  // Contribution from look-ahead toward next
  add(shape,     inCurrent  *  tOut * (1 - tOut));   // current fades
  add(nextShape,              tOut);                   // next emerges

  // Clamp & normalise so weights always sum to 1
  let total = 0;
  for (const k of Object.keys(weights)) {
    weights[k] = Math.max(0, Math.min(1, weights[k]));
    total += weights[k];
  }
  if (total > 0) for (const k of Object.keys(weights)) weights[k] /= total;

  return { shape, weights };
}

