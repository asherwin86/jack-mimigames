import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, PALETTE,
} from '../engine/utils.js';

const N = 36;
const S = 0.9;
const OFF = (N * S) / 2 - S / 2;
const STEP = 0.085;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // up, right, down, left as [dx, dy] on the grid (dy = z)
const COLS = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber, PALETTE.violet];

/** Would a cycle at (x, y) heading `d` hit something in the next `n` cells? */
export function blockedAhead(occ, x, y, d, n = 1) {
  for (let i = 1; i <= n; i++) {
    const nx = x + DIRS[d][0] * i;
    const ny = y + DIRS[d][1] * i;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N || occ[ny * N + nx]) return true;
  }
  return false;
}

/** The AI's heading: keep going unless a wall/trail is near, then pick the turn with more room. */
export function aiTurn(occ, x, y, d, rng = Math.random) {
  const room = (dir) => { let n = 0; while (n < 12 && !blockedAhead(occ, x, y, dir, n + 1)) n++; return n; };
  const ahead = room(d);
  const left = (d + 3) % 4;
  const right = (d + 1) % 4;
  if (ahead >= 4 && rng() > 0.06) return d;
  const l = room(left);
  const r = room(right);
  if (ahead >= Math.max(l, r) && ahead > 1) return d;
  if (l === r) return rng() < 0.5 ? left : right;
  return l > r ? left : right;
}

export default class LightCycles extends Game {
  start() {
    sky(this.scene, '#060a1c', '#000006', 40, 110);
    lights(this.scene, { sky: 0x9fb6ff, groundCol: 0x080c1c, intensity: 0.8 });
    const floor = ground(N * S + 8, 0x05070f);
    this.add(floor);
    const grid = new THREE.GridHelper(N * S, N, 0x1c3a7a, 0x10224a);
    grid.position.y = 0.02;
    this.add(grid);
    for (const [x, z, w, d] of [[0, -N * S / 2 - 0.2, N * S + 0.8, 0.4], [0, N * S / 2 + 0.2, N * S + 0.8, 0.4], [-N * S / 2 - 0.2, 0, 0.4, N * S], [N * S / 2 + 0.2, 0, 0.4, N * S]]) {
      const w1 = box(w, 0.8, d, glow(PALETTE.blue, { emissiveIntensity: 0.7 }), { cast: false });
      w1.position.set(x, 0.4, z);
      this.add(w1);
    }
    this.burst = new Burst(this.scene, 100, 0.25);
    this.round = 0;
    this.score = 0;
    this.trailMeshes = [];
    this.cycles = [];
    this.wins = 0;
    this.newRound();
    this.camera.position.set(0, 30, 14);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('Arrows / WASD point your cycle (it cannot U-turn) · never touch a wall or any trail · trap the other cycles · each round adds a rival and speed');
  }

  newRound() {
    for (const m of this.trailMeshes) this.scene.remove(m);
    this.trailMeshes = [];
    for (const c of this.cycles) this.scene.remove(c.head);
    this.round++;
    this.occ = new Uint8Array(N * N);
    const bots = Math.min(4, 2 + Math.floor((this.round - 1) / 2));
    const starts = [[6, 18, 1], [29, 18, 3], [18, 6, 2], [18, 29, 0], [8, 8, 1]];
    this.cycles = [];
    for (let i = 0; i <= bots; i++) {
      const [x, y, d] = starts[i];
      const head = box(S * 0.9, S * 0.7, S * 0.9, glow(COLS[i], { emissiveIntensity: 0.9 }));
      head.position.set(x * S - OFF, 0.45, y * S - OFF);
      this.add(head);
      this.cycles.push({ x, y, d, alive: true, human: i === 0, col: COLS[i], head});
      this.occ[y * N + x] = 1;
    }
    this.acc = 0;
    this.pause = 1.2;
    this.speedMul = Math.min(1.6, 1 + (this.round - 1) * 0.08);
    this.roundEnd = 0;
    this.pending = null;
  }

  markTrail(c) {
    const m = box(S * 0.8, 0.5, S * 0.8, glow(c.col, { emissiveIntensity: 0.55 }), { cast: false });
    m.position.set(c.x * S - OFF, 0.25, c.y * S - OFF);
    this.add(m);
    this.trailMeshes.push(m);
  }

  crash(c) {
    c.alive = false;
    c.head.visible = false;
    this.burst.burst(c.head.position, c.col, 20, 9);
    this.audio.boom();
    if (!c.human) this.score += 10;
  }

  /** One grid step for every living cycle. */
  tick() {
    const wants = [];
    for (const c of this.cycles) {
      if (!c.alive) continue;
      if (c.human) { if (this.pending !== null) { c.d = this.pending; this.pending = null; } }
      else c.d = aiTurn(this.occ, c.x, c.y, c.d);
      wants.push([c, c.x + DIRS[c.d][0], c.y + DIRS[c.d][1]]);
    }
    // Two cycles entering the same cell both die.
    const dead = new Set();
    for (let i = 0; i < wants.length; i++) {
      const [c, nx, ny] = wants[i];
      if (nx < 0 || nx >= N || ny < 0 || ny >= N || this.occ[ny * N + nx]) dead.add(c);
      for (let j = i + 1; j < wants.length; j++) if (wants[j][1] === nx && wants[j][2] === ny) { dead.add(c); dead.add(wants[j][0]); }
    }
    for (const [c, nx, ny] of wants) {
      if (dead.has(c)) continue;
      this.markTrail(c);
      c.x = nx; c.y = ny;
      this.occ[ny * N + nx] = 1;
      c.head.position.set(nx * S - OFF, 0.45, ny * S - OFF);
      c.head.rotation.y = -c.d * Math.PI / 2;
    }
    for (const c of dead) this.crash(c);
  }

  /** Turn request: 'left' | 'right' relative, or an absolute heading 0-3. Never reverses. */
  steer(dir) {
    const me = this.cycles[0];
    if (!me.alive) return;
    const cur = this.pending ?? me.d;
    const d = dir === 'left' ? (cur + 3) % 4 : dir === 'right' ? (cur + 1) % 4 : dir;
    if (d !== (cur + 2) % 4) this.pending = d;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    if (this.input.hit('ArrowUp', 'KeyW') || this.input.gpHit(12)) this.steer(0);
    else if (this.input.hit('ArrowRight', 'KeyD') || this.input.gpHit(15)) this.steer(1);
    else if (this.input.hit('ArrowDown', 'KeyS') || this.input.gpHit(13)) this.steer(2);
    else if (this.input.hit('ArrowLeft', 'KeyA') || this.input.gpHit(14)) this.steer(3);
    if (this.input.gpHit(4)) this.steer('left');
    if (this.input.gpHit(5)) this.steer('right');

    if (this.pause > 0) { this.pause -= dt; }
    else if (this.roundEnd > 0) {
      this.roundEnd -= dt;
      if (this.roundEnd <= 0) {
        if (!this.cycles[0].alive) return this.finish();
        this.wins++;
        this.score += 50;
        this.newRound();
      }
    } else {
      this.acc += dt;
      while (this.acc >= STEP / this.speedMul) {
        this.acc -= STEP / this.speedMul;
        this.tick();
        const alive = this.cycles.filter((c) => c.alive);
        if (!this.cycles[0].alive || alive.length <= 1) { this.roundEnd = 1.3; break; }
      }
    }
    this.hud.stat('Score', this.score);
    this.hud.stat('Round', this.round);
    this.hud.stat('Rivals', this.cycles.filter((c) => c.alive && !c.human).length);
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `You lasted ${this.round} round${this.round === 1 ? '' : 's'} and scored ${this.score}.`);
  }
}
