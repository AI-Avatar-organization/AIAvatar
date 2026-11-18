/**
 * Flight (spec R8.4, T24): F takes off, Space (held) rises, Shift descends, nothing held hovers, W/S/A/D steer.
 * Pure maths; the page stops horizontal moves at walls (rays at 0.3 m and 1.2 m, roofs and clouds passable) and lands
 * on the navmesh floor below, never on a roof. Flash (×3) speeds flying, rising and landing, not turning.
 */
import { TURN, BACK } from './manual.mjs';
import { flashed } from './speed.mjs';

export const FLY = 6;            // m/s horizontal
export const RISE = 3;           // m/s up (Space) or down (Shift)
export const LAND = 6;           // m/s coming down after F
export const MAX_HEIGHT = 30;    // m above where the flight began
export const LIFT = 0.5;         // m hop on take-off, so the Avatar visibly leaves the ground

export function takeOff([x, y, z]) {
  return { ceiling: y + MAX_HEIGHT, position: [x, y + LIFT, z] };
}

/** keys: Set of held keys ('w','a','s','d',' ','shift'). Returns { rotY, to: [x,y,z] horizontal wish, y, speed }. */
export function flightStep({ position, rotY, keys, dt, flash = false, ceiling, floor = -Infinity }) {
  const k = flashed(1, flash);
  const turn = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  const forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? BACK : 0);
  const heading = rotY + turn * TURN * dt;
  const speed = Math.abs(forward) * FLY * k;
  const step = Math.sign(forward) * speed * dt;
  const [x, y, z] = position;
  const climb = ((keys.has(' ') ? 1 : 0) - (keys.has('shift') ? 1 : 0)) * RISE * k * dt;
  return {
    rotY: heading,
    to: [x + Math.sin(heading) * step, y, z + Math.cos(heading) * step],
    y: Math.min(Math.max(y + climb, floor), ceiling),
    speed
  };
}

/** One frame of coming down to floorY after F. */
export function landingStep({ y, floorY, dt, flash = false }) {
  const next = Math.max(floorY, y - flashed(LAND, flash) * dt);
  const done = next <= floorY + 1e-6;
  return { y: done ? floorY : next, done };
}
