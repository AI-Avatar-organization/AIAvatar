import { init, NavMeshQuery, importNavMesh } from '@recast-navigation/core';
import { threeToTiledNavMesh } from '@recast-navigation/three';

let ready;

/**
 * Walkable surface for one Map, generated from its meshes at load time (no hand-authored paths).
 * Agent size matches the Avatar (≈1.8 m tall, 0.25 m radius) and climbs normal stair steps (≤ 0.45 m).
 */
export class Navigation {
  static async load(url) {
    const started = performance.now();
    ready ??= init();
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load prepared walking paths: ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await ready;
    const { navMesh } = importNavMesh(bytes);
    const navigation = new Navigation(navMesh, 0);
    navigation.source = 'prebuilt';
    navigation.loadMs = Math.round(performance.now() - started);
    return navigation;
  }

  static async build(meshes, { agentHeight = 1.8, agentRadius = 0.25, maxClimb = 0.45, extent = 50 } = {}) {
    ready ??= init();
    await ready;
    // Voxel size scales with Map size so big Maps stay fast; small Maps keep stair detail.
    const cs = Math.min(0.25, Math.max(0.08, extent / 600));
    const ch = Math.min(cs, 0.1);
    const started = performance.now();
    // Tiled: a single solo mesh overflows Recast's per-mesh vertex limit on full Maps (crash seen on Rama II).
    const { success, navMesh } = threeToTiledNavMesh(meshes, {
      cs, ch, tileSize: 48,
      walkableSlopeAngle: 50,
      walkableHeight: Math.ceil(agentHeight / ch),
      walkableClimb: Math.floor(maxClimb / ch),
      walkableRadius: Math.ceil(agentRadius / cs),
      maxEdgeLen: 12 / cs,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      detailSampleDist: cs * 6,
      detailSampleMaxError: ch
    });
    if (!success) throw new Error('สร้างพื้นที่เดินได้ (navmesh) ไม่สำเร็จ');
    return new Navigation(navMesh, Math.round(performance.now() - started));
  }

  constructor(navMesh, buildMs) {
    this.navMesh = navMesh;
    // The default 2048-node A* pool cannot span a 570 m Map.
    this.query = new NavMeshQuery(navMesh, { maxNodes: 65535 });
    this.buildMs = buildMs;
    this.source = 'generated';
  }

  /** Path from → to as [[x,y,z], …]; null when unreachable. Points snap to the nearest walkable floor. */
  path(from, to) {
    const toVec = ([x, y, z]) => ({ x, y, z });
    const halfExtents = { x: 1.5, y: 2.5, z: 1.5 };
    // Long Maps (≈570 m) need more than the default 256 polygons per path.
    const result = this.query.computePath(toVec(from), toVec(to), { halfExtents, maxPathPolys: 4096, maxStraightPathPoints: 1024 });
    if (!result.success || result.path.length < 2) return null;
    // Callers check whether the path really reaches the goal (see shared/route.mjs).
    return result.path.map(p => [p.x, p.y, p.z]);
  }

  dispose() {
    this.query.destroy?.();
    this.navMesh.destroy?.();
  }
}
