import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import { sky, clamp, damp, seeded, lerp } from '../engine/utils.js';

/* ------------------------------------------------------------------ world */

const CHUNK = 16;
const CHUNKS = 6;                 // world is CHUNKS x CHUNKS chunks
const W = CHUNK * CHUNKS;         // 96 blocks across
const H = 40;                     // build height
const SEA = 12;
const REACH = 6;                  // how far you can break / place

// id -> { name, tiles: [top, side, bottom], solid, alpha }
const BLOCKS = [
  null,
  { name: 'Grass',    tiles: [0, 1, 2] },
  { name: 'Dirt',     tiles: [2, 2, 2] },
  { name: 'Stone',    tiles: [3, 3, 3] },
  { name: 'Sand',     tiles: [4, 4, 4] },
  { name: 'Log',      tiles: [6, 5, 6] },
  { name: 'Leaves',   tiles: [7, 7, 7] },
  { name: 'Water',    tiles: [12, 12, 12], solid: false, alpha: true },
  { name: 'Planks',   tiles: [8, 8, 8] },
  { name: 'Brick',    tiles: [9, 9, 9] },
  { name: 'Cobble',   tiles: [10, 10, 10] },
  { name: 'Glass',    tiles: [11, 11, 11], alpha: true },
  { name: 'Gold Ore', tiles: [13, 13, 13] },
  { name: 'Snow',     tiles: [14, 14, 14] },
  { name: 'Obsidian', tiles: [15, 15, 15] },
];
const AIR = 0;
const WATER = 7;
const HOTBAR = [1, 3, 10, 8, 9, 5, 6, 4, 11];

const isSolid = (id) => id !== AIR && BLOCKS[id].solid !== false;
const isAlpha = (id) => id !== AIR && BLOCKS[id].alpha === true;

/* Cube faces, wound counter-clockwise as seen from outside. */
const FACES = [
  { dir: [-1, 0, 0], tile: 1, shade: 0.72, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], tile: 1, shade: 0.72, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], tile: 2, shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], tile: 0, shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], tile: 1, shade: 0.86, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], tile: 1, shade: 0.86, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

export default class Blockcraft extends Game {
  start() {
    sky(this.scene, '#7fb2f0', '#c8e0ff', 55, 130);
    this.scene.fog = new THREE.Fog(0xa8cdf5, 45, 125);

    this.atlas = buildAtlas();
    this.opaqueMat = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true });
    this.alphaMat = new THREE.MeshBasicMaterial({
      map: this.atlas, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false,
    });

    this.voxels = new Uint8Array(W * H * W);
    this.seed = (Math.random() * 65535) | 0;
    generate(this.voxels, this.seed);

    this.chunks = new Map();
    this.queue = [];
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) this.queue.push(`${cx},${cz}`);
    }
    // Mesh the middle of the map first so the player spawns into finished land.
    const mid = (CHUNKS - 1) / 2;
    this.queue.sort((a, b) => keyDist(a, mid) - keyDist(b, mid));

    // Highlight box around the targeted block.
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }),
    );
    this.highlight.visible = false;
    this.add(this.highlight);

    // Spawn on the surface at the middle of the world.
    const sx = W / 2;
    const sz = W / 2;
    let sy = H - 1;
    while (sy > 1 && !isSolid(this.get(sx, sy - 1, sz))) sy--;
    this.pos = new THREE.Vector3(sx + 0.5, sy + 0.2, sz + 0.5);
    this.vel = new THREE.Vector3();

    this.yaw = 0;
    this.pitch = -0.15;
    this.grounded = false;
    this.flying = false;
    this.slot = 0;
    this.mined = 0;
    this.placed = 0;
    this.cool = 0;
    this.lastJump = -1;

    this.camera.fov = 75;
    this.camera.near = 0.1;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();

    this.hud.panel(hotbarHtml());
    this.refreshHotbar();
    this.hud.hint('Click to capture the mouse · WASD + Space · left click mines, right click places · 1-9 or scroll to pick a block · F to fly');
  }

  /* ----------------------------------------------------------- voxel access */

  index(x, y, z) { return (y * W + z) * W + x; }

  get(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (x < 0 || z < 0 || x >= W || z >= W || y < 0 || y >= H) return AIR;
    return this.voxels[this.index(x, y, z)];
  }

  set(x, y, z, id) {
    if (x < 0 || z < 0 || x >= W || z >= W || y < 0 || y >= H) return;
    this.voxels[this.index(x, y, z)] = id;
    // Rebuild this chunk, plus any neighbour whose border faces just changed.
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.dirty(cx, cz);
    if (x % CHUNK === 0) this.dirty(cx - 1, cz);
    if (x % CHUNK === CHUNK - 1) this.dirty(cx + 1, cz);
    if (z % CHUNK === 0) this.dirty(cx, cz - 1);
    if (z % CHUNK === CHUNK - 1) this.dirty(cx, cz + 1);
  }

  dirty(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) return;
    const key = `${cx},${cz}`;
    if (!this.queue.includes(key)) this.queue.unshift(key);
  }

  /* -------------------------------------------------------------- meshing */

  buildChunk(key) {
    const [cx, cz] = key.split(',').map(Number);
    const old = this.chunks.get(key);
    if (old) {
      for (const m of old) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }

    const solid = { pos: [], uv: [], col: [], idx: [] };
    const alpha = { pos: [], uv: [], col: [], idx: [] };

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const wx = cx * CHUNK + x;
          const wz = cz * CHUNK + z;
          const id = this.get(wx, y, wz);
          if (id === AIR) continue;
          const target = isAlpha(id) ? alpha : solid;

          for (const face of FACES) {
            const nx = wx + face.dir[0];
            const ny = y + face.dir[1];
            const nz = wz + face.dir[2];
            const n = this.get(nx, ny, nz);
            // Draw a face only where it would actually be visible.
            if (n !== AIR && !(isAlpha(n) && n !== id)) continue;
            if (id === WATER && n === WATER) continue;

            const tile = BLOCKS[id].tiles[face.tile];
            const base = target.pos.length / 3;
            const s = face.shade;
            for (const [ox, oy, oz, u, v] of face.corners) {
              target.pos.push(wx + ox, y + oy, wz + oz);
              target.uv.push(...tileUV(tile, u, v));
              target.col.push(s, s, s);
            }
            target.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }

    const meshes = [];
    for (const [data, mat] of [[solid, this.opaqueMat], [alpha, this.alphaMat]]) {
      if (!data.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(data.col, 3));
      g.setIndex(data.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.set(key, meshes);
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    // Amortise chunk meshing so the frame never stalls.
    for (let i = 0; i < 2 && this.queue.length; i++) this.buildChunk(this.queue.shift());

    this.look(dt);
    this.move(dt);
    this.interact(dt);

    this.camera.position.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    const head = this.get(this.pos.x, this.pos.y + 1.6, this.pos.z);
    this.scene.fog.color.setHex(head === WATER ? 0x2a5f9e : 0xa8cdf5);

    this.hud.stat('Mined', this.mined);
    this.hud.stat('Placed', this.placed);
    this.hud.stat('XYZ', `${this.pos.x.toFixed(0)} ${this.pos.y.toFixed(0)} ${this.pos.z.toFixed(0)}`);
    this.hud.stat('Mode', this.flying ? 'flying' : 'walking');
    if (this.queue.length) {
      this.hud.stat('Chunks', `${this.chunks.size}/${CHUNKS * CHUNKS}`);
    } else if (this.hud.stats.has('Chunks')) {
      this.hud.stats.get('Chunks').remove?.();
      this.hud.stats.delete('Chunks');
    }
  }

  look(dt) {
    if (this.input.clicked && !this.input.locked) this.input.requestLock();
    if (this.input.locked) {
      this.yaw -= this.input.delta.x * 0.0022;
      this.pitch = clamp(this.pitch - this.input.delta.y * 0.0022, -1.55, 1.55);
    }
    if (this.input.key('KeyQ')) this.yaw += 2 * dt;
    if (this.input.key('KeyE')) this.yaw -= 2 * dt;
  }

  move(dt) {
    if (this.input.hit('KeyF')) {
      this.flying = !this.flying;
      this.vel.y = 0;
      this.hud.toast(this.flying ? 'FLYING' : 'WALKING', 700);
    }

    const fwd = this.input.axisY();
    const strafe = this.input.axisX();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const sprint = this.input.key('ShiftLeft') && !this.flying ? 1.6 : 1;
    const speed = (this.flying ? 16 : 5.2) * sprint;

    const wishX = (-sin * fwd + cos * strafe) * speed;
    const wishZ = (-cos * fwd - sin * strafe) * speed;
    const rate = this.grounded || this.flying ? 16 : 5;
    this.vel.x = damp(this.vel.x, wishX, rate, dt);
    this.vel.z = damp(this.vel.z, wishZ, rate, dt);

    const inWater = this.get(this.pos.x, this.pos.y + 0.4, this.pos.z) === WATER;

    if (this.flying) {
      const up = (this.input.key('Space') ? 1 : 0) - (this.input.key('ShiftLeft') ? 1 : 0);
      this.vel.y = damp(this.vel.y, up * 12, 14, dt);
    } else if (inWater) {
      this.vel.y = damp(this.vel.y, this.input.key('Space') ? 4 : -2.4, 6, dt);
    } else {
      this.vel.y -= 28 * dt;
      if (this.input.key('Space') && this.grounded) {
        this.vel.y = 9;
        this.grounded = false;
      }
      this.vel.y = Math.max(this.vel.y, -55);
    }

    // Axis-separated sweep against the voxel grid.
    this.grounded = false;
    this.sweep('x', this.vel.x * dt);
    this.sweep('z', this.vel.z * dt);
    this.sweep('y', this.vel.y * dt);

    if (this.pos.y < -20) {           // fell out of the world
      this.pos.set(W / 2 + 0.5, H - 1, W / 2 + 0.5);
      this.vel.set(0, 0, 0);
    }
  }

  /** Move one axis and stop at the first solid block the player body hits. */
  sweep(axis, delta) {
    if (!delta) return;
    const R = 0.3;
    const HEIGHT = 1.8;
    this.pos[axis] += delta;

    const minX = Math.floor(this.pos.x - R);
    const maxX = Math.floor(this.pos.x + R);
    const minY = Math.floor(this.pos.y);
    const maxY = Math.floor(this.pos.y + HEIGHT);
    const minZ = Math.floor(this.pos.z - R);
    const maxZ = Math.floor(this.pos.z + R);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isSolid(this.get(x, y, z))) continue;
          if (axis === 'x') {
            this.pos.x = delta > 0 ? x - R - 0.001 : x + 1 + R + 0.001;
            this.vel.x = 0;
          } else if (axis === 'z') {
            this.pos.z = delta > 0 ? z - R - 0.001 : z + 1 + R + 0.001;
            this.vel.z = 0;
          } else {
            if (delta > 0) { this.pos.y = y - HEIGHT - 0.001; }
            else { this.pos.y = y + 1.001; this.grounded = true; }
            this.vel.y = 0;
          }
          return;
        }
      }
    }
  }

  /* ------------------------------------------------------- block targeting */

  /** March the view ray a step at a time; returns the hit block and the empty
   *  cell in front of it (where a new block would go). */
  raycast() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );
    const p = new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z);
    let prev = null;
    for (let t = 0; t < REACH; t += 0.04) {
      const x = Math.floor(p.x + dir.x * t);
      const y = Math.floor(p.y + dir.y * t);
      const z = Math.floor(p.z + dir.z * t);
      const id = this.get(x, y, z);
      if (isSolid(id)) return { x, y, z, id, prev };
      prev = { x, y, z };
    }
    return null;
  }

  interact(dt) {
    this.cool -= dt;

    // Block selection
    for (let i = 0; i < 9; i++) {
      if (this.input.hit(`Digit${i + 1}`)) { this.slot = i; this.refreshHotbar(); }
    }
    if (this.input.wheel) {
      this.slot = (this.slot + (this.input.wheel > 0 ? 1 : -1) + 9) % 9;
      this.refreshHotbar();
    }

    const hit = this.raycast();
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    if (!hit || this.cool > 0) return;

    if (this.input.button(0) && this.input.locked) {
      this.set(hit.x, hit.y, hit.z, AIR);
      this.mined++;
      this.cool = 0.18;
      this.audio.noise(0.12, { gain: 0.14, cutoff: 1200, sweep: 0.4 });
    } else if (this.input.button(2) && hit.prev) {
      const { x, y, z } = hit.prev;
      if (this.get(x, y, z) === AIR && !this.intersectsPlayer(x, y, z)) {
        this.set(x, y, z, HOTBAR[this.slot]);
        this.placed++;
        this.cool = 0.18;
        this.audio.tone(280, 0.06, { type: 'square', gain: 0.09 });
      }
    }
  }

  intersectsPlayer(x, y, z) {
    const R = 0.3;
    return x + 1 > this.pos.x - R && x < this.pos.x + R
      && z + 1 > this.pos.z - R && z < this.pos.z + R
      && y + 1 > this.pos.y && y < this.pos.y + 1.8;
  }

  refreshHotbar() {
    const el = this.hud.$panel?.querySelector('.bc-hotbar');
    if (!el) return;
    el.querySelectorAll('.bc-slot').forEach((s, i) => {
      s.classList.toggle('on', i === this.slot);
    });
    const label = this.hud.$panel.querySelector('.bc-name');
    if (label) label.textContent = BLOCKS[HOTBAR[this.slot]].name;
  }

  dispose() { this.input.exitLock(); }
}

/* ------------------------------------------------------------- generation */

function generate(voxels, seed) {
  const idx = (x, y, z) => (y * W + z) * W + x;

  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      // Layered value noise makes rolling hills with the odd peak.
      let e = 0;
      let amp = 1;
      let freq = 0.012;
      let sum = 0;
      for (let o = 0; o < 4; o++) {
        e += noise2(x * freq, z * freq, seed + o * 71) * amp;
        sum += amp;
        amp *= 0.5;
        freq *= 2.1;
      }
      e /= sum;
      // Centred so roughly a quarter of the map falls below sea level, which
      // is what makes coastlines and lakes instead of one continuous plateau.
      const h = clamp(Math.floor(-8 + e * 47), 1, H - 8);
      const beach = h <= SEA + 1;

      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = AIR;
        if (y <= h) {
          if (y === h) id = beach ? 4 : 1;
          else if (y > h - 4) id = beach ? 4 : 2;
          else id = 3;
          // Sprinkle ore below the surface.
          if (id === 3 && y < 14 && noise2(x * 0.9, z * 0.9 + y * 3.1, seed + 991) > 0.93) id = 12;
        } else if (y <= SEA) {
          id = WATER;
        }
        if (id !== AIR) voxels[idx(x, y, z)] = id;
      }

      // Snow caps
      if (h > 26) voxels[idx(x, h, z)] = 13;
    }
  }

  // Trees on grass, away from the shoreline.
  const rng = seeded(seed ^ 0x5eed);
  for (let z = 3; z < W - 3; z++) {
    for (let x = 3; x < W - 3; x++) {
      let y = H - 1;
      while (y > 0 && voxels[idx(x, y, z)] === AIR) y--;
      if (voxels[idx(x, y, z)] !== 1 || y < SEA + 2 || y > 26) continue;
      if (rng() > 0.012) continue;

      const trunk = 4 + Math.floor(rng() * 3);
      for (let i = 1; i <= trunk; i++) voxels[idx(x, y + i, z)] = 5;
      const top = y + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy >= 1 ? 1 : dy === 0 ? 2 : 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.6) continue;
            const yy = top + dy;
            if (yy >= H) continue;
            const i = idx(x + dx, yy, z + dz);
            if (voxels[i] === AIR) voxels[i] = 6;
          }
        }
      }
    }
  }
}

function hash2(x, z, seed) {
  // Math.imul throughout: this hash relies on 32-bit wraparound, and plain `*`
  // silently loses the low bits once the product passes 2^53.
  let n = (Math.imul(x | 0, 1619) + Math.imul(z | 0, 31337) + Math.imul(seed | 0, 1013)) | 0;
  n = (n << 13) ^ n;
  const m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
  n = (Math.imul(n, m) + 1376312589) | 0;
  return (n & 0x7fffffff) / 0x7fffffff;
}

function noise2(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(
    lerp(hash2(xi, zi, seed), hash2(xi + 1, zi, seed), u),
    lerp(hash2(xi, zi + 1, seed), hash2(xi + 1, zi + 1, seed), u),
    v,
  );
}

const keyDist = (key, mid) => {
  const [x, z] = key.split(',').map(Number);
  return (x - mid) ** 2 + (z - mid) ** 2;
};

/* ------------------------------------------------------------------ atlas */

const ATLAS_N = 4;      // 4 x 4 tiles
const TILE = 16;        // pixels per tile

function tileUV(tile, u, v) {
  const col = tile % ATLAS_N;
  const row = Math.floor(tile / ATLAS_N);
  return [(col + u) / ATLAS_N, ((ATLAS_N - 1 - row) + v) / ATLAS_N];
}

/** Paints the block texture atlas procedurally — no image files anywhere. */
function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = ATLAS_N * TILE;
  c.height = ATLAS_N * TILE;
  const g = c.getContext('2d');
  const rng = seeded(7);

  const px = (t, x, y, colour) => {
    g.fillStyle = colour;
    g.fillRect((t % ATLAS_N) * TILE + x, Math.floor(t / ATLAS_N) * TILE + y, 1, 1);
  };
  const fill = (t, colour) => {
    g.fillStyle = colour;
    g.fillRect((t % ATLAS_N) * TILE, Math.floor(t / ATLAS_N) * TILE, TILE, TILE);
  };
  const speckle = (t, base, shades) => {
    fill(t, base);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (rng() < 0.42) px(t, x, y, shades[(rng() * shades.length) | 0]);
      }
    }
  };

  speckle(0, '#5fa63b', ['#6cb844', '#559a33', '#67ad3e']);                 // grass top
  speckle(2, '#8a5f3c', ['#7d5535', '#966a44', '#84593a']);                 // dirt
  speckle(1, '#8a5f3c', ['#7d5535', '#966a44']);                            // grass side (dirt base)
  for (let x = 0; x < TILE; x++) {
    const lip = 3 + ((rng() * 2) | 0);
    for (let y = 0; y < lip; y++) px(1, x, y, rng() < 0.5 ? '#5fa63b' : '#6cb844');
  }
  speckle(3, '#7e7e86', ['#8b8b93', '#71717a', '#868690']);                 // stone
  speckle(4, '#ded2a4', ['#e8dcb0', '#d2c696', '#e2d6a8']);                 // sand
  speckle(5, '#6b4a2c', ['#5d4026', '#775432']);                            // log side
  for (let y = 0; y < TILE; y++) {
    for (const x of [2, 3, 8, 9, 13]) px(5, x, y, rng() < 0.7 ? '#573b23' : '#6b4a2c');
  }
  speckle(6, '#a9834f', ['#9a7645', '#b58c56']);                            // log end
  for (let r = 2; r < 8; r += 2) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      px(6, (8 + Math.cos(t) * r) | 0, (8 + Math.sin(t) * r) | 0, '#7d5f39');
    }
  }
  speckle(7, '#3f7d32', ['#4c9139', '#356b2a', '#58a341']);                 // leaves
  fill(8, '#a97c4c');                                                        // planks
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (y % 4 === 3) px(8, x, y, '#8a6339');
      else if (rng() < 0.25) px(8, x, y, '#b98a58');
    }
  }
  fill(9, '#a04a3c');                                                        // brick
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const row = Math.floor(y / 4);
      if (y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0) px(9, x, y, '#d8d0c8');
      else if (rng() < 0.18) px(9, x, y, '#b45a49');
    }
  }
  speckle(10, '#8b8b93', ['#6e6e77', '#9b9ba3', '#5f5f68']);                // cobble
  fill(11, '#bfe4f2');                                                       // glass
  for (let i = 0; i < TILE; i++) {
    px(11, i, 0, '#ffffff'); px(11, i, TILE - 1, '#ffffff');
    px(11, 0, i, '#ffffff'); px(11, TILE - 1, i, '#ffffff');
  }
  fill(12, '#3f7fd8');                                                       // water
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if ((x + y * 2 + ((rng() * 2) | 0)) % 7 === 0) px(12, x, y, '#5b9ae8');
    }
  }
  speckle(13, '#7e7e86', ['#8b8b93', '#71717a']);                           // gold ore
  for (let i = 0; i < 16; i++) px(13, (rng() * TILE) | 0, (rng() * TILE) | 0, '#f0c14b');
  speckle(14, '#eef4ff', ['#ffffff', '#dfe8f7']);                           // snow
  speckle(15, '#241f36', ['#312a49', '#1a1628']);                           // obsidian

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* -------------------------------------------------------------- hotbar UI */

function hotbarHtml() {
  const slots = HOTBAR.map((id, i) => `
    <div class="bc-slot${i === 0 ? ' on' : ''}">
      <span class="bc-key">${i + 1}</span>
      <span class="bc-swatch" style="background:${SWATCH[id]}"></span>
    </div>`).join('');
  return `
    <style>
      .bc-cross { position:absolute; left:50%; top:50%; width:18px; height:18px;
        margin:-9px 0 0 -9px; }
      .bc-cross:before, .bc-cross:after { content:''; position:absolute; background:rgba(255,255,255,.75);
        box-shadow:0 0 2px rgba(0,0,0,.8); }
      .bc-cross:before { left:8px; top:0; width:2px; height:18px; }
      .bc-cross:after { top:8px; left:0; height:2px; width:18px; }
      .bc-hotbar { position:absolute; left:50%; bottom:56px; transform:translateX(-50%);
        display:flex; gap:4px; padding:4px; background:rgba(10,14,24,.55);
        border:1px solid rgba(255,255,255,.15); border-radius:8px; }
      .bc-slot { position:relative; width:44px; height:44px; border-radius:5px;
        border:2px solid rgba(255,255,255,.12); display:grid; place-items:center; }
      .bc-slot.on { border-color:#fff; background:rgba(255,255,255,.12); }
      .bc-key { position:absolute; top:1px; left:4px; font:700 9px system-ui; color:rgba(255,255,255,.6); }
      .bc-swatch { width:26px; height:26px; border-radius:3px; box-shadow:inset 0 -8px 10px rgba(0,0,0,.35); }
      .bc-name { position:absolute; left:50%; bottom:108px; transform:translateX(-50%);
        font:700 13px system-ui; color:#fff; text-shadow:0 2px 6px rgba(0,0,0,.8); }
    </style>
    <div class="bc-cross"></div>
    <div class="bc-name">Grass</div>
    <div class="bc-hotbar">${slots}</div>`;
}

const SWATCH = {
  1: '#5fa63b', 3: '#7e7e86', 4: '#ded2a4', 5: '#6b4a2c', 6: '#3f7d32',
  8: '#a97c4c', 9: '#a04a3c', 10: '#8b8b93', 11: '#bfe4f2',
};
