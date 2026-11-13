/**
 * Voice input (ADR 0009). On mic press the page reserves a slot in the language's STT Service first:
 *   - slot → record with MediaRecorder and send the audio with the slot token (POST /api/stt)
 *   - busy / unavailable → Browser STT Fallback (the browser's own speech recognition, which sends audio to an
 *     outside service) when the browser has it, otherwise the Visitor is asked to type.
 */
const SpeechRecognitionApi = () => window.SpeechRecognition ?? window.webkitSpeechRecognition;
export const browserSpeechSupported = () => Boolean(SpeechRecognitionApi());

/** Ask for a slot: { token, expiresInMs } or null when the STT Service is full or down. Never waits. */
export async function reserveSlot(lang) {
  try {
    const response = await fetch(`/api/stt/reserve?lang=${lang}`, { method: 'POST' });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

/** Give an unused slot back early (mic failed, too short, page closed) so the next Visitor gets it. */
export function releaseSlot(lang, token) {
  const url = `/api/stt/release?lang=${lang}&token=${encodeURIComponent(token)}`;
  if (!navigator.sendBeacon?.(url)) fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}

/** Push-to-talk capture → POST /api/stt with a slot token. One capture at a time. */
export class VoiceInput {
  constructor({ maxMs = 15000 } = {}) {
    this.maxMs = maxMs;
    this.recorder = null;
  }

  get recording() { return this.recorder?.state === 'recording'; }

  async start() {
    if (this.recording) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) ?? '';
    this.chunks = [];
    this.stream = stream;
    this.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = event => event.data.size && this.chunks.push(event.data);
    this.done = new Promise(resolve => { this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType })); });
    this.recorder.start();
    this.timer = setTimeout(() => this.recording && this.recorder.stop(), this.maxMs);
  }

  /** Stop and return { text, language, transcribedBy, timings, clientTimings } from the server. */
  async stop(prompt = '', lang = 'th', token = '') {
    if (!this.recorder) return null;
    const stopPressed = performance.now();
    clearTimeout(this.timer);
    if (this.recording) this.recorder.stop();
    const blob = await this.done;
    this.stream.getTracks().forEach(track => track.stop());
    this.recorder = null;
    if (blob.size < 1000) throw Object.assign(new Error('too short'), { code: 'too-short' });
    const stopRecordingMs = Math.round(performance.now() - stopPressed);
    const body = await transcribeBlob(blob, lang, prompt, token);
    return { ...body, clientTimings: { ...body.clientTimings, stopRecordingMs } };
  }
}

export async function transcribeBlob(blob, lang = 'th', prompt = '', token = '') {
  const query = new URLSearchParams({ lang, prompt, ...(token ? { token } : {}) });
  const sent = performance.now();
  const response = await fetch(`/api/stt?${query}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error ?? ''), { code: body.busy ? 'busy' : body.unavailable ? 'unavailable' : 'failed' });
  return { ...body, clientTimings: { requestMs: Math.round(performance.now() - sent) } }; // request = upload … response back
}

/** Browser STT Fallback: the browser's speech recognition, live while the mic is held. */
export class BrowserSpeechInput {
  constructor({ maxMs = 15000 } = {}) { this.maxMs = maxMs; this.recognition = null; }

  get recording() { return Boolean(this.recognition); }

  start(lang = 'th') {
    const Recognition = SpeechRecognitionApi();
    const recognition = new Recognition();
    recognition.lang = lang === 'en' ? 'en-US' : 'th-TH';
    recognition.continuous = true;
    recognition.interimResults = false;
    const finals = [];
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) finals.push(event.results[i][0].transcript);
    };
    this.done = new Promise((resolve, reject) => {
      // not-allowed, network, service-not-allowed …: the page asks the Visitor to type instead
      recognition.onerror = event => { if (event.error !== 'no-speech' && event.error !== 'aborted') reject(Object.assign(new Error(event.error), { code: 'browser-speech' })); };
      recognition.onend = () => resolve(finals.join(' ').trim());
    });
    this.done.catch(() => {});
    recognition.start();
    this.recognition = recognition;
    this.timer = setTimeout(() => this.recognition?.stop(), this.maxMs);
  }

  /** Stop listening and return { text, language, transcribedBy: 'browser', clientTimings }. */
  async stop(lang = 'th') {
    if (!this.recognition) return null;
    const stopPressed = performance.now();
    clearTimeout(this.timer);
    this.recognition.stop();
    this.recognition = null;
    const text = await this.done;
    return { text, language: lang, provider: 'browser', transcribedBy: 'browser', clientTimings: { stopRecordingMs: Math.round(performance.now() - stopPressed) } };
  }
}
