/**
 * Record mode (spec R3.1–R3.2, ADR 0004): records what the Creator's Avatar does and what the Creator says.
 *
 * The Creator drives the Avatar with the normal controls (mic + Voice Command, Pins, gesture buttons).
 * Between ⏺ and ⏹ this records, on the recording clock (which stops during ⏸):
 *   - the Avatar's pose every frame, kept as adaptive keyframes (≤ 1 cm off the real path),
 *   - the Avatar's own events (walk-start, arrived, gesture-start/end, state) — the system knows the gesture from
 *     the command that caused it, nothing is guessed,
 *   - the microphone the whole time (MediaRecorder pause/resume keeps it in step with the clock), including commands,
 *   - captions: the transcript of every Voice Command, timed from mic press to release.
 */
import { createKeyframer } from './shared/recording.mjs';

const pickAudioType = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  .find(type => globalThis.MediaRecorder?.isTypeSupported?.(type)) ?? '';

export class Recorder {
  constructor(avatar) {
    this.avatar = avatar;
    this.status = 'idle'; // idle | recording | paused
    this.elapsed = 0;     // seconds recorded before the current run
    this.runStarted = 0;  // performance.now() when the current run started
  }

  /** Recording clock in seconds (frozen while paused). */
  now() {
    if (this.status === 'recording') return this.elapsed + (performance.now() - this.runStarted) / 1000;
    return this.elapsed;
  }

  async start() {
    if (this.status !== 'idle') return;
    this.keyframer = createKeyframer();
    this.events = [];
    this.captions = [];
    this.chunks = [];
    this.audioType = '';
    this.media = null;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.audioType = pickAudioType();
      this.media = new MediaRecorder(this.stream, this.audioType ? { mimeType: this.audioType } : undefined);
      this.media.ondataavailable = event => { if (event.data.size) this.chunks.push(event.data); };
      this.media.start(1000);
    } catch (error) {
      console.warn('Recording without microphone:', error);
      this.stream = null;
    }
    this.elapsed = 0;
    this.runStarted = performance.now();
    this.status = 'recording';
    this.unsubscribe = this.avatar.onChange(event => this.#onAvatar(event));
    this.#sample();
    this.#event({ type: 'state', state: this.avatar.state ?? 'idle' });
  }

  pause() {
    if (this.status !== 'recording') return;
    this.#sample();
    this.elapsed = this.now();
    this.status = 'paused';
    if (this.media?.state === 'recording') this.media.pause();
  }

  resume() {
    if (this.status !== 'paused') return;
    this.runStarted = performance.now();
    this.status = 'recording';
    if (this.media?.state === 'paused') this.media.resume();
    this.#sample();
  }

  /** Every frame: keep the pose while recording. */
  frame() { if (this.status === 'recording') this.#sample(); }

  /** A Voice Command's transcript as a caption, from mic press (start, recording clock) until now. */
  caption(text, start) {
    if (this.status === 'idle' || !text) return;
    const end = this.now();
    this.captions.push({ start: Math.max(0, Math.min(start ?? end, end)), end: Math.max(end, (start ?? end) + 0.5), text });
  }

  /** ⏹: returns { recording (without id/title), audio: Blob|null, audioType }. */
  async stop() {
    if (this.status === 'idle') return null;
    if (this.status === 'recording') { this.#sample(); this.elapsed = this.now(); }
    this.status = 'idle';
    this.unsubscribe?.();
    const audio = await this.#stopAudio();
    const duration = Math.round(this.elapsed * 1000) / 1000;
    return {
      recording: { duration, track: this.keyframer.finish(), events: this.events, captions: this.captions.sort((a, b) => a.start - b.start) },
      audio, audioType: audio?.type ?? this.audioType
    };
  }

  /** Throw the current take away (nothing is saved). */
  async discard() {
    this.status = 'idle';
    this.unsubscribe?.();
    await this.#stopAudio();
  }

  async #stopAudio() {
    const media = this.media;
    this.media = null;
    if (!media) { this.stream?.getTracks().forEach(track => track.stop()); return null; }
    const done = new Promise(resolve => { media.onstop = resolve; });
    if (media.state !== 'inactive') media.stop();
    await done;
    this.stream?.getTracks().forEach(track => track.stop());
    return this.chunks.length ? new Blob(this.chunks, { type: (media.mimeType || this.audioType).split(';')[0] || 'audio/webm' }) : null;
  }

  #sample() {
    const { position, rotation } = this.avatar.root;
    this.keyframer.push(this.now(), position.x, position.y, position.z, rotation.y);
  }

  #event(event) { this.events.push({ t: Math.round(this.now() * 1000) / 1000, ...event }); }

  #onAvatar(event) {
    if (this.status !== 'recording') return;
    if (event.type === 'walk-start') { this.#sample(); this.#event({ type: 'walk-start', stationId: event.meta?.stationId ?? null }); }
    else if (event.type === 'arrived') { this.#sample(); this.#event({ type: 'arrived', stationId: event.meta?.stationId ?? null }); }
    else if (event.type === 'gesture-start') this.#event({ type: 'gesture-start', id: event.id });
    else if (event.type === 'gesture-end') this.#event({ type: 'gesture-end', id: event.id, finished: event.finished });
    else if (event.type === 'state') this.#event({ type: 'state', state: event.state });
  }
}
