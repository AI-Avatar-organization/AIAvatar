import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Navigation } from './navigation.js';
import { loadGlb } from './asset-loader.js';
import { pageUrl } from './base.js';

/** Three.js stage that hosts one Map at a time. Map content always comes from its Map Package. */
export class World {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    container.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dfe9ee');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a62', 1.6));
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.position.set(30, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun, this.sun.target);

    this.mapRoot = null;
    this.meshes = [];
    this.raycaster = new THREE.Raycaster();
    this.timer = new THREE.Timer();
    this.updaters = new Set();
    this.follow = null;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async loadMap(map, { onProgress = () => {} } = {}) {
    this.faded?.clear();
    if (this.mapRoot) {
      this.scene.remove(this.mapRoot);
      this.mapRoot.traverse(o => { o.geometry?.dispose?.(); });
    }
    const loader = new GLTFLoader();
    onProgress('model');
    // Compiled walking paths download while the models load; the Map stays usable if they fail.
    const prepared = map.navigation.prebuilt
      ? Navigation.load(pageUrl(map.navigation.prebuilt)).then(navigation => ({ navigation }), error => ({ error }))
      : null;
    const urlOf = file => pageUrl(file.startsWith('/') ? file : `maps/${map.id}/${file}`);
    const [base, ...placed] = await Promise.all([map.scene, ...map.assets.map(a => a.file)].map(file => loadGlb(loader, urlOf(file))));
    const root = new THREE.Group();
    root.name = `map:${map.id}`;
    const terrain = base.scene;
    terrain.scale.setScalar(map.unitScale);
    root.add(terrain);
    // Assets are composed into the same Map so one world holds the terrain and every placed building/prop.
    map.assets.forEach((asset, index) => {
      const object = placed[index].scene;
      object.name = `asset:${asset.id}`;
      object.userData.asset = asset;
      object.position.fromArray(asset.position);
      object.rotation.y = asset.rotationY;
      object.scale.setScalar(asset.scale);
      root.add(object);
    });
    root.updateMatrixWorld(true);
    this.meshes = [];
    const groundNames = new Set(map.ground);
    root.traverse(object => {
      if (!object.isMesh) return;
      object.receiveShadow = true;
      object.castShadow = true;
      if (!groundNames.size || groundNames.has(object.name)) this.meshes.push(object);
    });
    this.mapRoot = root;
    this.scene.add(root);
    this.bounds = new THREE.Box3().setFromObject(root);
    const size = this.bounds.getSize(new THREE.Vector3());
    const center = this.bounds.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 10);
    // Many supplied scenes are a building without terrain: add a walkable ground plane at the lowest point.
    this.groundPlane?.removeFromParent();
    if (map.groundPlane !== false) {
      const plane = new THREE.Mesh(new THREE.CircleGeometry(extent * 0.9, 64),
        new THREE.MeshStandardMaterial({ color: '#c9c2ad', roughness: 1 }));
      plane.name = 'runtime-ground-plane';
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(center.x, this.bounds.min.y - 0.002, center.z);
      plane.receiveShadow = true;
      this.scene.add(plane);
      this.groundPlane = plane;
      this.meshes.push(plane);
    }
    this.sun.position.copy(center).add(new THREE.Vector3(extent * 0.4, extent, extent * 0.3));
    this.sun.target.position.copy(center);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -extent / 2; cam.right = cam.top = extent / 2; cam.far = extent * 3;
    cam.updateProjectionMatrix();
    this.camera.far = extent * 10;
    this.camera.updateProjectionMatrix();
    if (map.camera) {
      this.camera.position.fromArray(map.camera.position);
      this.controls.target.fromArray(map.camera.target);
    } else {
      this.controls.target.copy(center);
      this.camera.position.copy(center).add(new THREE.Vector3(extent * 0.6, extent * 0.5, extent * 0.6));
    }
    this.controls.update();
    this.navigation?.dispose();
    this.navigation = null;
    try {
      onProgress('navigation');
      const cached = prepared ? await prepared : null;
      if (cached?.error) console.warn('Prepared walking paths unavailable; rebuilding:', cached.error);
      const exclude = new RegExp(map.navigation.exclude, 'i');
      this.navigation = cached?.navigation ?? await Navigation.build(this.meshes.filter(m => !exclude.test(m.name)), { extent });
      console.info(`navmesh ${map.id}: ${this.navigation.source}, ${this.navigation.loadMs ?? this.navigation.buildMs} ms`);
    } catch (error) {
      console.warn('Navigation unavailable, falling back to straight-line walking:', error);
    }
    return { size, center };
  }

  /** Floor height under (x,z): first hit casting down from just above fromY (avoids roofs). */
  groundAt(x, z, fromY, stepUp = 0.6, maxDrop = 4) {
    this.raycaster.set(new THREE.Vector3(x, fromY + stepUp, z), new THREE.Vector3(0, -1, 0));
    this.raycaster.far = stepUp + maxDrop;
    const hit = this.raycaster.intersectObjects(this.meshes, false).find(h => !h.object.userData.ignoreGround);
    return hit ? hit.point.y : null;
  }

  /** Raycast from a pointer event into the Map. */
  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    this.raycaster.far = Infinity;
    return this.raycaster.intersectObjects(this.meshes, false)[0] ?? null;
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(vector) {
    const v = vector.clone().project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * this.container.clientWidth, y: (1 - v.y) / 2 * this.container.clientHeight };
  }

  /** Keep the orbit target on an object while letting the user orbit freely. */
  followObject(object, height = 1) {
    this.follow = { object, height, last: object.position.clone() };
  }

  focusOn(position, distance = 6) {
    const target = new THREE.Vector3().fromArray(position).add(new THREE.Vector3(0, 1, 0));
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(distance);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
  }

  /** Fade Map meshes that block the view of the followed object (roofs, walls). */
  #updateOcclusion() {
    if (!this.follow || !this.mapRoot) return;
    this.faded ??= new Map();
    const head = this.follow.object.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    const direction = head.clone().sub(this.camera.position);
    const distance = direction.length();
    this.raycaster.set(this.camera.position, direction.normalize());
    this.raycaster.far = distance - 0.3;
    const blocking = new Set(this.raycaster.intersectObjects(this.mapRoot.children, true).filter(h => h.object.isMesh).map(h => h.object));
    for (const [mesh, original] of this.faded) {
      if (!blocking.has(mesh)) { mesh.material = original; this.faded.delete(mesh); }
    }
    for (const mesh of blocking) {
      if (this.faded.has(mesh)) continue;
      this.faded.set(mesh, mesh.material);
      const fade = m => Object.assign(m.clone(), { transparent: true, opacity: 0.18, depthWrite: false });
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fade) : fade(mesh.material);
    }
  }

  #frame() {
    this.timer.update();
    // Real elapsed time (capped) so animations keep wall-clock speed on slow devices; movers sub-step internally.
    const dt = Math.min(this.timer.getDelta(), 0.25);
    for (const update of this.updaters) update(dt);
    if ((this.frameCount = (this.frameCount ?? 0) + 1) % 4 === 0) this.#updateOcclusion();
    if (this.follow) {
      const { object, last } = this.follow;
      const delta = object.position.clone().sub(last);
      if (delta.lengthSq() > 0) {
        this.controls.target.add(delta);
        this.camera.position.add(delta);
        last.copy(object.position);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
