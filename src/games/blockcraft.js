import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import { sky, clamp, damp, seeded, lerp, invLerp, Burst } from '../engine/utils.js';

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
  { name: 'Coal Ore', tiles: [16, 16, 16] },
  { name: 'Iron Ore', tiles: [17, 17, 17] },
];
const AIR = 0;
const WATER = 7;
const HOTBAR = [1, 3, 10, 8, 9, 5, 6, 4, 11];

// Seconds of holding to break each block. Anything unlisted takes 0.6s.
const HARDNESS = {
  1: 0.45, 2: 0.4, 3: 1.1, 4: 0.35, 5: 0.8, 6: 0.12, 8: 0.7,
  9: 1.0, 10: 1.2, 11: 0.35, 12: 1.7, 13: 0.2, 14: 3.4, 15: 1.5, 16: 1.9,
};
const hardnessOf = (id) => HARDNESS[id] ?? 0.6;

// Average colour of each block, for the debris thrown when one breaks.
const DEBRIS = {
  1: 0x5fa63b, 2: 0x8a5f3c, 3: 0x7e7e86, 4: 0xded2a4, 5: 0x6b4a2c, 6: 0x3f7d32,
  7: 0x3f7fd8, 8: 0xa97c4c, 9: 0xa04a3c, 10: 0x8b8b93, 11: 0xbfe4f2,
  12: 0xf0c14b, 13: 0xeef4ff, 14: 0x241f36, 15: 0x2b2b31, 16: 0xd8b48c,
};

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

    // Darkens over the block being mined, so a long dig shows its progress.
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0x08080a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.crack.visible = false;
    this.add(this.crack);
    this.debris = new Burst(this.scene, 90, 0.13);
    this.clouds = buildClouds();
    this.add(this.clouds);

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
    this.mineKey = null;    // which block the current dig is against
    this.mineT = 0;         // seconds spent digging it
    this.chip = 0;          // next chipping sound
    this.stepT = 0;         // distance left before the next footstep
    this.wasWet = false;
    this.sprinting = false;

    this.camera.fov = 75;
    this.camera.near = 0.1;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();

    this.hud.panel(hotbarHtml() + touchHtml());
    this.refreshHotbar();
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, mine: false, place: false, up: false };
    this.bindTouch();

    const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.hud.hint(touchDevice
      ? 'Left stick to move · drag the right side to look · MINE / PLACE / UP · tap FLY to toggle flying'
      : 'Click to capture the mouse · WASD + Space · hold left click to mine, right click places · middle click copies a block · 1-9 or scroll · F to fly · or plug in a controller');
  }

  /** Wires the on-screen joystick, look pad and buttons that appear on touch
   *  devices (see touchHtml's @media (pointer: coarse) guard), plus tap-to-
   *  select on the hotbar for every device. Reads `this.hud.$panel` directly,
   *  the same way refreshHotbar does, rather than trusting panel()'s return
   *  value — the test harness's Hud mock always returns null from panel(). */
  bindTouch() {
    const panel = this.hud.$panel;
    if (!panel) return;

    panel.querySelectorAll('.bc-slot').forEach((el, i) => {
      el.addEventListener('click', () => { this.slot = i; this.refreshHotbar(); });
    });

    const stickBase = panel.querySelector('.bc-stick-base');
    const stickKnob = panel.querySelector('.bc-stick-knob');
    if (stickBase && stickKnob) {
      bindStick(stickBase, stickKnob, (x, y) => { this.touch.move.x = x; this.touch.move.y = y; });
    }

    const look = panel.querySelector('.bc-look');
    if (look) bindLook(look, this.touch.look);

    const hold = (selector, key) => {
      const el = panel.querySelector(selector);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        this.touch[key] = true;
      });
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); this.touch[key] = false; });
      el.addEventListener('pointercancel', (e) => { e.stopPropagation(); this.touch[key] = false; });
    };
    hold('.bc-btn-mine', 'mine');
    hold('.bc-btn-place', 'place');
    hold('.bc-btn-jump', 'up');

    const flyBtn = panel.querySelector('.bc-btn-fly');
    flyBtn?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.flying = !this.flying;
      this.vel.y = 0;
      this.hud.toast(this.flying ? 'FLYING' : 'WALKING', 700);
    });
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

    this.debris.update(dt);
    this.driftClouds(dt);

    this.camera.position.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // A little FOV kick while sprinting; the speed reads better than the number.
    const wantFov = this.sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, wantFov, 8, dt);
      this.camera.updateProjectionMatrix();
    }

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

    // A gamepad's right stick turns at a steady rate rather than by delta.
    const gx = this.input.gpAxis(2);
    const gy = this.input.gpAxis(3);
    if (gx || gy) {
      this.yaw -= gx * 2.4 * dt;
      this.pitch = clamp(this.pitch - gy * 2.4 * dt, -1.55, 1.55);
    }

    // The touch look pad reports accumulated finger movement since last read,
    // the same shape as a locked mouse's delta — consume and clear it.
    if (this.touch.look.x || this.touch.look.y) {
      this.yaw -= this.touch.look.x * 0.0026;
      this.pitch = clamp(this.pitch - this.touch.look.y * 0.0026, -1.55, 1.55);
      this.touch.look.x = 0;
      this.touch.look.y = 0;
    }
  }

  move(dt) {
    if (this.input.hit('KeyF') || this.input.gpHit(3)) {
      this.flying = !this.flying;
      this.vel.y = 0;
      this.hud.toast(this.flying ? 'FLYING' : 'WALKING', 700);
    }

    // Space/A/the jump button all mean "up"; shift/B all mean "down" — each
    // pair does the same double duty (jump vs. fly-up, sprint vs. fly-down).
    const jumpHeld = this.input.key('Space') || this.input.gpButton(0) || this.touch.up;
    const downHeld = this.input.key('ShiftLeft') || this.input.gpButton(1);

    const fwd = this.input.axisY() || this.touch.move.y;
    const strafe = this.input.axisX() || this.touch.move.x;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const sprint = downHeld && !this.flying ? 1.6 : 1;
    const speed = (this.flying ? 16 : 5.2) * sprint;
    this.sprinting = sprint > 1 && (fwd !== 0 || strafe !== 0);

    const wishX = (-sin * fwd + cos * strafe) * speed;
    const wishZ = (-cos * fwd - sin * strafe) * speed;
    const rate = this.grounded || this.flying ? 16 : 5;
    this.vel.x = damp(this.vel.x, wishX, rate, dt);
    this.vel.z = damp(this.vel.z, wishZ, rate, dt);

    const inWater = this.get(this.pos.x, this.pos.y + 0.4, this.pos.z) === WATER;

    if (this.flying) {
      const up = (jumpHeld ? 1 : 0) - (downHeld ? 1 : 0);
      this.vel.y = damp(this.vel.y, up * 12, 14, dt);
    } else if (inWater) {
      this.vel.y = damp(this.vel.y, jumpHeld ? 4 : -2.4, 6, dt);
    } else {
      this.vel.y -= 28 * dt;
      if (jumpHeld && this.grounded) {
        this.vel.y = 9;
        this.grounded = false;
      }
      this.vel.y = Math.max(this.vel.y, -55);
    }

    // Axis-separated sweep against the voxel grid.
    const falling = this.vel.y;
    this.grounded = false;
    this.sweep('x', this.vel.x * dt);
    this.sweep('z', this.vel.z * dt);
    this.sweep('y', this.vel.y * dt);

    if (this.grounded && falling < -7) this.audio.noise(0.09, { gain: 0.1, cutoff: 300 });
    if (inWater !== this.wasWet) {
      this.audio.noise(0.3, { gain: 0.12, cutoff: 900, sweep: 0.6 });
      this.wasWet = inWater;
    }
    // Footsteps are paced by distance covered, not by time, so they keep step
    // with the walk whether you are sprinting or crawling along.
    const pace = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (this.grounded && !this.flying && pace > 0.001) {
      this.stepT -= pace;
      if (this.stepT <= 0) {
        this.stepT = 1.9;
        this.audio.noise(0.05, { gain: 0.05, cutoff: 520 });
      }
    }

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
    if (this.input.gpHit(4)) { this.slot = (this.slot + 8) % 9; this.refreshHotbar(); }
    if (this.input.gpHit(5)) { this.slot = (this.slot + 1) % 9; this.refreshHotbar(); }

    const hit = this.raycast();
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    // Middle click copies the block you are looking at, if it is on the bar.
    if (hit && this.input.clickedButton(1)) {
      const slot = HOTBAR.indexOf(hit.id);
      if (slot >= 0) { this.slot = slot; this.refreshHotbar(); this.audio.blip?.(); }
    }

    this.mine(dt, hit);

    if (!hit || this.cool > 0) return;
    const placing = this.input.button(2) || this.input.gpButton(6) || this.touch.place;
    if (placing && hit.prev) {
      const { x, y, z } = hit.prev;
      if (this.get(x, y, z) === AIR && !this.intersectsPlayer(x, y, z)) {
        this.set(x, y, z, HOTBAR[this.slot]);
        this.placed++;
        this.cool = 0.18;
        this.audio.tone(280, 0.06, { type: 'square', gain: 0.09 });
      }
    }
  }

  /**
   * Digging takes time now: every block has a hardness, and holding the button
   * works through it. Looking away resets the dig, so you cannot chip at four
   * blocks at once.
   */
  mine(dt, hit) {
    // A mouse click only counts once the pointer is actually locked — the
    // very click that requests lock must not also register as a mine. The
    // gamepad trigger and the touch mine button have no such lock to wait on.
    const digging = hit && ((this.input.button(0) && this.input.locked)
      || this.input.gpButton(7) || this.touch.mine);
    const key = digging ? `${hit.x},${hit.y},${hit.z}` : null;
    if (key !== this.mineKey) {
      this.mineKey = key;
      this.mineT = 0;
      this.chip = 0;
    }
    if (!digging) {
      this.crack.visible = false;
      return;
    }

    const need = hardnessOf(hit.id);
    this.mineT += dt;
    const progress = clamp(this.mineT / need, 0, 1);

    this.crack.visible = true;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.material.opacity = progress * 0.55;

    this.chip -= dt;
    if (this.chip <= 0) {
      this.chip = 0.16;
      this.audio.noise(0.05, { gain: 0.07, cutoff: 900 + progress * 900 });
    }

    if (progress < 1) return;

    const centre = new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.debris.burst(centre, DEBRIS[hit.id] ?? 0x9a9aa2, 10, 4.5);
    this.set(hit.x, hit.y, hit.z, AIR);
    this.mined++;
    this.mineKey = null;
    this.mineT = 0;
    this.crack.visible = false;
    this.audio.noise(0.13, { gain: 0.15, cutoff: 1200, sweep: 0.4 });
  }

  driftClouds(dt) {
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > W * 1.6) c.position.x = -W * 0.6;
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

/** A handful of flat slabs drifting overhead, well above the build height. */
function buildClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false,
  });
  const rng = seeded(4242);
  for (let i = 0; i < 16; i++) {
    const w = 10 + rng() * 22;
    const d = 8 + rng() * 16;
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(w, 2 + rng() * 2, d), mat);
    cloud.position.set(rng() * W * 2 - W / 2, H + 14 + rng() * 10, rng() * W * 2 - W / 2);
    cloud.userData.speed = 0.7 + rng() * 1.1;
    group.add(cloud);
  }
  return group;
}

/* ------------------------------------------------------------- generation */

function generate(voxels, seed) {
  const idx = (x, y, z) => (y * W + z) * W + x;
  const heights = new Uint8Array(W * W);   // surface height, kept for cave carving

  // Elevation first, as a raw field. Layered value noise makes rolling hills
  // with the odd peak, but its mean wanders from seed to seed.
  const field = new Float32Array(W * W);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
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
      field[z * W + x] = e / sum;
    }
  }

  // Fit the curve to this world's own spread rather than to fixed constants.
  // A flat mapping left some seeds with no sea at all and others half drowned;
  // pinning the 30th percentile to the waterline gives every world a coast.
  const sorted = Float32Array.from(field).sort();
  const low = sorted[0];
  const shore = sorted[Math.floor(sorted.length * 0.3)];
  const peak = sorted[Math.floor(sorted.length * 0.995)];
  const heightAt = (e) => (e <= shore
    ? Math.round(lerp(2, SEA, invLerp(low, shore, e)))
    : Math.round(lerp(SEA, H - 6, clamp(invLerp(shore, peak, e), 0, 1) ** 1.15)));

  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const h = clamp(heightAt(field[z * W + x]), 1, H - 6);
      const beach = h <= SEA + 1;
      heights[z * W + x] = h;

      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = AIR;
        if (y <= h) {
          if (y === h) id = beach ? 4 : 1;
          else if (y > h - 4) id = beach ? 4 : 2;
          else id = 3;
        } else if (y <= SEA) {
          id = WATER;
        }
        if (id !== AIR) voxels[idx(x, y, z)] = id;
      }

      // Snow caps
      if (h > 26) voxels[idx(x, h, z)] = 13;
    }
  }

  // Caves. Carved from 3D noise, but never within three blocks of the surface:
  // that crust is what stops the sea draining into them and the hills going hollow.
  for (let y = 2; y < H - 6; y++) {
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y, z);
        const id = voxels[i];
        if (id !== 3 && id !== 2) continue;
        if (y > heights[z * W + x] - 3) continue;
        if (noise3(x * 0.085, y * 0.13, z * 0.085, seed + 313) > 0.655) voxels[i] = AIR;
      }
    }
  }

  // Ore veins: coal near the surface, iron below it, gold only in the deep.
  const VEINS = [
    { id: 15, top: 26, freq: 0.34, cut: 0.845 },
    { id: 16, top: 17, freq: 0.4, cut: 0.86 },
    { id: 12, top: 10, freq: 0.46, cut: 0.885 },
  ];
  for (let y = 1; y < 27; y++) {
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y, z);
        if (voxels[i] !== 3) continue;
        for (const v of VEINS) {
          if (y > v.top) continue;
          if (noise3(x * v.freq, y * v.freq, z * v.freq, seed + v.id * 77) > v.cut) {
            voxels[i] = v.id;
            break;
          }
        }
      }
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

function hash3(x, y, z, seed) {
  let n = (Math.imul(x | 0, 1619) + Math.imul(y | 0, 6971)
    + Math.imul(z | 0, 31337) + Math.imul(seed | 0, 1013)) | 0;
  n = (n << 13) ^ n;
  const m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
  n = (Math.imul(n, m) + 1376312589) | 0;
  return (n & 0x7fffffff) / 0x7fffffff;
}

/** Trilinear value noise — the cave and vein shapes come out of this. */
function noise3(x, y, z, seed) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
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

const ATLAS_N = 5;      // 5 x 5 tiles
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
  speckle(16, '#7e7e86', ['#8b8b93', '#71717a']);                           // coal ore
  for (let i = 0; i < 22; i++) {
    const x = (rng() * (TILE - 2)) | 0;
    const y = (rng() * (TILE - 2)) | 0;
    px(16, x, y, '#26262c'); px(16, x + 1, y, '#1b1b20'); px(16, x, y + 1, '#31313a');
  }
  speckle(17, '#7e7e86', ['#8b8b93', '#71717a']);                           // iron ore
  for (let i = 0; i < 20; i++) {
    const x = (rng() * (TILE - 2)) | 0;
    const y = (rng() * (TILE - 2)) | 0;
    px(17, x, y, '#d8b48c'); px(17, x + 1, y, '#c39a72'); px(17, x, y + 1, '#e8c9a8');
  }

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
        border:2px solid rgba(255,255,255,.12); display:grid; place-items:center;
        pointer-events:auto; cursor:pointer; }
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

/** Joystick, look pad and action buttons — hidden by default, shown only when
 *  the device's primary pointer is touch (a mouse-and-touchscreen laptop
 *  keeps the desktop controls). bindTouch() wires the elements this returns. */
function touchHtml() {
  return `
    <style>
      .bc-touch { display:none; }
      @media (pointer: coarse) {
        .bc-touch { display:block; }
      }
      .bc-look { position:absolute; right:0; top:0; bottom:0; width:58%;
        pointer-events:auto; touch-action:none; }
      .bc-stick-base { position:absolute; z-index:2; left:22px;
        bottom:calc(22px + env(safe-area-inset-bottom,0px)); width:108px; height:108px;
        border-radius:50%; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.25);
        pointer-events:auto; touch-action:none; }
      .bc-stick-knob { position:absolute; left:50%; top:50%; width:48px; height:48px;
        margin:-24px 0 0 -24px; border-radius:50%;
        background:rgba(255,255,255,.28); border:1px solid rgba(255,255,255,.5); }
      .bc-btn { position:absolute; z-index:2; width:62px; height:62px; border-radius:50%;
        display:grid; place-items:center; font:800 11px system-ui; color:#fff;
        background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.3);
        pointer-events:auto; touch-action:none; user-select:none; }
      .bc-btn:active { background:rgba(255,255,255,.3); }
      .bc-btn-mine { right:22px; bottom:calc(96px + env(safe-area-inset-bottom,0px));
        background:rgba(255,90,80,.25); }
      .bc-btn-place { right:92px; bottom:calc(150px + env(safe-area-inset-bottom,0px)); }
      .bc-btn-jump { right:22px; bottom:calc(174px + env(safe-area-inset-bottom,0px)); }
      .bc-btn-fly { right:92px; bottom:calc(228px + env(safe-area-inset-bottom,0px));
        width:50px; height:50px; font-size:9px; }
    </style>
    <div class="bc-touch">
      <div class="bc-look"></div>
      <div class="bc-stick-base"><div class="bc-stick-knob"></div></div>
      <div class="bc-btn bc-btn-mine">MINE</div>
      <div class="bc-btn bc-btn-place">PLACE</div>
      <div class="bc-btn bc-btn-jump">UP</div>
      <div class="bc-btn bc-btn-fly">FLY</div>
    </div>`;
}

/** A drag-to-move virtual joystick: the knob follows the finger, clamped to
 *  a fixed radius, reporting -1..1 on each axis (+y is "forward", matching
 *  Input's axisY convention) via `onChange`. */
function bindStick(base, knob, onChange) {
  let id = null;
  const R = 34;
  const move = (e) => {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange(dx / R, -dy / R);
  };
  const end = () => { id = null; knob.style.transform = ''; onChange(0, 0); };
  base.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (id !== null) return;   // a second finger landing here while one is tracked is ignored, not passed through
    id = e.pointerId;
    base.setPointerCapture(id);
    move(e);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.stopPropagation();
    move(e);
  });
  base.addEventListener('pointerup', (e) => { if (e.pointerId === id) { e.stopPropagation(); end(); } });
  base.addEventListener('pointercancel', (e) => { if (e.pointerId === id) { e.stopPropagation(); end(); } });
}

/** A drag-anywhere look pad: accumulates the finger's frame-to-frame movement
 *  into `look.x`/`look.y`, the same shape as a locked mouse's delta — the
 *  game consumes and zeroes it each frame in look(). */
function bindLook(zone, look) {
  let id = null;
  let lx = 0;
  let ly = 0;
  zone.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (id !== null) return;   // a second finger landing here while one is tracked is ignored, not passed through
    id = e.pointerId;
    lx = e.clientX; ly = e.clientY;
    zone.setPointerCapture(id);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    look.x += e.clientX - lx;
    look.y += e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    e.stopPropagation();
  });
  const end = (e) => { if (e.pointerId === id) { id = null; e.stopPropagation(); } };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

const SWATCH = {
  1: '#5fa63b', 3: '#7e7e86', 4: '#ded2a4', 5: '#6b4a2c', 6: '#3f7d32',
  8: '#a97c4c', 9: '#a04a3c', 10: '#8b8b93', 11: '#bfe4f2',
};
