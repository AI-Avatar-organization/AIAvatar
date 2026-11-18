import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { proceduralClip } from './procedural-gestures.js';
import { loadGlb } from './asset-loader.js';
import { pageUrl } from './base.js';
import { sourceRig, restOf, isNormalized, retargetClip } from './retarget.js';

/**
 * Load the Gesture Library (gestures/manifest.json via /api/gestures) and turn every entry into an AnimationClip
 * for this Avatar. Clip files keep only bone rotations and the Hips height, so a clip can never move the Avatar
 * away from where locomotion put it.
 */
export async function loadGestureLibrary(avatar) {
  const response = await fetch(pageUrl('api/gestures'));
  if (!response.ok) throw new Error((await response.json()).error ?? 'gestures unavailable');
  const library = await response.json();
  const loader = new GLTFLoader();
  const bones = new Set(Object.keys(avatar.bones));

  // Clips are authored on the Avaturn skeleton. A VRM-normalized Avatar (CoolBanana) needs them retargeted;
  // the source rest pose comes from the first clip file, which carries that skeleton.
  const firstFile = [library.locomotion.walk, library.locomotion.idle, ...library.gestures].find(entry => entry?.file)?.file;
  const rig = isNormalized(avatar) && firstFile ? sourceRig((await loadGlb(loader, pageUrl(`gestures/${firstFile}`))).scene) : null;
  const adapt = clip => rig ? retargetClip(clip, rig, { hipsHeight: avatar.restPosition.Hips?.y }) : clip;

  const fromFile = async (file, id) => {
    const gltf = await loadGlb(loader, pageUrl(`gestures/${file}`));
    const source = gltf.animations[0];
    if (!source) throw new Error(`${file} has no animation`);
    const tracks = adapt(source).tracks.filter(track => {
      const [node, property] = track.name.split('.');
      if (!bones.has(node)) return false;
      if (property === 'quaternion') return true;
      return node === 'Hips' && property === 'position';
    }).map(track => {
      if (!track.name.startsWith('Hips.position')) return track;
      // Keep only the vertical bob/sit height; horizontal travel belongs to locomotion.
      const rest = avatar.bones.Hips.position;
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 3) { values[i] = rest.x; values[i + 2] = rest.z; }
      return new THREE.VectorKeyframeTrack(track.name, track.times, values);
    });
    return new THREE.AnimationClip(id, source.duration, tracks);
  };
  const clipFor = (entry, id) => entry.procedural ? adapt(proceduralClip(entry.procedural, rig ? restOf(rig) : avatar.rest)) : fromFile(entry.file, id);

  const [idle, walk, ...gestureClips] = await Promise.all([
    clipFor(library.locomotion.idle, 'idle'),
    library.locomotion.walk ? clipFor(library.locomotion.walk, 'walk') : null,
    ...library.gestures.map(gesture => clipFor(gesture, gesture.id))
  ]);
  const gestures = new Map(library.gestures.map((gesture, index) => [gesture.id, { clip: gestureClips[index], loop: gesture.loop }]));
  avatar.setClips({ idle, walk, gestures });
  return library.gestures;
}
