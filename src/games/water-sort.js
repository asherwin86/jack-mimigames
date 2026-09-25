import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, mat, Burst, damp, shuffle, PALETTE, COLORS,
} from '../engine/utils.js';

const CAP = 4;
const TIME = 150;
const LIQUID = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.blue, 0xff7a3d, 0xf2f6ff];

/** Pours the top run of a tube into another. Returns a new tube list, or null if it is not allowed. */
export function pour(tubes, from, to) {
  if (from === to) return null;
  const src = tubes[from];
  const dst = tubes[to];
  if (!src.length || dst.length >= CAP) return null;
  const colour = src.at(-1);
  if (dst.length && dst.at(-1) !== colour) return null;
  let run = 0;
  while (run < src.length && src[src.length - 1 - run] === colour) run++;
  const n = Math.min(run, CAP - dst.length);
  const next = tubes.map((t) => t.slice());
  for (let i = 0; i < n; i++) next[to].push(next[from].pop());
  return next;
}

export const isSorted = (tubes) => tubes.every((t) => t.length === 0 || (t.length === CAP && t.every((v) => v === t[0])));

/** Depth-first search with a node cap: is this arrangement solvable? */
export function solvable(tubes, budget = 30000) {
  const seen = new Set();
  let nodes = 0;
  const key = (ts) => ts.map((t) => t.join('')).sort().join('|');
  const go = (ts) => {
    if (isSorted(ts)) return true;
    if (++nodes > budget) return false;
    const k = key(ts);
    if (seen.has(k)) return false;
    seen.add(k);
    for (let a = 0; a < ts.length; a++) {
      if (!ts[a].length || (ts[a].length === CAP && ts[a].every((v) => v === ts[a][0]))) continue;
      for (let b = 0; b < ts.length; b++) {
        if (a === b) continue;
        if (!ts[b].length && new Set(ts[a]).size === 1) continue;   // pointless: moving a uniform tube into an empty one
        const next = pour(ts, a, b);
        if (next && go(next)) return true;
      }
    }
    return false;
  };
  return go(tubes);
}

/** A shuffled, solvable puzzle with `colours` colours and two spare tubes. */
export function makePuzzle(colours, rng = Math.random) {
  for (let tries = 0; tries < 60; tries++) {
    const flat = shuffle(Array.from({ length: colours * CAP }, (_, i) => Math.floor(i / CAP)), rng);
    const tubes = [];
    for (let i = 0; i < colours; i++) tubes.push(flat.slice(i * CAP, (i + 1) * CAP));
    tubes.push([], []);
    if (!isSorted(tubes) && solvable(tubes)) return tubes;
  }
  const tubes = [];   // fallback: a nearly-sorted board
  for (let i = 0; i < colours; i++) tubes.push(Array(CAP).fill(i));
  tubes[0][3] = 1; tubes[1][3] = 0;
  tubes.push([], []);
  return tubes;
}

export default class WaterSort extends Game {
  start() {
    sky(this.scene, '#16323a', '#050d10', 30, 90);
    lights(this.scene, { sky: 0xcff7ff, groundCol: 0x0c1c22 });
    this.add(ground(70, 0x0a1518));
    this.burst = new Burst(this.scene, 60, 0.2);
    this.level = 0;
    this.solved = 0;
    this.timeLeft = TIME;
    this.pause = 0;
    this.group = null;
    this.held = null;
    this.showCursor = true;
    this.deal(3);
    this.camera.position.set(0, 9, 12);
    this.camera.lookAt(0, 1.5, 0);
    this.hud.hint('Click a tube, then click another to pour the top colour across · you can only pour onto the same colour or into an empty tube · sort every colour into its own tube');
  }

  deal(colours) {
    if (this.group) this.scene.remove(this.group);
    this.group = this.add(new THREE.Group());
    this.tubes = makePuzzle(colours);
    this.held = null;
    this.moves = 0;
    this.pieces = [];
    const n = this.tubes.length;
    const gap = Math.min(2.6, 22 / n);
    this.tubeMeshes = this.tubes.map((_, i) => {
      const x = (i - (n - 1) / 2) * gap;
      const glass = cyl(0.9, 0.9, CAP * 1.05 + 0.4, new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, roughness: 0.1 }), { cast: false });
      glass.position.set(x, (CAP * 1.05 + 0.4) / 2, 0);
      glass.userData.tube = i;
      this.group.add(glass);
      return glass;
    });
    this.gap = gap;
    this.refill();
  }

  refill() {
    for (const p of this.pieces) this.group.remove(p);
    this.pieces = [];
    const n = this.tubes.length;
    this.tubes.forEach((t, i) => {
      const x = (i - (n - 1) / 2) * this.gap;
      t.forEach((v, k) => {
        const seg = cyl(0.78, 0.78, 1, mat(LIQUID[v % LIQUID.length], { roughness: 0.3 }), { cast: false });
        seg.position.set(x, 0.55 + k * 1.05, 0);
        seg.userData.tube = i;
        seg.userData.baseY = 0.55 + k * 1.05;
        this.pieces.push(seg);
        this.group.add(seg);
      });
    });
  }

  /** Select a source tube, then a destination. Returns true when a pour happened. */
  select(i) {
    if (i < 0 || i >= this.tubes.length) return false;
    if (this.held === null) {
      if (!this.tubes[i].length) return false;
      this.held = i;
      this.audio.blip(2);
      return false;
    }
    const from = this.held;
    this.held = null;
    if (from === i) return false;
    const next = pour(this.tubes, from, i);
    if (!next) { this.audio.bad(); return false; }
    this.tubes = next;
    this.moves++;
    this.refill();
    this.audio.blip(6);
    if (isSorted(this.tubes)) this.levelDone();
    return true;
  }

  levelDone() {
    this.solved++;
    this.timeLeft += 25;
    this.audio.good();
    this.hud.toast('SORTED!', 900);
    this.burst.burst(new THREE.Vector3(0, 3, 0), PALETTE.lime, 30, 10);
    this.pause = 1;
  }

  update(dt) {
    this.burst.update(dt);
    this.tubeMeshes.forEach((g, i) => { g.position.y = damp(g.position.y, (CAP * 1.05 + 0.4) / 2 + (this.held === i ? 0.8 : 0), 16, dt); });
    this.pieces.forEach((p) => { p.position.y = damp(p.position.y, p.userData.baseY + (p.userData.tube === this.held ? 0.8 : 0), 16, dt); });
    this.hud.stat('Sorted', this.solved);
    this.hud.stat('Colours', new Set(this.tubes.flat()).size);
    this.hud.stat('Moves', this.moves);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 20);

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        this.level++;
        this.deal(Math.min(8, 3 + this.level));
      }
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();
    if (this.clickedNow()) {
      const hit = this.pickAt([...this.tubeMeshes, ...this.pieces]);
      if (hit) this.select(hit.object.userData.tube);
    }
    for (let i = 0; i < Math.min(9, this.tubes.length); i++) if (this.input.hit(`Digit${i + 1}`)) this.select(i);
  }

  finish() {
    this.audio.lose();
    this.end(this.solved * 100, `You sorted ${this.solved} puzzle${this.solved === 1 ? '' : 's'}.`);
  }
}
