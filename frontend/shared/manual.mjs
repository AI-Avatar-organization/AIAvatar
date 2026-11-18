/**
 * WASD Manual Control (spec R8.3, T23): where the held keys ask the Avatar to go this frame.
 * Pure: the page clamps `to` to the navmesh (Recast moveAlongSurface) and takes the height from the ground raycast.
 * Flash (×3) speeds translation only: turning faster felt twitchy in the prototype.
 */
import { flashed } from './speed.mjs';

export const WALK = 3;     // m/s forward
export const BACK = 0.6;   // S is this share of WALK
export const TURN = 2.6;   // rad/s
export const MANUAL_KEYS = new Set(['w', 'a', 's', 'd']);

/** keys: Set of held keys ('w','a','s','d'). Returns { rotY, to: [x,y,z], speed } or null when nothing is held. */
export function manualStep({ position, rotY, keys, dt, flash = false }) {
  const turn = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
  const forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? BACK : 0);
  if (!turn && !forward) return null;
  const heading = rotY + turn * TURN * dt;
  const speed = flashed(Math.abs(forward) * WALK, flash);
  const step = Math.sign(forward) * speed * dt;
  const [x, y, z] = position;
  return { rotY: heading, to: [x + Math.sin(heading) * step, y, z + Math.cos(heading) * step], speed };
}
