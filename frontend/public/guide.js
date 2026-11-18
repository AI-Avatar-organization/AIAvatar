/**
 * The Guide's voice and face (ADR 0011, ADR 0012).
 *
 * - createFace: talking face of an Avatar. An Avaturn export with face blendshapes (Head/Teeth/Tongue_Mesh carry
 *   ARKit + Oculus visemes, as assets/avatar.glb does) is driven through its own visemes: loudness opens the mouth,
 *   the voice's brightness picks a rounder (O/U) or wider (E/I) shape, teeth and tongue follow, and the eyes blink.
 *   An Avatar without them falls back to addMouthMorph, a mouth-open morph added in memory (ported from AI Study
 *   Companion Avatar, calibrated for the single-mesh `avaturn_body`). Amplitude-driven, not phoneme lip sync.
 * - voiceShape: { energy, tone } of what an AnalyserNode is playing, for createFace.
 * - currentStation: the Station the Guide stands nearest to; it is the context of "ที่นี่ / here".
 * - GuideVoice: speaks an answer one sentence at a time with the Voice Profile (POST /api/tts), fetching the next
 *   sentence while the current one plays. Without a voice it still shows each sentence as a caption.
 *   Lip-sync: when the Avatar has visemes (`lipSync`, public/lipsync.js), each sentence's Rhubarb cues
 *   (GET /api/tts/cues/:key, analysed on the server while the audio is sent) drive the mouth by phoneme on the
 *   Web Audio clock. Until they arrive, and for Avatars without visemes, the mouth follows loudness.
 */
import * as THREE from 'three';
import { speechChunks, sentences } from './shared/speech-text.mjs';
import { pageUrl } from './base.js';

export { sentences, speechChunks } from './shared/speech-text.mjs';

const VISEMES = ['viseme_aa', 'viseme_O', 'viseme_U', 'viseme_E', 'viseme_I', 'jawOpen', 'eyeBlinkLeft', 'eyeBlinkRight'];

/**
 * Talking face: { kind: 'visemes'|'morph', setOpen(energy, tone = 0.5), tick(dt) } or null.
 * `energy` is the voice's RMS (voiceShape); each face applies its own gain.
 */
export function createFace(root) {
  const targets = [];
  root.traverse(object => {
    const dictionary = object.isMesh && object.morphTargetDictionary;
    if (!dictionary) return;
    for (const name of VISEMES) if (dictionary[name] !== undefined) targets.push({ mesh: object, name, index: dictionary[name] });
  });
  if (!targets.some(target => target.name === 'viseme_aa')) return addMouthMorph(root);
  const set = (name, value) => { for (const target of targets) if (target.name === name) target.mesh.morphTargetInfluences[target.index] = value; };
  let energy = 0, peak = 0.03, tone = 0.5, current = 0, currentTone = 0.5, blinkIn = 2 + Math.random() * 3, blink = 0;
  return {
    kind: 'visemes',
    setOpen(rms, brightness = 0.5) { energy = Math.max(0, rms); tone = THREE.MathUtils.clamp(brightness, 0, 1); },
    tick(dt) {
      // Automatic level: loudness relative to the peak of the last few seconds, so a loud TTS voice (RMS ≈ 0.1) and
      // a quiet mic recording both move the mouth through its whole range without sticking wide open.
      peak = Math.max(energy, 0.03, peak * Math.exp(-dt / 3));
      const open = 1 - Math.exp(-2.2 * energy / peak);
      current += (open - current) * (1 - Math.exp(-18 * dt));
      currentTone += (tone - currentTone) * (1 - Math.exp(-8 * dt));
      const round = THREE.MathUtils.clamp(1 - currentTone * 2, 0, 1);   // dark voice → O / U
      const wide = THREE.MathUtils.clamp(currentTone * 2 - 1, 0, 1);    // bright voice → E / I
      const mouth = current * 0.8;
      set('viseme_aa', mouth * (1 - round - wide));
      set('viseme_O', mouth * round * 0.8);
      set('viseme_U', mouth * round * 0.3);
      set('viseme_E', mouth * wide * 0.8);
      set('viseme_I', mouth * wide * 0.3);
      set('jawOpen', current * 0.2);
      blinkIn -= dt;
      if (blinkIn <= 0) { blink = 0.16; blinkIn = 2.5 + Math.random() * 3.5; }
      blink = Math.max(0, blink - dt);
      const lid = blink > 0 ? Math.sin((1 - blink / 0.16) * Math.PI) : 0;
      set('eyeBlinkLeft', lid);
      set('eyeBlinkRight', lid);
      return current;
    }
  };
}

/** Loudness (RMS) and brightness (spectral centroid of 0–4 kHz, 0 dark … 1 bright) of an AnalyserNode. */
export function voiceShape(analyser, buffers = {}) {
  buffers.time ??= new Float32Array(analyser.fftSize);
  buffers.freq ??= new Uint8Array(analyser.frequencyBinCount);
  analyser.getFloatTimeDomainData(buffers.time);
  let sum = 0;
  for (const value of buffers.time) sum += value * value;
  const energy = Math.sqrt(sum / buffers.time.length);
  analyser.getByteFrequencyData(buffers.freq);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  let weighted = 0, total = 0;
  for (let i = 1; i * binHz < 4000 && i < buffers.freq.length; i += 1) { weighted += buffers.freq[i] * i * binHz; total += buffers.freq[i]; }
  const centroid = total ? weighted / total : 1200;
  return { energy, tone: THREE.MathUtils.clamp((centroid - 500) / 1700, 0, 1) };
}

const MOUTH = { maxX: 0.05, minY: 1.678, maxY: 1.711, minZ: 0.065, splitY: 1.693 };

export function addMouthMorph(root) {
  let body;
  root.traverse(object => { if (!body && object.isMesh && object.name === 'avaturn_body') body = object; });
  if (!body?.geometry?.attributes?.position) return null;
  body.geometry = body.geometry.clone();
  const geometry = body.geometry;
  const position = geometry.attributes.position;
  const delta = new Float32Array(position.count * 3);
  let vertices = 0;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (Math.abs(x) > MOUTH.maxX || y < MOUTH.minY || y > MOUTH.maxY || z < MOUTH.minZ) continue;
    const weight = (1 - Math.abs(x) / MOUTH.maxX) ** 2;
    delta[i * 3 + 1] = (y < MOUTH.splitY ? -0.022 : 0.012) * weight; // lower lip down, upper lip up
    vertices += 1;
  }
  if (vertices < 4) return null;
  const targets = geometry.morphAttributes.position ?? [];
  const index = targets.length;
  targets.push(new THREE.Float32BufferAttribute(delta, 3));
  geometry.morphAttributes.position = targets;
  geometry.morphTargetsRelative = true;
  body.updateMorphTargets();
  body.morphTargetDictionary.mouthOpen = index;
  body.morphTargetInfluences[index] = 0;

  const cavity = new THREE.Mesh(new THREE.CircleGeometry(0.023, 24), new THREE.MeshBasicMaterial({ color: '#351b1a', side: THREE.DoubleSide }));
  cavity.name = 'guide-mouth-cavity';
  cavity.position.set(0, MOUTH.splitY, 0.107);
  cavity.scale.y = 0.015;
  body.parent.add(cavity);

  let target = 0, current = 0;
  return {
    vertices,
    kind: 'morph',
    setOpen(energy) { target = THREE.MathUtils.clamp(energy * 24, 0, 1); },
    tick(dt) {
      current += (target - current) * (1 - Math.exp(-14 * dt));
      body.morphTargetInfluences[index] = current;
      cavity.scale.set(1, 0.015 + current * 0.48, 1);
      return current;
    }
  };
}

/** Nearest Station to a position within `radius` metres (ground plane), or null. */
export function currentStation(stations, position, radius = 25) {
  let best = null, bestDistance = radius;
  for (const station of stations) {
    const distance = Math.hypot(station.position[0] - position[0], station.position[2] - position[2]);
    if (distance <= bestDistance) { best = station; bestDistance = distance; }
  }
  return best;
}

export class GuideVoice {
  /** onCaption(text|null), onState('speaking'|'idle'), mouth from createFace and lipSync of the Avatar (both optional). */
  constructor({ mouth = null, lipSync = null, onCaption = () => {}, onState = () => {}, onAudio = () => {} } = {}) {
    Object.assign(this, { mouth, lipSync, onCaption, onState, onAudio });
    this.context = null;
    this.analyser = null;
    this.source = null;
    this.run = 0;
    this.voiceAvailable = true;
    this.buffers = {};
  }

  /** Must be called from a user gesture once, so the browser lets the page play sound. */
  unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') this.context.resume();
  }

  /**
   * Mouth from the playing audio; call every frame. Phoneme cues win when they are there (lipSync.speaking):
   * the loudness face then closes its visemes and only blinks. Otherwise loudness drives the face, or the
   * Avatar's own visemes when it has no face (VRM).
   */
  frame(dt) {
    const shape = this.analyser ? voiceShape(this.analyser, this.buffers) : { energy: 0, tone: 0.5 };
    const byPhoneme = Boolean(this.lipSync?.speaking);
    if (this.mouth) {
      this.mouth.setOpen(byPhoneme ? 0 : shape.energy, shape.tone);
      this.mouth.tick(dt);
    }
    this.lipSync?.setLevel(byPhoneme || this.mouth ? 0 : 1 - Math.exp(-shape.energy * 30));
  }

  stop() {
    this.run += 1;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
    this.analyser = null;
    this.lipSync?.stop();
    this.onAudio(false);
    this.onCaption(null);
    this.onState('idle');
  }

  async #fetchSentence(text, lang) {
    if (!this.voiceAvailable) return null;
    try {
      const response = await fetch(pageUrl('api/tts'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 503 || response.status === 403) this.voiceAvailable = false; // no Voice Profile or worker: captions only
        console.warn('Guide voice unavailable:', body.error ?? response.status);
        return null;
      }
      this.unlock();
      const key = response.headers.get('X-Speech-Key');
      // Ask for the mouth cues now: they are analysed while this sentence downloads and the previous one plays.
      const cues = key ? fetch(pageUrl(`api/tts/cues/${key}`)).then(r => (r.ok ? r.json() : null)).then(c => c?.mouthCues ?? null, () => null) : Promise.resolve(null);
      return { buffer: await this.context.decodeAudioData(await response.arrayBuffer()), cues };
    } catch (error) {
      console.warn('Guide voice failed:', error);
      return null;
    }
  }

  #play({ buffer, cues }, run) {
    return new Promise(resolve => {
      if (run !== this.run) return resolve();
      const source = this.context.createBufferSource();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      source.buffer = buffer;
      source.connect(analyser).connect(this.context.destination);
      source.onended = () => {
        if (this.source === source) { this.source = null; this.analyser = null; this.lipSync?.stop(); this.onAudio(false); }
        resolve();
      };
      this.source = source;
      this.analyser = analyser;
      source.start();
      const startedAt = this.context.currentTime;
      // Seconds into this sentence while it plays; null once another sentence (or stop) took over.
      const clock = () => (this.source === source ? this.context.currentTime - startedAt : null);
      cues.then(mouthCues => { if (mouthCues?.length && this.source === source) this.lipSync?.play(mouthCues, clock); });
      this.onAudio(true);
    });
  }

  /** Speak text; resolves when finished or interrupted by stop() / another speak(). */
  speak(text, lang = 'th') {
    this.stop();
    const [first, ...rest] = speechChunks(text);
    return first ? this.#speakPieces(this.run, lang, first, Promise.resolve(rest)) : Promise.resolve();
  }

  /**
   * Speak an answer while it is still being written (spec R11.2): push(textSoFar) on every new piece starts the voice
   * as soon as the first sentence is complete; end(fullText) gives the rest and resolves when speaking ends.
   * The first piece is the same one speak(fullText) would say, so prebaked sentences still hit the voice cache.
   */
  speakStream(lang = 'th') {
    this.stop();
    const run = this.run;
    let first = null;
    let finish;
    let done = null;
    const rest = new Promise(resolve => { finish = resolve; });
    return {
      push: textSoFar => {
        if (first || run !== this.run || sentences(textSoFar).length < 2) return;
        first = speechChunks(textSoFar)[0];
        done = this.#speakPieces(run, lang, first, rest);
      },
      end: fullText => {
        if (run !== this.run) return Promise.resolve();
        if (!first) return this.speak(fullText, lang);
        const all = speechChunks(fullText);
        finish(all[0] === first ? all.slice(1) : fullText.startsWith(first) ? speechChunks(fullText.slice(first.length)) : all);
        return done;
      }
    };
  }

  /** Play `first`, then the pieces `rest` resolves to, fetching each next piece while the current one plays. */
  async #speakPieces(run, lang, first, rest) {
    const pieces = [first];
    rest.then(more => pieces.push(...more));
    this.onState('speaking');
    let next = this.#fetchSentence(first, lang);
    for (let i = 0; run === this.run; i += 1) {
      const audio = await next;
      if (run !== this.run) return;
      const nextPiece = (async () => { if (i + 1 >= pieces.length) await rest; return pieces[i + 1] ?? null; })();
      next = nextPiece.then(piece => (piece && run === this.run ? this.#fetchSentence(piece, lang) : null));
      this.onCaption(pieces[i]);
      if (audio) await this.#play(audio, run);
      else await new Promise(resolve => setTimeout(resolve, 900 + pieces[i].length * 55)); // reading time for a caption
      if (!(await nextPiece)) break;
    }
    if (run === this.run) { this.onCaption(null); this.onState('idle'); }
  }
}
