import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, clamp, seeded, shuffle, PALETTE,
} from '../engine/utils.js';

const CELLS = 9;                    // maze is CELLS x CELLS rooms
const GRID = CELLS * 2 + 1;         // walls occupy the odd indices
const S = 4;                        // world units per grid square
const RADIUS = 0.9;                 // player collision radius
const EYE = 2.6;

export default class MazeEscape extends Game {
  start() {
    sky(this.scene, '#2b2438', '#07060a', 8, 34);
    lights(this.scene, { sky: 0xc0b0ff, groundCol: 0x181425, intensity: 0.65 });

    this.grid = carve(seeded(Date.now() & 0xffff));
    this.add(ground(GRID * S + 20, 0x151220));

    // One instanced-ish pass: a mesh per wall square, merged visually by material.
    const wallMat = mat(0x2c2545, { roughness: 0.95 });
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        if (!this.grid[z][x]) continue;
        const w = box(S, 5, S, wallMat, { cast: false });
        w.position.set(...this.world(x, z, 2.5));
        this.add(w);
      }
    }

    // Start at one corner room, exit at the far one.
    this.exitCell = { x: GRID - 2, z: GRID - 2 };
    const [ex, , ez] = this.world(this.exitCell.x, this.exitCell.z, 0);
    this.exit = this.add(box(S * 0.7, 0.2, S * 0.7, glow(PALETTE.lime), { cast: false }));
    this.exit.position.set(ex, 0.12, ez);
    this.beacon = this.add(box(0.5, 8, 0.5, glow(PALETTE.lime, { transparent: true, opacity: 0.35 }), { cast: false }));
    this.beacon.position.set(ex, 4, ez);

    const [sx, , sz] = this.world(1, 1, 0);
    this.pos = new THREE.Vector3(sx, EYE, sz);
    this.yaw = -Math.PI / 4;
    this.pitch = 0;
    this.elapsed = 0;
    this.locked = false;

    this.camera.fov = 78;
    this.camera.near = 0.2;
    this.camera.updateProjectionMatrix();

    this.hud.panel('<div style="position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid rgba(255,255,255,.55);border-radius:50%"></div>');
    this.hud.hint('Click to capture the mouse · WASD to walk · Q / E to turn without the mouse');
  }

  /** Grid square -> world centre. */
  world(x, z, y) {
    return [(x - (GRID - 1) / 2) * S, y, (z - (GRID - 1) / 2) * S];
  }

  solid(wx, wz) {
    const x = Math.round(wx / S + (GRID - 1) / 2);
    const z = Math.round(wz / S + (GRID - 1) / 2);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return true;
    return this.grid[z][x];
  }

  update(dt) {
    this.elapsed += dt;

    if (this.input.clicked && !this.input.locked) this.input.requestLock();
    if (this.input.locked) {
      this.yaw -= this.input.delta.x * 0.0024;
      this.pitch = clamp(this.pitch - this.input.delta.y * 0.0024, -1.1, 1.1);
    }
    // Keyboard turning so the game is playable without pointer lock.
    if (this.input.key('KeyQ')) this.yaw += 2.2 * dt;
    if (this.input.key('KeyE')) this.yaw -= 2.2 * dt;

    const fwd = this.input.axisY();
    const strafe = this.input.axisX();
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const speed = this.input.key('ShiftLeft', 'ShiftRight') ? 11 : 7;

    // Move and resolve against walls one axis at a time so you slide along them.
    const dx = (-sin * fwd + cos * strafe) * speed * dt;
    const dz = (-cos * fwd - sin * strafe) * speed * dt;
    this.slide(dx, 0);
    this.slide(0, dz);

    this.camera.position.copy(this.pos);
    this.camera.position.y = EYE + Math.sin(this.elapsed * 9) * (Math.abs(fwd) + Math.abs(strafe) ? 0.07 : 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    this.beacon.material.opacity = 0.25 + Math.sin(this.elapsed * 3) * 0.12;
    this.exit.material.emissiveIntensity = 0.7 + Math.sin(this.elapsed * 5) * 0.3;

    const [ex, , ez] = this.world(this.exitCell.x, this.exitCell.z, 0);
    if (Math.hypot(this.pos.x - ex, this.pos.z - ez) < S * 0.5) return this.escape();

    this.hud.stat('Time', this.elapsed.toFixed(1));
    this.hud.stat('Exit', `${Math.round(Math.hypot(this.pos.x - ex, this.pos.z - ez))} m`);
    this.hud.stat('Mouse', this.input.locked ? 'locked' : 'click to lock', !this.input.locked);
  }

  slide(dx, dz) {
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    // Sample the four corners of the player's footprint.
    for (const [ox, oz] of [[-RADIUS, -RADIUS], [RADIUS, -RADIUS], [-RADIUS, RADIUS], [RADIUS, RADIUS]]) {
      if (this.solid(nx + ox, nz + oz)) return;
    }
    this.pos.x = nx;
    this.pos.z = nz;
  }

  escape() {
    this.audio.win();
    const t = Math.round(this.elapsed * 10) / 10;
    this.end(t, `Out in ${t}s.`);
  }

  dispose() { this.input.exitLock(); }
}

/** Recursive-backtracker maze on the odd cells of a (2n+1) grid. */
function carve(rng) {
  const g = Array.from({ length: GRID }, () => Array(GRID).fill(true));
  const stack = [[1, 1]];
  g[1][1] = false;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rng);
    let moved = false;
    for (const [dx, dz] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx <= 0 || nz <= 0 || nx >= GRID - 1 || nz >= GRID - 1 || !g[nz][nx]) continue;
      g[nz][nx] = false;
      g[z + dz / 2][x + dx / 2] = false;
      stack.push([nx, nz]);
      moved = true;
      break;
    }
    if (!moved) stack.pop();
  }
  // Punch a few loops so it isn't a single forced path.
  for (let i = 0; i < CELLS; i++) {
    const x = 2 + 2 * Math.floor(rng() * (CELLS - 1));
    const z = 1 + 2 * Math.floor(rng() * CELLS);
    g[z][x] = false;
  }
  return g;
}
