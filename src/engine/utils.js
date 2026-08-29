import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Frame-rate independent easing towards a target (rate ≈ how fast, per second). */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Deterministic PRNG for seeded levels. */
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ meshes */

export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.06, ...opts,
  });
}

export function glow(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.75, roughness: 0.35, ...opts,
  });
}

function finish(mesh, { cast = true, receive = true, pos } = {}) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
  return mesh;
}

export function box(w, h, d, color = 0xffffff, opts = {}) {
  const m = color?.isMaterial ? color : mat(color, opts.material);
  return finish(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), opts);
}

export function ball(r, color = 0xffffff, opts = {}) {
  const m = color?.isMaterial ? color : mat(color, opts.material);
  return finish(new THREE.Mesh(new THREE.SphereGeometry(r, opts.seg || 28, opts.seg || 20), m), opts);
}

export function cyl(rt, rb, h, color = 0xffffff, opts = {}) {
  const m = color?.isMaterial ? color : mat(color, opts.material);
  return finish(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, opts.seg || 24), m), opts);
}

export function torus(r, tube, color = 0xffffff, opts = {}) {
  const m = color?.isMaterial ? color : mat(color, opts.material);
  return finish(new THREE.Mesh(new THREE.TorusGeometry(r, tube, opts.seg || 14, opts.rings || 40), m), opts);
}

export function ground(size = 200, color = 0x1b2338, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    mat(color, { roughness: 0.95, metalness: 0, ...opts.material }),
  );
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ scenery */

export function lights(scene, { sun = 0xffffff, sky = 0x9fc4ff, groundCol = 0x2b3350, intensity = 1 } = {}) {
  const hemi = new THREE.HemisphereLight(sky, groundCol, 0.85 * intensity);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(sun, 1.5 * intensity);
  dir.position.set(14, 26, 12);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 90;
  const s = 34;
  Object.assign(dir.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  dir.shadow.camera.updateProjectionMatrix();
  dir.shadow.bias = -0.0008;
  scene.add(dir);
  return { hemi, dir };
}

/** Vertical gradient background + matching fog. */
export function sky(scene, top = '#1a2547', bottom = '#0b0e17', fogNear = 40, fogFar = 150) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  if (fogFar) scene.fog = new THREE.Fog(new THREE.Color(bottom), fogNear, fogFar);
  return tex;
}

export function starfield(scene, count = 700, radius = 260) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * rand(0.65, 1));
    pos.set([v.x, Math.abs(v.y) * 0.8 + 8, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xbcd4ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.85,
  }));
  scene.add(points);
  return points;
}

/* ------------------------------------------------------------------ effects */

/** Pooled cube burst — call `burst(pos, color)` on impact, `update(dt)` per frame. */
export class Burst {
  constructor(scene, count = 90, size = 0.22) {
    this.pool = [];
    this.live = [];
    const geo = new THREE.BoxGeometry(size, size, size);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.pool.push(m);
    }
  }

  burst(pos, color = 0xffffff, n = 14, speed = 7) {
    for (let i = 0; i < n; i++) {
      const m = this.pool.pop();
      if (!m) return;
      m.position.copy(pos);
      m.material.color.set(color);
      m.material.opacity = 1;
      m.visible = true;
      m.scale.setScalar(rand(0.5, 1.4));
      m.userData.v = new THREE.Vector3().randomDirection().multiplyScalar(speed * rand(0.4, 1));
      m.userData.v.y = Math.abs(m.userData.v.y) * 0.8 + 1;
      m.userData.life = rand(0.4, 0.85);
      m.userData.age = 0;
      this.live.push(m);
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      const d = m.userData;
      d.age += dt;
      d.v.y -= 18 * dt;
      m.position.addScaledVector(d.v, dt);
      m.rotation.x += dt * 6;
      m.rotation.y += dt * 4;
      m.material.opacity = clamp(1 - d.age / d.life, 0, 1);
      if (d.age >= d.life) {
        m.visible = false;
        this.live.splice(i, 1);
        this.pool.push(m);
      }
    }
  }
}

/* ------------------------------------------------------------------ physics-ish */

const _a = new THREE.Box3();
const _b = new THREE.Box3();

/** Axis-aligned overlap test between two meshes (uses world bounds). */
export function overlaps(a, b, shrink = 0) {
  _a.setFromObject(a);
  _b.setFromObject(b);
  if (shrink) { _a.expandByScalar(-shrink); _b.expandByScalar(-shrink); }
  return _a.intersectsBox(_b);
}

export function dist2(a, b) {
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  return dx * dx + dz * dz;
}

/** Smooth third-person camera follow. */
export function chase(camera, target, offset, dt, rate = 6, look = target.position) {
  const want = target.position.clone().add(offset);
  camera.position.x = damp(camera.position.x, want.x, rate, dt);
  camera.position.y = damp(camera.position.y, want.y, rate, dt);
  camera.position.z = damp(camera.position.z, want.z, rate, dt);
  camera.lookAt(look);
}

/* ------------------------------------------------------------------ cleanup */

export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => disposeMaterial(x));
    else if (m) disposeMaterial(m);
  });
}

function disposeMaterial(m) {
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v && v.isTexture) v.dispose();
  }
  m.dispose();
}

/** Palette shared across games so the arcade feels like one product. */
export const PALETTE = {
  cyan: 0x6ee7ff,
  pink: 0xff6ea9,
  lime: 0x7bffb0,
  amber: 0xffc861,
  violet: 0xb08cff,
  red: 0xff5f6d,
  blue: 0x5b8cff,
  white: 0xf2f6ff,
  slate: 0x2a3350,
  dark: 0x141a2b,
};
export const COLORS = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.blue];
