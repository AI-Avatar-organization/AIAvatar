import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * In-browser motion converter (no Blender on the server): QuickMagic / Mixamo .fbx or .bvh → small clip .glb
 * on this Avatar's skeleton. Same method as scripts/retarget-gesture.py: per frame, each source bone's world
 * rotation relative to its rest pose is applied on top of the matching Avatar bone's rest pose (both rigs in
 * T-pose; bone rolls may differ). Hips keep only vertical motion so the Avatar stays where locomotion put it.
 */

export const GLB_MAGIC = 0x46546C67;
const FPS = 30;
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const BODY = { pelvis: 'hips', spine01: 'spine', spine02: 'spine1', spine03: 'spine2', chest: 'spine1', upperchest: 'spine2',
  neck01: 'neck', clavicle: 'shoulder', upperarm: 'arm', lowerarm: 'forearm', thigh: 'upleg', upperleg: 'upleg',
  calf: 'leg', lowerleg: 'leg', ball: 'toebase', toes: 'toebase' };

/** Mixamo (mixamorig:LeftArm), Unity Humanoid (Left_UpperArm), Unreal (upperarm_l) → one key (leftarm). */
export function canonicalBone(name) {
  let key = String(name).split(/[:|]/).pop().replace(/^mixamorig\d*/i, '').toLowerCase().replace(/[\s.]/g, '');
  let side = '';
  let m = key.match(/^(left|right)_?(.*)$/);
  if (m) [, side, key] = m;
  else if ((m = key.match(/^(.+?)_(l|r)$/))) { side = m[2] === 'l' ? 'left' : 'right'; key = m[1]; } // Unreal: upperarm_l
  key = key.replace(/_/g, '');
  key = BODY[key] ?? key;
  for (const finger of FINGERS) {
    for (const [suffix, index] of [['proximal', 1], ['intermediate', 2], ['distal', 3], ['01', 1], ['02', 2], ['03', 3]]) if (key === finger + suffix) key = `hand${finger}${index}`;
    if (new RegExp(`^${finger}[123]$`).test(key)) key = 'hand' + key;
  }
  return side + key;
}

export function isGlb(buffer) {
  return buffer.byteLength >= 12 && new DataView(buffer).getUint32(0, true) === GLB_MAGIC;
}

/** Parse a motion file into { root, clip } where root is an Object3D hierarchy the clip animates. */
async function readSource(buffer, extension) {
  if (extension === 'fbx') {
    const group = new FBXLoader().parse(buffer, '');
    const clip = group.animations[0];
    if (!clip) throw new Error('ไฟล์ FBX ไม่มี animation');
    return { root: group, clip };
  }
  if (extension === 'bvh') {
    const { skeleton, clip } = new BVHLoader().parse(new TextDecoder().decode(buffer));
    const root = new THREE.Group();
    root.add(skeleton.bones[0]);
    // BVHLoader names tracks ".bones[Name].prop"; bind them by node name instead.
    clip.tracks.forEach(track => { track.name = track.name.replace(/^\.bones\[(.+?)\]/, '$1'); });
    return { root, clip };
  }
  throw new Error(`ไม่รองรับไฟล์ .${extension}`);
}

const bonesOf = root => {
  const bones = [];
  root.traverse(object => { if (object.isBone || object.type === 'Bone') bones.push(object); });
  return bones;
};

/**
 * Convert a .fbx/.bvh buffer to a clip GLB for this Avatar.
 * avatar: the runtime Avatar (needs .model with the rest-pose skeleton and .rest local quaternions).
 * Returns { glb: ArrayBuffer, bones, frames, duration, bytes }.
 */
export async function convertMotion(buffer, extension, avatar, name = 'gesture') {
  const { root: source, clip } = await readSource(buffer, extension);
  source.updateMatrixWorld(true);

  // Target: a rest-pose copy of the Avatar's bone hierarchy (no meshes), also used as the export root.
  const targetRoot = new THREE.Object3D();
  targetRoot.name = 'AvatarRig';
  const targetBones = new Map();
  const copy = (bone, parent) => {
    const node = new THREE.Object3D();
    node.name = bone.name;
    node.position.copy(avatar.restPosition?.[bone.name] ?? bone.position);
    node.quaternion.copy(avatar.rest[bone.name] ?? bone.quaternion);
    node.scale.copy(bone.scale);
    parent.add(node);
    targetBones.set(bone.name, node);
    for (const child of bone.children) if (child.isBone) copy(child, node);
  };
  const hips = avatar.bones.Hips;
  // Keep the transforms above Hips (armature node) so world space matches the real Avatar.
  hips.parent.updateWorldMatrix(true, false);
  const holder = new THREE.Object3D();
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(hips.parent.matrixWorld).premultiply(avatar.root.matrixWorld.clone().invert());
  targetRoot.add(holder);
  copy(hips, holder);
  targetRoot.updateMatrixWorld(true);

  const sourceByKey = new Map();
  for (const bone of bonesOf(source)) if (!sourceByKey.has(canonicalBone(bone.name))) sourceByKey.set(canonicalBone(bone.name), bone);
  const pairs = [...targetBones.keys()].map(name => [sourceByKey.get(canonicalBone(name)), name]).filter(([s]) => s);
  if (pairs.length < 15) throw new Error(`จับคู่กระดูกได้แค่ ${pairs.length} ชิ้น ต้องเป็นโครงกระดูกแบบ Mixamo / Unity / Unreal`);

  const worldQ = object => object.getWorldQuaternion(new THREE.Quaternion());
  const worldP = object => object.getWorldPosition(new THREE.Vector3());
  // Rest poses: evaluate the source at its bind pose (before the mixer touches it).
  const srcRest = new Map(pairs.map(([s]) => [s, worldQ(s)]));
  const tgtRest = new Map(pairs.map(([, t]) => [t, worldQ(targetBones.get(t))]));
  const srcHips = sourceByKey.get('hips');
  const tgtHips = targetBones.get('Hips');
  const srcHipsRest = srcHips && worldP(srcHips);
  const tgtHipsRest = worldP(tgtHips);
  const ratio = srcHipsRest && Math.abs(srcHipsRest.y) > 1e-4 ? tgtHipsRest.y / srcHipsRest.y : 1;

  const mixer = new THREE.AnimationMixer(source);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = Array.from({ length: frames }, (_, i) => Math.min(clip.duration, i / FPS));
  const ordered = pairs.sort((a, b) => depth(targetBones.get(a[1])) - depth(targetBones.get(b[1])));
  const values = new Map(ordered.map(([, t]) => [t, new Float32Array(frames * 4)]));
  const hipsValues = new Float32Array(frames * 3);
  const parentInverse = new THREE.Quaternion();

  times.forEach((time, frame) => {
    mixer.setTime(time);
    source.updateMatrixWorld(true);
    for (const [s, t] of ordered) {
      const node = targetBones.get(t);
      const delta = worldQ(s).multiply(srcRest.get(s).clone().invert());
      const desired = delta.multiply(tgtRest.get(t));
      parentInverse.copy(worldQ(node.parent)).invert();
      node.quaternion.copy(parentInverse.multiply(desired));
      node.updateMatrixWorld(true);
      node.quaternion.toArray(values.get(t), frame * 4);
    }
    const local = tgtHips.position.clone();
    if (srcHips) {
      const lift = (worldP(srcHips).y - srcHipsRest.y) * ratio;
      const target = tgtHipsRest.clone().add(new THREE.Vector3(0, lift, 0)); // X and Z locked: stays in place
      tgtHips.parent.worldToLocal(local.copy(target));
    }
    local.toArray(hipsValues, frame * 3);
  });
  mixer.stopAllAction();

  // Reset to rest for export, keep only tracks that actually move (fingers are often constant).
  for (const [name, node] of targetBones) node.quaternion.copy(avatar.rest[name] ?? node.quaternion);
  const tracks = [];
  for (const [name, data] of values) {
    if (!moves(data, 4)) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, data));
  }
  if (moves(hipsValues, 3)) tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsValues));
  const output = new THREE.AnimationClip(name, clip.duration, tracks).optimize();

  const glb = await new GLTFExporter().parseAsync(targetRoot, { binary: true, animations: [output] });
  return { glb, bones: pairs.length, frames, duration: clip.duration, bytes: glb.byteLength, tracks: tracks.length };
}

const depth = node => { let d = 0; for (let p = node.parent; p; p = p.parent) d += 1; return d; };
const moves = (data, stride) => {
  for (let i = stride; i < data.length; i += 1) if (Math.abs(data[i] - data[i % stride]) > 1e-4) return true;
  return false;
};
