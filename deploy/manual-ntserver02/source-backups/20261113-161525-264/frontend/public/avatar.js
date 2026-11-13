import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const WALK_SPEED = 1.35;       // m/s
const MAX_TRIP_SECONDS = 15;   // long trips speed up so a walk across the whole Map stays short
const MAX_SPEED = 12;          // m/s
const TURN_SPEED = 6;          // rad/s
const ARRIVE = 0.08;           // m

const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Avatar runtime: a cloned copy of the supplied Avatar GLB (never mutated on disk), locomotion along navmesh paths,
 * and animation through one AnimationMixer that blends idle, walk and a Gesture clip (ADR 0003).
 * Before the Gesture Library loads, a procedural idle/walk pose keeps the Avatar out of its T-pose.
 */
export class Avatar {
  static async load(url = '/assets/avatar.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Avatar(clone(gltf.scene), gltf.animations);
  }

  constructor(root, animations = []) {
    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.model = root;
    this.root.add(root);
    this.animations = animations;
    this.mixer = new THREE.AnimationMixer(root);
    this.bones = {};
    root.traverse(object => {
      if (object.isBone) this.bones[object.name.replace(/^mixamorig:?/, '')] = object;
      if (object.isMesh) { object.castShadow = true; object.frustumCulled = false; }
    });
    this.rest = Object.fromEntries(Object.entries(this.bones).map(([name, bone]) => [name, bone.quaternion.clone()]));
    this.restPosition = Object.fromEntries(Object.entries(this.bones).map(([name, bone]) => [name, bone.position.clone()]));
    this.phase = 0;
    this.time = 0;
    this.walkBlend = 0;
    this.state = 'idle';
    this.target = null;
    this.groundAt = null;
    this.listeners = new Set();
    this.height = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 1.75;
    this.actions = null;
    this.gesture = null;      // { id, action, loop, resolve }
    this.gestureWeight = 0;
    this.mixer.addEventListener('finished', event => {
      if (this.gesture?.action === event.action) this.#endGesture(true);
    });
  }

  /** Install clips: { idle, walk?, gestures: Map(id → { clip, loop }) }. Switches from procedural pose to the mixer. */
  setClips({ idle, walk, gestures }) {
    this.mixer.stopAllAction();
    const idleAction = this.mixer.clipAction(idle);
    idleAction.setLoop(THREE.LoopRepeat).play();
    const walkAction = walk ? this.mixer.clipAction(walk).setLoop(THREE.LoopRepeat).play() : null;
    walkAction?.setEffectiveWeight(0);
    this.actions = { idle: idleAction, walk: walkAction, gestures };
    this.root.children[0].position.y = 0;
  }

  gestureIds() { return [...(this.actions?.gestures.keys() ?? [])]; }

  /**
   * Play a Gesture. One-shot gestures resolve true when finished (false if interrupted); looping gestures
   * (e.g. sit) resolve once started and hold until the next walk, gesture or stop.
   */
  playGesture(id) {
    const entry = this.actions?.gestures.get(id);
    if (!entry) return Promise.resolve(false);
    this.cancel();
    this.#endGesture(false);
    if (this.fading) { this.fading.stop(); this.fading = null; } // the new gesture takes over at the current weight
    const action = this.mixer.clipAction(entry.clip);
    action.reset();
    action.setLoop(entry.loop ? THREE.LoopRepeat : THREE.LoopOnce, entry.loop ? Infinity : 1);
    action.clampWhenFinished = !entry.loop;
    action.setEffectiveWeight(1).play();
    this.#setState('gesture');
    this.#emit({ type: 'gesture-start', id });
    return new Promise(resolve => {
      this.gesture = { id, action, loop: entry.loop, resolve };
      if (entry.loop) resolve(true);
    });
  }

  stopGesture() { this.#endGesture(false); }

  #endGesture(finished) {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.fading = gesture.action;   // fade the finished pose back into idle
    if (this.state === 'gesture') this.#setState('idle');
    this.#emit({ type: 'gesture-end', id: gesture.id, finished });
    gesture.resolve(finished);
  }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  #emit(event) { for (const listener of this.listeners) listener(event, this); }
  #setState(state) { if (this.state !== state) { this.state = state; this.#emit({ type: 'state', state }); } }

  place(position, facing = 0) {
    this.cancel();
    this.root.position.fromArray(position);
    this.root.rotation.set(0, facing, 0);
    this.#emit({ type: 'moved' });
  }

  /**
   * Walk to [x,y,z] then turn to facing. path (from Navigation) is a list of [x,y,z] waypoints ending at the goal;
   * without it the Avatar walks straight over the ground sampler. Resolves true on arrival, false if cancelled.
   */
  walkTo(position, facing, meta = {}, path = null) {
    this.cancel();
    this.#endGesture(false);
    const waypoints = (path?.length ? path.slice(1) : [position]).map(p => new THREE.Vector3().fromArray(p));
    waypoints[waypoints.length - 1] = new THREE.Vector3().fromArray(position);
    return new Promise(resolve => {
      let distance = 0;
      let previous = this.root.position;
      for (const point of waypoints) { distance += Math.hypot(point.x - previous.x, point.z - previous.z); previous = point; }
      const speed = this.flash ? 60 : THREE.MathUtils.clamp(distance / MAX_TRIP_SECONDS, WALK_SPEED, MAX_SPEED);
      this.target = { position: waypoints.at(-1), waypoints, index: 0, onPath: Boolean(path), segmentStart: this.root.position.clone(),
        facing, resolve, meta, speed, distance };
      this.#setState('walking');
      this.#emit({ type: 'walk-start', target: position, facing, meta });
    });
  }

  cancel() {
    if (!this.target) return;
    const { resolve } = this.target;
    this.target = null;
    this.#setState('idle');
    resolve(false);
  }

  update(dt) {
    this.time += dt;
    this.mixer.update(dt);
    // Locomotion in ≤ 50 ms steps so low frame rates cannot overshoot waypoints.
    for (let left = dt; left > 1e-6; left -= 0.05) this.#move(Math.min(0.05, left));
    if (this.actions) this.#blend(dt); else this.#pose();
  }

  #move(dt) {
    const target = this.target;
    if (target) {
      const here = this.root.position;
      let goal = target.waypoints[target.index];
      let delta = new THREE.Vector3(goal.x - here.x, 0, goal.z - here.z);
      // Pass intermediate waypoints without stopping.
      while (delta.length() <= ARRIVE * 2 && target.index < target.waypoints.length - 1) {
        target.segmentStart = goal.clone();
        target.index += 1;
        goal = target.waypoints[target.index];
        delta = new THREE.Vector3(goal.x - here.x, 0, goal.z - here.z);
      }
      const distance = delta.length();
      const last = target.index === target.waypoints.length - 1;
      if (distance > ARRIVE || !last) {
        const heading = Math.atan2(delta.x, delta.z);
        const turn = angleTo(this.root.rotation.y, heading);
        this.root.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), TURN_SPEED * dt);
        const step = Math.min(distance, target.speed * dt * (Math.abs(turn) > 1.2 ? 0.3 : 1));
        here.addScaledVector(delta.normalize(), step);
        const remaining = distance - step;
        let goalY;
        if (target.onPath) {
          // Height follows the navmesh path segment; floor raycast refines it within a small band (stairs detail).
          const start = target.segmentStart;
          const span = Math.hypot(goal.x - start.x, goal.z - start.z);
          const along = span > 1e-4 ? 1 - remaining / span : 1;
          const pathY = THREE.MathUtils.lerp(start.y, goal.y, THREE.MathUtils.clamp(along, 0, 1));
          const ground = this.groundAt?.(here.x, here.z, pathY + 0.3, 0.3, 0.6);
          goalY = ground ?? pathY;
        } else {
          const ground = this.groundAt?.(here.x, here.z, here.y);
          goalY = ground ?? THREE.MathUtils.lerp(here.y, target.position.y, Math.min(1, step / Math.max(remaining + step, 1e-6)));
        }
        here.y = THREE.MathUtils.damp(here.y, goalY, 18, dt);
        this.phase += dt * 7.2 * Math.sqrt(target.speed / WALK_SPEED);
        this.walkBlend = Math.min(1, this.walkBlend + dt * 4);
      } else {
        here.x = target.position.x;
        here.z = target.position.z;
        here.y = target.position.y;
        const turn = Number.isFinite(target.facing) ? angleTo(this.root.rotation.y, target.facing) : 0;
        this.root.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), TURN_SPEED * dt);
        this.walkBlend = Math.max(0, this.walkBlend - dt * 5);
        if (Math.abs(turn) < 0.02) {
          this.target = null;
          this.#setState('idle');
          this.#emit({ type: 'arrived', meta: target.meta });
          target.resolve(true);
        }
      }
      this.#emit({ type: 'moved' });
    } else {
      this.walkBlend = Math.max(0, this.walkBlend - dt * 5);
    }
  }

  /** Mixer weights: gesture fades in over idle/walk; a finished gesture fades back out. */
  #blend(dt) {
    const target = this.gesture ? 1 : 0;
    this.gestureWeight = THREE.MathUtils.clamp(this.gestureWeight + Math.sign(target - this.gestureWeight) * dt * 4, 0, 1);
    const g = this.gestureWeight;
    const { idle, walk } = this.actions;
    const w = walk ? this.walkBlend : 0;
    idle.setEffectiveWeight((1 - w) * (1 - g));
    if (walk) {
      walk.setEffectiveWeight(w * (1 - g));
      walk.timeScale = THREE.MathUtils.clamp((this.target?.speed ?? WALK_SPEED) / WALK_SPEED, 0.8, 2.5);
    }
    if (this.gesture) this.gesture.action.setEffectiveWeight(g);
    if (this.fading) {
      this.fading.setEffectiveWeight(g);
      if (g === 0) { this.fading.stop(); this.fading = null; }
    }
  }

  #rotate(name, x = 0, y = 0, z = 0) {
    const bone = this.bones[name];
    if (!bone) return;
    bone.quaternion.copy(this.rest[name]).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  }

  /** Procedural pose: arms relaxed down, breathing idle, walk cycle blended by walkBlend. */
  #pose() {
    if (this.gestureActive) return;
    const w = this.walkBlend;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const breathe = Math.sin(this.time * 1.6) * 0.02;
    // Axes calibrated in the browser for this Avatar's T-pose rest (2026-11-10):
    // UpLeg +X = leg forward, Leg -X = knee bend, Arm +X = arm down, Arm Z = swing (left +Z forward, right -Z forward),
    // ForeArm Z = elbow bend (left +, right -). A different Avatar must be re-calibrated.
    this.#rotate('LeftUpLeg', s * 0.5 * w, 0, 0);
    this.#rotate('RightUpLeg', -s * 0.5 * w, 0, 0);
    this.#rotate('LeftLeg', -Math.max(0, -c) * 0.9 * w, 0, 0);
    this.#rotate('RightLeg', -Math.max(0, c) * 0.9 * w, 0, 0);
    this.#rotate('Spine', 0.03 * w + breathe, s * 0.05 * w, 0);
    this.#rotate('Spine1', breathe, 0, 0);
    this.#rotate('LeftArm', 1.32, 0, -s * 0.35 * w);
    this.#rotate('RightArm', 1.32, 0, -s * 0.35 * w);
    this.#rotate('LeftForeArm', 0, 0, 0.12 + 0.2 * w);
    this.#rotate('RightForeArm', 0, 0, -0.12 - 0.2 * w);
    this.root.children[0].position.y = Math.abs(Math.sin(this.phase)) * 0.03 * w;
  }
}
