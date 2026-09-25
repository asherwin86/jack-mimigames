import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, damp, shuffle, randInt, PALETTE,
} from '../engine/utils.js';

const S = 2.1;
const TIME = 90;
// Bit i of a mask is an opening: 0 = north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x).
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export const rotateMask = (m) => ((m << 1) | (m >> 3)) & 15;
export const hasBit = (m, i) => (m >> i) & 1;

/** A random spanning tree on an n x n grid, as an array of masks (r * n + c), grown from (sr, sc). */
export function makeTree(n, sr, sc, rng = Math.random) {
  const masks = new Array(n * n).fill(0);
  const seen = new Set([sr * n + sc]);
  const frontier = [[sr, sc]];
  while (frontier.length) {
    const idx = Math.floor(rng() * frontier.length);
    const [r, c] = frontier[idx];
    const opts = shuffle([0, 1, 2, 3], rng).filter((d) => {
      const nr = r + DY[d];
      const nc = c + DX[d];
      return nr >= 0 && nr < n && nc >= 0 && nc < n && !seen.has(nr * n + nc);
    });
    if (!opts.length) { frontier.splice(idx, 1); continue; }
    const d = opts[0];
    const nr = r + DY[d];
    const nc = c + DX[d];
    masks[r * n + c] |= 1 << d;
    masks[nr * n + nc] |= 1 << ((d + 2) % 4);
    seen.add(nr * n + nc);
    frontier.push([nr, nc]);
  }
  return masks;
}

/** Which cells are lit: flood outward from the source through matching openings. */
export function powered(masks, n, sr, sc) {
  const lit = new Set([sr * n + sc]);
  const stack = [[sr, sc]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (let d = 0; d < 4; d++) {
      if (!hasBit(masks[r * n + c], d)) continue;
      const nr = r + DY[d];
      const nc = c + DX[d];
      if (nr < 0 || nr >= n || nc < 0 || nc >= n || lit.has(nr * n + nc)) continue;
      if (hasBit(masks[nr * n + nc], (d + 2) % 4)) { lit.add(nr * n + nc); stack.push([nr, nc]); }
    }
  }
  return lit;
}

export default class PipeTurn extends Game {
  start() {
    sky(this.scene, '#152c2a', '#050e0d', 30, 90);
    lights(this.scene, { sky: 0xc6fff0, groundCol: 0x0b1c1a });
    this.add(ground(70, 0x0a1514));
    this.burst = new Burst(this.scene, 60, 0.2);
    this.level = 0;
    this.solved = 0;
    this.timeLeft = TIME;
    this.pause = 0;
    this.group = null;
    this.showCursor = true;
    this.deal(3);
    this.camera.position.set(0, 16, 8);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click a tile to turn it a quarter · link every pipe back to the glowing source so the whole network lights up · each puzzle adds size and time');
  }

  deal(n) {
    if (this.group) this.scene.remove(this.group);
    this.group = this.add(new THREE.Group());
    this.n = n;
    this.sr = randInt(0, n - 1);
    this.sc = randInt(0, n - 1);
    const solution = makeTree(n, this.sr, this.sc);
    this.solution = solution;
    this.masks = solution.slice();
    this.tiles = [];
    const off = ((n - 1) * S) / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const holder = new THREE.Group();
        holder.position.set(c * S - off, 0, r * S - off);
        const plate = box(S - 0.15, 0.3, S - 0.15, mat(0x1d3a36, { roughness: 0.7 }));
        plate.position.y = 0.15;
        plate.userData.tile = i;
        holder.add(plate);
        const arms = new THREE.Group();
        const armMat = new THREE.MeshStandardMaterial({ color: 0x6f8f88, emissive: 0x000000 });
        const hub = cyl(0.28, 0.28, 0.3, armMat, { cast: false });
        hub.position.y = 0.4;
        hub.userData.tile = i;
        arms.add(hub);
        for (let d = 0; d < 4; d++) {
          if (!hasBit(solution[i], d)) continue;
          const arm = box(0.34, 0.3, S * 0.5, armMat, { cast: false });
          arm.position.set(DX[d] * S * 0.25, 0.4, DY[d] * S * 0.25);
          if (DX[d]) arm.rotation.y = Math.PI / 2;
          arm.userData.tile = i;
          arms.add(arm);
        }
        holder.add(arms);
        this.group.add(holder);
        this.tiles.push({ holder, arms, plate, armMat, turns: 0, angle: 0 });
      }
    }
    // Scramble: give every tile a random number of quarter turns (but never leave it solved).
    do {
      this.masks = solution.slice();
      for (let i = 0; i < n * n; i++) {
        const k = randInt(0, 3);
        for (let t = 0; t < k; t++) this.masks[i] = rotateMask(this.masks[i]);
        this.tiles[i].turns = k;
        this.tiles[i].angle = -k * Math.PI / 2;
        this.tiles[i].arms.rotation.y = this.tiles[i].angle;
      }
    } while (this.isSolved() && n > 1);
    this.turned = 0;
    const camY = 6 + n * 1.9;
    this.camera.position.set(0, camY, camY * 0.5);
    this.camera.lookAt(0, 0, 0.6);
    const src = this.tiles[this.sr * n + this.sc];
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshBasicMaterial({ color: PALETTE.amber }));
    beacon.position.set(0, 0.95, 0);
    src.holder.add(beacon);
  }

  isSolved() { return powered(this.masks, this.n, this.sr, this.sc).size === this.n * this.n; }

  /** Turns a tile a quarter clockwise. Returns true when that completes the network. */
  turn(i) {
    if (i < 0 || i >= this.masks.length) return false;
    this.masks[i] = rotateMask(this.masks[i]);
    this.tiles[i].turns++;
    this.tiles[i].angle -= Math.PI / 2;
    this.turned++;
    this.audio.blip(3);
    if (this.isSolved()) { this.levelDone(); return true; }
    return false;
  }

  levelDone() {
    this.solved++;
    this.timeLeft += 12 + this.n * 2;
    this.audio.good();
    this.hud.toast('CONNECTED!', 900);
    for (const t of this.tiles) this.burst.burst(t.holder.position.clone().setY(1), PALETTE.lime, 1, 6);
    this.pause = 1;
  }

  update(dt) {
    const lit = powered(this.masks, this.n, this.sr, this.sc);
    this.tiles.forEach((t, i) => {
      t.arms.rotation.y = damp(t.arms.rotation.y, t.angle, 18, dt);
      const on = lit.has(i);
      t.armMat.color.setHex(on ? PALETTE.amber : 0x6f8f88);
      t.armMat.emissive.setHex(on ? PALETTE.amber : 0x000000);
      t.armMat.emissiveIntensity = on ? 0.6 : 0;
    });
    this.burst.update(dt);
    this.hud.stat('Solved', this.solved);
    this.hud.stat('Grid', `${this.n}×${this.n}`);
    this.hud.stat('Lit', `${lit.size}/${this.n * this.n}`);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 15);

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) { this.level++; this.deal(Math.min(7, 3 + Math.floor((this.level + 1) / 2))); }
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();
    if (this.clickedNow()) {
      const hit = this.pickAt(this.group.children.flatMap((h) => [h.children[0], ...h.children[1].children]));
      if (hit) this.turn(hit.object.userData.tile);
    }
  }

  finish() {
    this.audio.lose();
    this.end(this.solved * 100, `You connected ${this.solved} network${this.solved === 1 ? '' : 's'}.`);
  }
}
