import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, lights, sky, glow, mat, labelPlane, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const W = 7;                // half-width of the board
const BINS = [50, 20, 8, 4, 2, 4, 8, 20, 50];
const BIN_W = (W * 2) / BINS.length;
const DISCS = 15;
const G = 26;
const RD = 0.3;             // disc radius
const RP = 0.16;            // peg radius
const ROWS = 10;
const ROW_GAP = 1.4;
const TOP = 19;

/** All the pegs: a staggered triangle of rows, plus a column of small pegs forming the bin dividers. */
export function makePegs() {
  const pegs = [];
  for (let r = 0; r < ROWS; r++) {
    const y = TOP - r * ROW_GAP;
    const xs = [];
    if (r % 2 === 0) { xs.push(-6.75); for (let c = 1; c <= 8; c++) xs.push(-6.3 + c * 1.4); xs.push(6.75); }
    else { xs.push(-6.95); for (let c = 0; c <= 8; c++) xs.push(-5.6 + c * 1.4); xs.push(6.95); }   // outer pegs hug the walls so nothing can jam in a corner
    for (const x of xs) pegs.push({ x, y, r: RP });
  }
  for (let b = 1; b < BINS.length; b++) for (let y = 0.3; y <= 2.5; y += 0.4) pegs.push({ x: -W + b * BIN_W, y, r: 0.08 });
  return pegs;
}
const PEGS = makePegs();

/** Advances a disc {x, y, vx, vy} by dt using substeps. Returns true once it has landed in a bin. */
export function stepDisc(d, dt, rng = Math.random) {
  const sub = 5;
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    d.vy -= G * h;
    d.x += d.vx * h;
    d.y += d.vy * h;
    if (d.x < -W + RD) { d.x = -W + RD; d.vx = Math.abs(d.vx) * 0.5; }
    if (d.x > W - RD) { d.x = W - RD; d.vx = -Math.abs(d.vx) * 0.5; }
    for (const p of PEGS) {
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) continue;
      const dist = Math.hypot(dx, dy);
      const min = RD + p.r;
      if (dist >= min || dist < 1e-6) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      d.x = p.x + nx * min;
      d.y = p.y + ny * min;
      const vn = d.vx * nx + d.vy * ny;
      if (vn < 0) {
        d.vx -= (1 + 0.4) * vn * nx;
        d.vy -= (1 + 0.4) * vn * ny;
        d.vx += (rng() - 0.5) * 0.5;   // tiny scuffs keep a disc from balancing on a peg
      }
    }
    if (d.y < 0.35) { d.y = 0.35; return true; }
  }
  // A disc that has hardly moved for a while (balanced on a peg, jammed against the wall) gets a shake.
  d.idle = (d.idle ?? 0) + dt;
  if (Math.hypot(d.x - (d.px ?? d.x), d.y - (d.py ?? d.y)) > 0.2) { d.px = d.x; d.py = d.y; d.idle = 0; }
  else if (d.idle > 0.6) { d.vx += (rng() - 0.5) * 7; d.vy += 2.5; d.px = d.x; d.py = d.y; d.idle = 0; }
  return false;
}

export const binOf = (x) => clamp(Math.floor((x + W) / BIN_W), 0, BINS.length - 1);

export default class Plinko extends Game {
  start() {
    sky(this.scene, '#1a1030', '#08040f', 60, 180);
    lights(this.scene, { sky: 0xe0d0ff, groundCol: 0x140a24 });
    const back = box(W * 2 + 1.4, TOP + 6, 0.4, mat(0x16102c));
    back.position.set(0, (TOP + 6) / 2 - 1, -0.5);
    this.add(back);
    for (const s of [-1, 1]) {
      const wall = box(0.4, TOP + 6, 1, glow(PALETTE.violet, { emissiveIntensity: 0.5 }), { cast: false });
      wall.position.set(s * (W + 0.4), (TOP + 6) / 2 - 1, 0);
      this.add(wall);
    }
    this.pegMeshes = PEGS.map((p) => {
      const m = cyl(p.r, p.r, 0.6, glow(p.r > 0.1 ? 0xd8d0ff : 0x7a70b0, { emissiveIntensity: 0.4 }), { cast: false });
      m.rotation.x = Math.PI / 2;
      m.position.set(p.x, p.y, 0);
      return this.add(m);
    });
    BINS.forEach((v, i) => {
      const lp = labelPlane(String(v), BIN_W * 0.9, BIN_W * 0.9, { size: 96, fg: v >= 50 ? '#ffd23f' : v >= 20 ? '#7ee081' : '#d8d0ff', scale: 0.55 });
      lp.position.set(-W + (i + 0.5) * BIN_W, 3.4, 0.05);
      this.add(lp);
    });
    this.discs = [];
    this.burst = new Burst(this.scene, 60, 0.2);
    this.left = DISCS;
    this.score = 0;
    this.dropX = 0;
    this.cool = 0;
    this.results = [];
    this.showCursor = true;
    this.camera.position.set(0, 9, 24);
    this.camera.lookAt(0, 9.5, 0);
    this.hud.hint('Move the mouse to choose where to drop · click (or press Space / A) to release a disc · it bounces down through the pegs into a bin · the edge bins pay 50 · 15 discs');
  }

  /** Drops a disc from x. Returns true if one was released. */
  drop(x = this.dropX) {
    if (this.left <= 0 || this.cool > 0 || this.discs.length >= 4) return false;
    const m = ball(RD, glow(PALETTE.amber, { emissiveIntensity: 0.6 }), { cast: false });
    m.scale.z = 0.6;
    m.position.set(x, TOP + 1.6, 0);
    this.add(m);
    this.discs.push({ x: clamp(x, -W + RD, W - RD), y: TOP + 1.6, vx: 0, vy: 0, mesh: m });
    this.left--;
    this.cool = 0.25;
    this.audio.blip(4);
    return true;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    this.cool -= dt;
    const p = this.planePoint(0);
    if (p) this.dropX = clamp(p.x, -W + 0.6, W - 0.6);
    const kx = this.input.axisX();
    if (kx) this.dropX = clamp(this.dropX + kx * 8 * dt, -W + 0.6, W - 0.6);
    if (this.clickedNow() || this.input.hit('Space')) this.drop();

    for (let i = this.discs.length - 1; i >= 0; i--) {
      const d = this.discs[i];
      const landed = stepDisc(d, dt);
      d.mesh.position.set(d.x, d.y, 0);
      if (landed) {
        const b = binOf(d.x);
        this.score += BINS[b];
        this.results.push(BINS[b]);
        this.hud.toast(`+${BINS[b]}`, 600);
        this.audio[BINS[b] >= 20 ? 'win' : 'blip'](...(BINS[b] >= 20 ? [] : [3]));
        this.burst.burst(d.mesh.position, BINS[b] >= 20 ? PALETTE.lime : PALETTE.amber, 8, 6);
        this.scene.remove(d.mesh);
        this.discs.splice(i, 1);
      }
    }
    this.hud.stat('Score', this.score);
    this.hud.stat('Discs left', this.left);
    if (this.left <= 0 && !this.discs.length) return this.finish();
  }

  finish() {
    this.audio[this.score >= 100 ? 'win' : 'lose']();
    this.end(this.score, `${DISCS} discs scored ${this.score} points.`);
  }
}
