/**
 * Recording format and its pure maths (ADR 0004), shared by the browser recorder/player and the server.
 *
 * recording.json = { id, mapId, mapVersion, title, speaker, createdAt, duration,
 *                    track: [[t, x, y, z, rotY], …], events: [{ t, type, … }], captions: [{ start, end, text }] }
 * t is the recording clock in seconds: it stops while the Creator pauses (⏸), so paused time is never in a Recording.
 */

export const TRACK_TOLERANCE = 0.01;   // m: interpolation between kept keyframes stays within 1 cm of the real path
export const ROTATION_TOLERANCE = 0.02; // rad
export const MAX_KEYFRAME_GAP = 1;      // s: keep at least one keyframe per second

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAngle = (a, b, k) => a + angleDiff(a, b) * k;

/** Adaptive keyframer: push every frame's pose, keep only the frames needed to replay within tolerance. */
export function createKeyframer({ tolerance = TRACK_TOLERANCE, rotationTolerance = ROTATION_TOLERANCE, maxGap = MAX_KEYFRAME_GAP } = {}) {
  const track = [];
  let pending = []; // samples after the last kept keyframe
  const deviates = (from, to, sample) => {
    const k = to[0] > from[0] ? (sample[0] - from[0]) / (to[0] - from[0]) : 0;
    const dx = lerp(from[1], to[1], k) - sample[1], dy = lerp(from[2], to[2], k) - sample[2], dz = lerp(from[3], to[3], k) - sample[3];
    return Math.hypot(dx, dy, dz) > tolerance || Math.abs(angleDiff(lerpAngle(from[4], to[4], k), sample[4])) > rotationTolerance;
  };
  return {
    push(t, x, y, z, rotY) {
      const sample = [round(t, 3), round(x), round(y), round(z), round(rotY)];
      if (!track.length) { track.push(sample); return; }
      const last = track.at(-1);
      if (sample[0] <= last[0]) return;
      const candidate = [...pending, sample];
      const tooLong = sample[0] - last[0] > maxGap;
      if (tooLong || pending.some(s => deviates(last, sample, s))) {
        const keep = pending.at(-1) ?? sample;
        track.push(keep);
        pending = keep === sample ? [] : [sample];
        return;
      }
      pending = candidate;
    },
    /** The finished track (the last pose is always kept). */
    finish() {
      if (pending.length) track.push(pending.at(-1));
      pending = [];
      return track;
    }
  };
}

const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Index of the last element whose time (by key) is ≤ t (binary search), or -1. */
function lastAtOrBefore(list, t, key) {
  let low = 0, high = list.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (key(list[mid]) <= t) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found;
}

/** Avatar pose at time t: { position: [x, y, z], rotY }. */
export function poseAt(track, t) {
  if (!track.length) return null;
  const i = lastAtOrBefore(track, t, frame => frame[0]);
  if (i < 0) return { position: track[0].slice(1, 4), rotY: track[0][4] };
  const a = track[i], b = track[i + 1];
  if (!b) return { position: a.slice(1, 4), rotY: a[4] };
  const k = (t - a[0]) / (b[0] - a[0]);
  return { position: [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)], rotY: lerpAngle(a[4], b[4], k) };
}

/** The Gesture playing at time t: { id, offset } (seconds into the clip), or null. */
export function gestureAt(events, t) {
  let current = null;
  for (const event of events) {
    if (event.t > t) break;
    if (event.type === 'gesture-start') current = { id: event.id, start: event.t };
    else if ((event.type === 'gesture-end' || event.type === 'walk-start') && current) current = null;
  }
  return current ? { id: current.id, offset: t - current.start } : null;
}

/** True while the Avatar walks at time t (between walk-start and arrived/cancel). */
export function walkingAt(events, t) {
  let walking = false;
  for (const event of events) {
    if (event.t > t) break;
    if (event.type === 'state') walking = event.state === 'walking'; // the Avatar's own state (also covers a cancelled walk)
    else if (event.type === 'walk-start') walking = true;
    else if (event.type === 'arrived' || event.type === 'gesture-start') walking = false;
  }
  return walking;
}

/** True while the Avatar flies at time t (state "flying" until the next state, spec R8.4). */
export function flyingAt(events, t) {
  let flying = false;
  for (const event of events) {
    if (event.t > t) break;
    if (event.type === 'state') flying = event.state === 'flying';
  }
  return flying;
}

/** Caption shown at time t, or null. */
export function captionAt(captions, t) {
  const i = lastAtOrBefore(captions, t, caption => caption.start);
  return i >= 0 && t <= captions[i].end ? captions[i] : null;
}

/** Throws a 400 error unless value is a well-formed recording.json (server side check before saving). */
export function validateRecording(value) {
  const fail = message => { throw Object.assign(new Error(`Recording ไม่ถูกต้อง: ${message}`), { status: 400 }); };
  if (!value || typeof value !== 'object') fail('ไม่ใช่ JSON object');
  if (typeof value.mapId !== 'string' || !/^[a-z0-9-]+$/.test(value.mapId)) fail('mapId');
  if (!(value.duration > 0) || value.duration > 4 * 3600) fail('duration');
  if (!Array.isArray(value.track) || !value.track.length) fail('track ว่าง');
  let previous = -Infinity;
  for (const frame of value.track) {
    if (!Array.isArray(frame) || frame.length !== 5 || !frame.every(Number.isFinite)) fail('track frame');
    if (frame[0] < previous) fail('track ต้องเรียงตามเวลา');
    previous = frame[0];
  }
  if (!Array.isArray(value.events) || !value.events.every(e => e && Number.isFinite(e.t) && typeof e.type === 'string')) fail('events');
  if (!Array.isArray(value.captions) || !value.captions.every(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && typeof c.text === 'string')) fail('captions');
  return value;
}
