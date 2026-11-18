/**
 * Replay player (spec R3.4–R3.5, ADR 0004): plays a Recording on a second Avatar beside the Visitor's own.
 *
 * The audio clock drives time while the voice plays, so voice, captions and movement stay together; without audio a
 * performance clock is used. Every frame the recorded Avatar is put at poseAt(t) with the Gesture at its offset,
 * so seeking anywhere is instant and exact. The Visitor keeps control of their own Avatar and the camera.
 */
import { poseAt, gestureAt, walkingAt, flyingAt, captionAt } from './shared/recording.mjs';
import { voiceShape } from './guide.js';

export class ReplayPlayer {
  /** recording: recording.json; avatar: the recorded Avatar; audio: AudioBuffer|null; context: AudioContext. */
  constructor({ recording, avatar, audio = null, context = null, onCaption = () => {}, onTime = () => {}, onEnd = () => {} }) {
    Object.assign(this, { recording, avatar, audio, context, onCaption, onTime, onEnd });
    this.duration = recording.duration;
    this.t = 0;
    this.paused = true;
    this.volume = 1;
    this.muted = false;
    this.captions = true;
    this.lastCaption = undefined;
    if (context && audio) {
      this.gain = context.createGain();
      this.gain.connect(context.destination);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.gain.connect(this.analyser);
    }
    this.#apply(0, 0);
  }

  play() {
    if (!this.paused) return;
    if (this.t >= this.duration - 0.01) this.t = 0;
    this.paused = false;
    this.clockBase = performance.now() / 1000 - this.t;
    if (this.context && this.audio) {
      this.context.resume?.();
      this.source = this.context.createBufferSource();
      this.source.buffer = this.audio;
      this.source.connect(this.gain);
      this.audioBase = this.context.currentTime - this.t;
      if (this.t < this.audio.duration) this.source.start(0, this.t);
    }
  }

  pause() {
    if (this.paused) return;
    this.t = this.#clock();
    this.paused = true;
    this.#stopSource();
  }

  toggle() { this.paused ? this.play() : this.pause(); }

  seek(t) {
    const playing = !this.paused;
    if (playing) this.pause();
    this.t = Math.min(Math.max(0, t), this.duration);
    this.#apply(this.t, 0, true);
    if (playing && this.t < this.duration - 0.01) this.play(); // play() rewinds at the end, so a seek to the end just stops
    else if (playing) this.onEnd();
  }

  setVolume(volume) { this.volume = volume; this.#gain(); }
  setMuted(muted) { this.muted = muted; this.#gain(); }
  setCaptions(on) { this.captions = on; this.lastCaption = undefined; this.#caption(this.t); }

  /** Loudness (RMS) and brightness of the recorded voice right now, for the recorded Avatar's face. */
  shape() {
    if (this.paused || !this.analyser) return { energy: 0, tone: 0.5 };
    this.buffers ??= {};
    return voiceShape(this.analyser, this.buffers);
  }

  /** Loudness of the recorded voice (0…1), for the 🎙 Speaker Label. */
  energy() { return this.shape().energy; }

  /** Every frame. */
  frame(dt) {
    if (this.paused) return;
    const t = this.#clock();
    if (t >= this.duration) {
      this.t = this.duration;
      this.#apply(this.t, dt);
      this.paused = true;
      this.#stopSource();
      this.onEnd();
      return;
    }
    this.t = t;
    this.#apply(t, dt);
  }

  dispose() { this.#stopSource(); this.gain?.disconnect(); this.analyser?.disconnect(); }

  #clock() {
    if (this.source && this.context) return this.context.currentTime - this.audioBase;
    return performance.now() / 1000 - this.clockBase;
  }

  #stopSource() {
    try { this.source?.stop(); } catch { /* not started */ }
    this.source?.disconnect();
    this.source = null;
  }

  #gain() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume; }

  #apply(t, dt, seeking = false) {
    const { track, events, captions } = this.recording;
    const pose = poseAt(track, t);
    if (!pose) return;
    const ahead = poseAt(track, t + 0.1);
    const speed = Math.hypot(ahead.position[0] - pose.position[0], ahead.position[2] - pose.position[2]) / 0.1;
    this.speed = speed; // m/s the recorded Avatar moves now: the pace Follow walks at (spec R8.1)
    this.avatar.setPuppet(pose.position, pose.rotY, walkingAt(events, t) && speed > 0.05, speed);
    this.avatar.setFlying?.(flyingAt(events, t));
    let gesture = gestureAt(events, t);
    const clip = gesture && this.avatar.actions?.gestures.get(gesture.id);
    if (gesture && (!clip || (!clip.loop && gesture.offset >= clip.clip.duration - 0.05))) gesture = null; // clip over: don't restart it
    if (gesture) {
      if (!this.avatar.setGestureTime(gesture.id, gesture.offset)) {
        this.avatar.playGesture(gesture.id);
        this.avatar.setGestureTime(gesture.id, gesture.offset);
      } else if (seeking) this.avatar.setGestureTime(gesture.id, gesture.offset);
    } else if (this.avatar.gesture) this.avatar.stopGesture();
    this.#caption(t);
    this.onTime(t, this.duration);
  }

  #caption(t) {
    const caption = this.captions ? captionAt(this.recording.captions, t) : null;
    if (caption !== this.lastCaption) { this.lastCaption = caption; this.onCaption(caption?.text ?? null); }
  }
}

export const formatTime = seconds => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
