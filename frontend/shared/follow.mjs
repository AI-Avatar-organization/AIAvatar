/**
 * Follow in Replay (spec R8.1, T22): the Visitor's Avatar walks beside the recorded Avatar.
 * Pure: positions are [x, y, z]; the navmesh comes in as { path(from, to) → points | null, move(from, to) → point,
 * snap(point) → point | null } (move clamps a step to the walkable surface, snap finds the nearest floor). Shared by the page and the unit tests.
 *
 * Prototype findings (.scratch/prototype-controls/NOTES.md): walk at the leader's own pace plus a capped catch-up,
 * let the last waypoint track the live goal and never aim at the path start, or following stalls in stop-go jitter.
 */
import { flashed } from './speed.mjs';

export const FOLLOW_BACK = 1.2;   // m behind the recorded Avatar
export const FOLLOW_SIDE = 0.9;   // m to its right: 1.5 m in all
export const CATCHUP_CAP = 4;     // m/s on top of the leader's pace
export const CATCHUP_GAIN = 2.5;  // 1/s × gap
export const REWARP = 15;         // m: further behind than this → warp again

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const flatGap = (a, b) => Math.hypot(b[0] - a[0], b[2] - a[2]);

/** The spot behind-right of an Avatar at `position` facing `rotY` (three.js: rotY 0 faces +z, its right is -x). */
export function behindRight(position, rotY, back = FOLLOW_BACK, side = FOLLOW_SIDE) {
  const [x, y, z] = position;
  return [x - Math.sin(rotY) * back - Math.cos(rotY) * side, y, z - Math.cos(rotY) * back + Math.sin(rotY) * side];
}

/** Where the Visitor's Avatar warps to: behind-right of the leader on the navmesh, else the leader's own floor. */
export function warpBeside(nav, leader) {
  const spot = behindRight(leader.position, leader.rotY);
  return nav.snap?.(spot) ?? nav.snap?.(leader.position) ?? spot;
}

/**
 * A follower for one Replay. step({ leader: { position, rotY, speed }, me: { position, rotY }, dt, flash })
 * → { position, rotY, speed, walking, warped }: where the Visitor's Avatar stands after this frame.
 * Flash multiplies only the catch-up: the steady pace stays the leader's (spec R8.5).
 */
export function createFollower(nav, { rewarp = REWARP } = {}) {
  let path = null;   // { points, goal, age }
  return {
    reset() { path = null; },
    step({ leader, me, dt, flash = false }) {
      const goal = behindRight(leader.position, leader.rotY);
      if (flatGap(me.position, leader.position) > rewarp) {
        path = null;
        return { position: warpBeside(nav, leader), rotY: leader.rotY, speed: 0, walking: false, warped: true };
      }
      const gap = flatGap(me.position, goal);
      if (gap < 0.15) {
        path = null;
        return { position: me.position, rotY: me.rotY + angleTo(me.rotY, leader.rotY) * Math.min(1, dt * 6), speed: 0, walking: false, warped: false };
      }
      if (!path || path.age > 0.25 || flatGap(path.goal, goal) > 1) {
        const points = nav.path(me.position, goal);
        path = { points: (points?.slice(1) ?? [goal]).map(p => [...p]), goal, age: 0 };
      }
      path.age += dt;
      const points = path.points;
      points[points.length - 1] = goal; // the last waypoint tracks the live goal, so a stale path never stops us
      while (points.length > 1 && flatGap(points[0], me.position) < 0.4) points.shift(); // never aim back at a reached point
      const next = points[0];
      const k = flashed(1, flash);
      const speed = (leader.speed ?? 0) + Math.min(CATCHUP_CAP * k, CATCHUP_GAIN * k * gap);
      const toNext = flatGap(me.position, next);
      const step = Math.min(toNext, speed * dt);
      const dx = (next[0] - me.position[0]) / (toNext || 1), dz = (next[2] - me.position[2]) / (toNext || 1);
      const target = [me.position[0] + dx * step, next[1], me.position[2] + dz * step];
      const position = nav.move(me.position, target) ?? me.position;
      const rotY = me.rotY + angleTo(me.rotY, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      const walked = flatGap(me.position, position) / Math.max(dt, 1e-6);
      return { position, rotY, speed: walked, walking: walked > 0.3, warped: false };
    }
  };
}
