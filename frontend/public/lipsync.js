import { pageUrl } from './base.js';
import { sampleMouthCues } from './mouth-cues.js';

/**
 * Drive an Avatar's own Viseme morphs from Rhubarb mouth cues (A–F, X), Companion style:
 * cues are sampled on the playing audio's clock and morph weights are smoothed per frame.
 * Works with any Avatar whose morph names end in a known viseme name: Avaturn T2 / Ready Player Me (`viseme_aa`)
 * and VRChat/Oculus VRM (`vrc_v_aa`). An Avatar without visemes gets no driver (Gesture only, CONTEXT.md T2 Avatar).
 */

// Rhubarb shape → Oculus viseme (Rhubarb docs: A=MBP closed, B=most consonants, C=EH/AE, D=AA, E=AO/ER, F=UW/OW/W, X=rest).
export const RHUBARB_TO_VISEME = { A: 'PP', B: 'kk', C: 'E', D: 'aa', E: 'O', F: 'U', X: 'sil' };
// Oculus viseme name → suffixes used by different exporters.
const VISEME_ALIASES = {
  sil: ['viseme_sil', 'vrc_v_sil'], PP: ['viseme_PP', 'vrc_v_pp'], kk: ['viseme_kk', 'vrc_v_kk'],
  E: ['viseme_E', 'vrc_v_ee'], aa: ['viseme_aa', 'vrc_v_aa'], O: ['viseme_O', 'vrc_v_oh'], U: ['viseme_U', 'vrc_v_ou']
};

/** Find viseme morph indices per mesh: [{ mesh, index: { PP: 3, ... } }]. Empty when the Avatar has none. */
export function findVisemeTargets(root) {
  const found = [];
  root.traverse(object => {
    const dictionary = object.morphTargetDictionary;
    if (!dictionary) return;
    const names = Object.keys(dictionary);
    const index = {};
    for (const [viseme, aliases] of Object.entries(VISEME_ALIASES)) {
      const name = names.find(n => aliases.some(alias => n.toLowerCase().endsWith(alias.toLowerCase())));
      if (name !== undefined) index[viseme] = dictionary[name];
    }
    if (Object.keys(index).length >= 4) found.push({ mesh: object, index });
  });
  return found;
}

/** Rhubarb weights { A: 0.7, B: 0.3 } → viseme weights { PP: 0.7, kk: 0.3 } (rest pose X maps to nothing open). */
export function visemeWeights(rhubarbWeights) {
  const out = {};
  for (const [shape, weight] of Object.entries(rhubarbWeights)) {
    const viseme = RHUBARB_TO_VISEME[shape];
    if (viseme && viseme !== 'sil') out[viseme] = (out[viseme] ?? 0) + weight;
  }
  return out;
}

export class LipSync {
  static for(root) {
    const targets = findVisemeTargets(root);
    return targets.length ? new LipSync(targets) : null;
  }

  constructor(targets) {
    this.targets = targets;
    this.goal = {};
    this.current = {};
    this.cues = [];
    this.clock = null; // () => seconds into the playing audio, or null when silent
    this.shape = 'X';
    this.level = 0; // mouth opening from loudness, used while there are no cues (0 … 1)
  }

  /**
   * Follow these cues on a clock until it ends: an <audio> element, or a function giving seconds into the sound
   * (null once it has ended), e.g. the Guide voice playing through Web Audio.
   */
  play(cues, clock) {
    this.cues = cues;
    this.clock = typeof clock === 'function' ? clock : () => (clock.paused || clock.ended ? null : clock.currentTime);
  }

  stop() { this.cues = []; this.clock = null; }

  /** True while cues are being followed on a running clock (the loudness mouth then stays out of the way). */
  get speaking() { return Boolean(this.cues.length && this.clock?.() != null); }

  /** Open the mouth by loudness (0 … 1) until cues arrive, so an Avatar talks from the first syllable. */
  setLevel(level) { this.level = Math.max(0, Math.min(1, level)); }

  update(dt) {
    const elapsed = this.clock?.();
    if (elapsed == null || !this.cues.length) { this.goal = this.level > 0.02 ? { aa: this.level * 0.7, O: this.level * 0.15 } : {}; this.shape = 'X'; }
    else {
      const frame = sampleMouthCues(this.cues, elapsed);
      this.shape = frame.shape;
      this.goal = visemeWeights(frame.weights);
    }
    // Idle and closed: leave the morphs to other drivers (the Guide's loudness face moves the same visemes).
    const idle = !Object.keys(this.goal).length && Object.values(this.current).every(value => value < 0.001);
    if (idle) { this.current = {}; return; }
    const alpha = 1 - Math.exp(-14 * dt); // Companion SMOOTH_SPEED
    for (const viseme of Object.keys(VISEME_ALIASES)) {
      const next = (this.current[viseme] ?? 0) + ((this.goal[viseme] ?? 0) - (this.current[viseme] ?? 0)) * alpha;
      this.current[viseme] = next;
      for (const { mesh, index } of this.targets) if (index[viseme] !== undefined) mesh.morphTargetInfluences[index[viseme]] = next;
    }
  }
}

/** Play an audio Blob/URL with lip-sync: server analyses the same audio (POST /api/lipsync), then both start together. */
export async function speakWithLipSync(lipSync, source) {
  const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  const started = performance.now();
  const response = await fetch(pageUrl('api/lipsync'), { method: 'POST', body: blob });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'lip-sync failed');
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    // Listen before play() so a playback error ends the wait instead of hanging the caller.
    const finished = new Promise((resolve, reject) => {
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', () => reject(new Error('เล่นเสียงไม่ได้')), { once: true });
    });
    lipSync?.play(result.mouthCues, audio);
    await audio.play();
    const timings = { ...result.timings, clientMs: Math.round(performance.now() - started) };
    await finished;
    return { ...result, timings };
  } finally {
    lipSync?.stop();
    URL.revokeObjectURL(url);
  }
}
