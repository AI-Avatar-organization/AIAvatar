import * as THREE from 'three';

/**
 * Retarget Gesture clips authored on the Avaturn/Mixamo skeleton to a VRM "normalized" skeleton
 * (every bone rests with identity rotation, as in CoolBanana). Same method as three-vrm's Mixamo loader:
 * a key's local rotation q becomes the world-space change  parentRestWorld · q · restWorld⁻¹,
 * which a bone with identity rest can use as its local rotation directly. VRM 0.x faces −Z, so x and z flip.
 */

/** Rest pose of the source skeleton: bare bone name → { local, world, parentWorld, position } (quaternions in model space). */
export function sourceRig(scene) {
  scene.updateMatrixWorld(true);
  const rig = {};
  scene.traverse(object => {
    if (!object.isBone && !/^(mixamorig)?Hips$/.test(object.name) && !object.parent?.isBone) return;
    const name = object.name.replace(/^mixamorig:?/, '');
    rig[name] = {
      local: object.quaternion.clone(),
      world: object.getWorldQuaternion(new THREE.Quaternion()),
      parentWorld: object.parent ? object.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
      position: object.position.clone()
    };
  });
  return rig;
}

/** Local rest quaternions of the source rig (what proceduralClip expects). */
export const restOf = rig => Object.fromEntries(Object.entries(rig).map(([name, bone]) => [name, bone.local]));

/** True when every bone of the Avatar rests with identity rotation (VRM normalized humanoid). */
export function isNormalized(avatar) {
  const rests = Object.values(avatar.rest);
  return rests.length > 0 && rests.every(q => Math.abs(q.w) > 0.9999);
}

export function retargetClip(clip, rig, { flip = true, hipsHeight } = {}) {
  const q = new THREE.Quaternion();
  const tracks = clip.tracks.map(track => {
    const [name, property] = track.name.split('.');
    const bone = rig[name];
    if (!bone) return track;
    const values = track.values.slice();
    if (property === 'quaternion') {
      const restInverse = bone.world.clone().invert();
      for (let i = 0; i < values.length; i += 4) {
        q.fromArray(values, i).premultiply(bone.parentWorld).multiply(restInverse);
        if (flip) { q.x = -q.x; q.z = -q.z; }
        q.toArray(values, i);
      }
      return new THREE.QuaternionKeyframeTrack(track.name, track.times, values);
    }
    if (property === 'position' && name === 'Hips' && hipsHeight) {
      const scale = hipsHeight / bone.position.y; // smaller Avatar → proportionally smaller bob/sit drop
      for (let i = 0; i < values.length; i += 3) values[i + 1] *= scale;
      return new THREE.VectorKeyframeTrack(track.name, track.times, values);
    }
    return track;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
