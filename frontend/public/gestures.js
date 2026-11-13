import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { proceduralClip } from './procedural-gestures.js';
import { loadGlb } from './asset-loader.js';

/**
 * Load the Gesture Library (gestures/manifest.json via /api/gestures) and turn every entry into an AnimationClip
 * for this Avatar. Clip files keep only bone rotations and the Hips height, so a clip can never move the Avatar
 * away from where locomotion put it.
 */
export async function loadGestureLibrary(avatar) {
  const response = await fetch('/aiavatar/api/gestures');
  if (!response.ok) throw new Error((await response.json()).error ?? 'gestures unavailable');
  const library = await response.json();
  const loader = new GLTFLoader();
  const bones = new Set(Object.keys(avatar.bones));

  const fromFile = async (file, id) => {
    const gltf = await loadGlb(loader, `/aiavatar/gestures/${file}`);
    const source = gltf.animations[0];
    if (!source) throw new Error(`${file} has no animation`);
    const tracks = source.tracks.filter(track => {
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
  const clipFor = (entry, id) => entry.procedural ? proceduralClip(entry.procedural, avatar.rest) : fromFile(entry.file, id);

  const [idle, walk, ...gestureClips] = await Promise.all([
    clipFor(library.locomotion.idle, 'idle'),
    library.locomotion.walk ? clipFor(library.locomotion.walk, 'walk') : null,
    ...library.gestures.map(gesture => clipFor(gesture, gesture.id))
  ]);
  const gestures = new Map(library.gestures.map((gesture, index) => [gesture.id, { clip: gestureClips[index], loop: gesture.loop }]));
  avatar.setClips({ idle, walk, gestures });
  return library.gestures;
}
