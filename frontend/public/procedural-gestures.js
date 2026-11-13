import * as THREE from 'three';

/**
 * Placeholder motions built from keyframed bone offsets, used until a QuickMagic clip replaces the gesture
 * (gestures/manifest.json `procedural`). Offsets are Euler [x, y, z] radians applied on top of each bone's rest
 * rotation, with axes calibrated for this Avatar's T-pose rest (see avatar.js). A different Avatar needs new values.
 */

const ARMS_DOWN = { LeftArm: [1.32, 0, 0], RightArm: [1.32, 0, 0], LeftForeArm: [0, 0, 0.12], RightForeArm: [0, 0, -0.12] };
const pose = (...parts) => Object.assign({}, ARMS_DOWN, ...parts);

// Each motion: [time seconds, pose] keys. Poses list only bones that move; unlisted bones keep the rest/idle values.
export const MOTIONS = {
  idle: { loop: true, keys: [
    [0, pose({ Spine1: [0, 0, 0], Head: [0, 0, 0] })],
    [2, pose({ Spine1: [0.025, 0, 0], Head: [0.02, 0.05, 0] })],
    [4, pose({ Spine1: [0, 0, 0], Head: [0, 0, 0] })]
  ] },
  // Wai/wave/welcome values found by searching joint positions in the Avatar's frame (+z forward, right = -x):
  // wai wrists 10 cm apart at 1.39 m, 22 cm in front, fingers pointing up; wave hand 27 cm above the elbow beside the head.
  wai: { keys: (() => {
    const hands = { LeftArm: [1.41, 0.07, 0.25], RightArm: [1.41, -0.07, -0.25], LeftForeArm: [0.04, 0.57, 1.79], RightForeArm: [0.04, -0.57, -1.79],
      LeftHand: [-0.87, 0.43, 0.74], RightHand: [-0.87, -0.43, -0.74] };
    const bowed = { ...hands, Spine1: [0.12, 0, 0], Neck: [0.15, 0, 0], Head: [0.2, 0, 0] };
    return [[0, pose()], [0.6, pose(hands)], [1.0, pose(bowed)], [1.9, pose(bowed)], [2.3, pose(hands)], [2.9, pose()]];
  })() },
  wave: { keys: (() => {
    const raised = sway => ({ RightArm: [0.07, 0.4, -0.25], RightForeArm: [-0.85 + sway, 0.73, -0.57 + sway] });
    return [[0, pose()], [0.5, pose(raised(0))], [0.75, pose(raised(0.25))], [1.0, pose(raised(-0.25))], [1.25, pose(raised(0.25))],
      [1.5, pose(raised(-0.25))], [1.75, pose(raised(0.25))], [2.0, pose(raised(0))], [2.6, pose()]];
  })() },
  point: { keys: [
    [0, pose()],
    [0.5, pose({ RightArm: [0.15, 0, -1.4], RightForeArm: [0, 0, -0.05] })],
    [2.3, pose({ RightArm: [0.15, 0, -1.4], RightForeArm: [0, 0, -0.05] })],
    [2.9, pose()]
  ] },
  bow: { keys: [
    [0, pose()],
    [0.7, pose({ Spine: [0.3, 0, 0], Spine1: [0.2, 0, 0], Neck: [0.1, 0, 0], Head: [0.1, 0, 0], LeftArm: [1.4, 0, 0.1], RightArm: [1.4, 0, -0.1] })],
    [1.6, pose({ Spine: [0.3, 0, 0], Spine1: [0.2, 0, 0], Neck: [0.1, 0, 0], Head: [0.1, 0, 0], LeftArm: [1.4, 0, 0.1], RightArm: [1.4, 0, -0.1] })],
    [2.4, pose()]
  ] },
  welcome: { keys: [
    [0, pose()],
    [0.6, pose({ LeftArm: [0.75, 0.5, 0.49], RightArm: [0.75, -0.5, -0.49], LeftForeArm: [-0.57, 0.87, 0.5], RightForeArm: [-0.57, -0.87, -0.5] })],
    [1.8, pose({ LeftArm: [0.75, 0.5, 0.49], RightArm: [0.75, -0.5, -0.49], LeftForeArm: [-0.57, 0.87, 0.5], RightForeArm: [-0.57, -0.87, -0.5] })],
    [2.5, pose()]
  ] }
};

/** Build a THREE.AnimationClip for one motion against an Avatar's rest quaternions. */
export function proceduralClip(id, rest, motions = MOTIONS) {
  const motion = motions[id];
  if (!motion) throw new Error(`Unknown procedural gesture ${id}`);
  const bones = [...new Set(motion.keys.flatMap(([, keyPose]) => Object.keys(keyPose)))].filter(name => rest[name]);
  const times = motion.keys.map(([time]) => time);
  const tracks = bones.map(name => {
    const values = [];
    for (const [, keyPose] of motion.keys) {
      const [x, y, z] = keyPose[name] ?? [0, 0, 0];
      const q = rest[name].clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
  });
  return new THREE.AnimationClip(id, times.at(-1), tracks);
}
