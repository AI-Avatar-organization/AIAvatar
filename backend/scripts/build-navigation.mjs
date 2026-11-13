/** Compile walking paths once in the packaged runtime: node scripts/build-navigation.mjs */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportNavMesh } from '@recast-navigation/core';
import { Navigation } from '../public/navigation.js';
import { loadRegistry } from '../server/maps.mjs';
import { navigationFingerprint, navigationInputs, NAVIGATION_FORMAT } from '../server/navigation.mjs';
import { planRoute } from '../shared/route.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const mapsDir = join(root, 'maps');
const assetsDir = join(root, 'assets');
const outputDir = join(root, 'navigation');

// Keep geometry and binary offsets, but skip image decoding in the headless loader.
function geometryOnlyGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('Expected GLB');
  const jsonLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives) delete primitive.material;
  }
  delete document.materials;
  delete document.images;
  delete document.textures;
  delete document.samplers;
  const json = Buffer.from(JSON.stringify(document));
  const padding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const remaining = buffer.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + json.length + padding.length + remaining.length, 8);
  header.writeUInt32LE(json.length + padding.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json, padding, remaining]);
}

const registry = await loadRegistry(mapsDir);
if (registry.errors.length) throw new Error(registry.errors.join('\n'));
await mkdir(outputDir, { recursive: true });
const manifest = { format: NAVIGATION_FORMAT, maps: {} };
for (const map of registry.maps.values()) {
  const loader = new GLTFLoader();
  const models = [];
  for (const file of navigationInputs(map, mapsDir, assetsDir)) {
    const buffer = geometryOnlyGlb(await readFile(file));
    models.push(await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), ''));
  }
  const group = new THREE.Group();
  models[0].scene.scale.setScalar(map.unitScale);
  group.add(models[0].scene);
  map.assets.forEach((asset, index) => {
    const object = models[index + 1].scene;
    object.name = 'asset:' + asset.id;
    object.position.fromArray(asset.position);
    object.rotation.y = asset.rotationY;
    object.scale.setScalar(asset.scale);
    group.add(object);
  });
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const extent = Math.max(size.x, size.z, 10);
  const groundNames = new Set(map.ground);
  const meshes = [];
  group.traverse(object => {
    if (object.isMesh && (!groundNames.size || groundNames.has(object.name))) meshes.push(object);
  });
  if (map.groundPlane !== false) {
    const plane = new THREE.Mesh(new THREE.CircleGeometry(extent * 0.9, 64));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(center.x, bounds.min.y - 0.002, center.z);
    plane.updateMatrixWorld(true);
    meshes.push(plane);
  }
  const exclude = new RegExp(map.navigation.exclude, 'i');
  const navigation = await Navigation.build(meshes.filter(mesh => !exclude.test(mesh.name)), { extent });
  for (const station of map.stations) {
    const route = planRoute((from, to) => navigation.path(from, to), map.spawn.position, station.position, map.connectors);
    if (!route) throw new Error('Compiled navigation cannot reach Station: ' + map.id + '/' + station.id);
  }
  const fingerprint = await navigationFingerprint(map, mapsDir, assetsDir);
  const file = map.id + '-' + fingerprint + '.bin';
  const bytes = exportNavMesh(navigation.navMesh);
  await writeFile(join(outputDir, file), bytes);
  manifest.maps[map.id] = { fingerprint, file, bytes: bytes.length };
  console.log(JSON.stringify({ map: map.id, bytes: bytes.length, buildMs: navigation.buildMs, stationsVerified: map.stations.length }));
  navigation.dispose();
}
await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
