/**
 * Route planning over a navmesh plus authored connectors (stairs/ramps the auto navmesh cannot resolve).
 * Pure: pathFn(from, to) returns [[x,y,z], …] or null, so it can be tested without WASM.
 *
 * connectors = [{ id, points: [[x,y,z], …] }]  first point on the lower level, last on the upper level.
 */

const xz = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const length = path => path.reduce((sum, p, i) => (i ? sum + Math.hypot(xz(p, path[i - 1]), p[1] - path[i - 1][1]) : 0), 0);

/** A path counts only if it really ends at the goal, on the goal's level. */
export function reaches(path, goal, { radius = 1.2, height = 0.8 } = {}) {
  if (!path?.length) return false;
  const end = path.at(-1);
  return xz(end, goal) <= radius && Math.abs(end[1] - goal[1]) <= height;
}

function leg(pathFn, from, to) {
  if (xz(from, to) < 0.05 && Math.abs(from[1] - to[1]) < 0.3) return [from, to];
  const path = pathFn(from, to);
  return reaches(path, to) ? path : null;
}

export function planRoute(pathFn, from, to, connectors = []) {
  const direct = leg(pathFn, from, to);
  if (direct) return { path: direct, via: null };
  let best = null;
  for (const connector of connectors) {
    for (const points of [connector.points, [...connector.points].reverse()]) {
      const first = leg(pathFn, from, points[0]);
      if (!first) continue;
      const last = leg(pathFn, points.at(-1), to);
      if (!last) continue;
      const path = [...first, ...points.slice(1, -1), ...last];
      const total = length(path);
      if (!best || total < best.total) best = { path, via: connector.id, total };
    }
  }
  return best ? { path: best.path, via: best.via } : null;
}
