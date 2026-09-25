import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  ground, lights, sky, glow, mat, Burst, damp, clamp, randInt, PALETTE,
} from '../engine/utils.js';

const N = 8;
const KINDS = 6;
const S = 1.55;
const OFF = ((N - 1) * S) / 2;
const TIME = 75;
const COLS = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber, PALETTE.violet, 0xff7a3d];

/** Indexes (r * n + c) of every gem sitting in a run of three or more. */
export function findMatches(grid, n = N) {
  const out = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = grid[r][c];
      if (v < 0) continue;
      if (c + 2 < n && grid[r][c + 1] === v && grid[r][c + 2] === v) [0, 1, 2].forEach((k) => out.add(r * n + c + k));
      if (r + 2 < n && grid[r + 1][c] === v && grid[r + 2][c] === v) [0, 1, 2].forEach((k) => out.add((r + k) * n + c));
    }
  }
  return out;
}

/** Remove matched cells, let the rest fall, and fill from the top. Returns the new grid. */
export function collapse(grid, cleared, fill, n = N) {
  const g = grid.map((row) => row.slice());
  for (const i of cleared) g[Math.floor(i / n)][i % n] = -1;
  for (let c = 0; c < n; c++) {
    const col = [];
    for (let r = n - 1; r >= 0; r--) if (g[r][c] >= 0) col.push(g[r][c]);
    for (let r = n - 1; r >= 0; r--) g[r][c] = col.length ? col.shift() : fill();
  }
  return g;
}

/** Is there any swap that would make a match? */
export function hasMove(grid, n = N) {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        if (r2 >= n || c2 >= n) continue;
        const g = grid.map((row) => row.slice());
        [g[r][c], g[r2][c2]] = [g[r2][c2], g[r][c]];
        if (findMatches(g, n).size) return true;
      }
    }
  }
  return false;
}

/** A random full grid with no matches already sitting on it and at least one move. */
export function freshGrid(n = N, rng = Math.random) {
  for (;;) {
    const g = [];
    for (let r = 0; r < n; r++) {
      g.push([]);
      for (let c = 0; c < n; c++) {
        let v;
        do { v = Math.floor(rng() * KINDS); }
        while ((c >= 2 && g[r][c - 1] === v && g[r][c - 2] === v) || (r >= 2 && g[r - 1][c] === v && g[r - 2][c] === v));
        g[r].push(v);
      }
    }
    if (hasMove(g, n)) return g;
  }
}

function gemGeometry(kind) {
  switch (kind) {
    case 0: return new THREE.OctahedronGeometry(0.62);
    case 1: return new THREE.IcosahedronGeometry(0.6);
    case 2: return new THREE.BoxGeometry(0.9, 0.9, 0.9);
    case 3: return new THREE.CylinderGeometry(0.5, 0.5, 0.9, 6);
    case 4: return new THREE.ConeGeometry(0.62, 1.0, 5);
    default: return new THREE.TorusGeometry(0.4, 0.2, 8, 16);
  }
}

export default class GemSwap extends Game {
  start() {
    sky(this.scene, '#2a1740', '#09050f', 30, 90);
    lights(this.scene, { sky: 0xf0d8ff, groundCol: 0x1c1030 });
    this.add(ground(70, 0x120a1c));
    this.geos = Array.from({ length: KINDS }, (_, k) => gemGeometry(k));
    this.grid = freshGrid();
    this.gems = [];
    for (let r = 0; r < N; r++) {
      this.gems.push([]);
      for (let c = 0; c < N; c++) this.gems[r].push(this.makeGem(this.grid[r][c], r, c));
    }
    this.burst = new Burst(this.scene, 120, 0.2);
    this.score = 0;
    this.timeLeft = TIME;
    this.selected = null;
    this.phase = 'idle';
    this.phaseT = 0;
    this.combo = 0;
    this.swapBack = null;
    this.showCursor = true;
    this.camera.position.set(0, 16, 6.5);
    this.camera.lookAt(0, 0, 0.4);
    this.hud.hint('Click a gem, then a neighbour to swap them · line up three or more of the same shape and colour · chains score big and add a second each');
  }

  makeGem(kind, r, c) {
    const m = new THREE.Mesh(this.geos[kind], glow(COLS[kind], { emissiveIntensity: 0.25 }));
    m.position.set(c * S - OFF, 0.7, r * S - OFF);
    m.castShadow = true;
    m.userData = { kind, r, c };
    this.scene.add(m);
    return m;
  }

  swap(r1, c1, r2, c2) {
    [this.grid[r1][c1], this.grid[r2][c2]] = [this.grid[r2][c2], this.grid[r1][c1]];
    [this.gems[r1][c1], this.gems[r2][c2]] = [this.gems[r2][c2], this.gems[r1][c1]];
    this.gems[r1][c1].userData.r = r1; this.gems[r1][c1].userData.c = c1;
    this.gems[r2][c2].userData.r = r2; this.gems[r2][c2].userData.c = c2;
  }

  /** Tries to swap two neighbouring gems. Returns true when it made a match (otherwise it swaps back). */
  trySwap(r1, c1, r2, c2) {
    if (this.phase !== 'idle') return false;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    this.swap(r1, c1, r2, c2);
    this.selected = null;
    if (findMatches(this.grid).size) {
      this.phase = 'swap';
      this.phaseT = 0.16;
      this.combo = 0;
      return true;
    }
    this.phase = 'swap';
    this.phaseT = 0.16;
    this.swapBack = [r1, c1, r2, c2];
    this.audio.bad();
    return false;
  }

  resolve() {
    const hits = findMatches(this.grid);
    if (!hits.size) {
      this.phase = 'idle';
      if (!hasMove(this.grid)) this.reshuffle();
      return;
    }
    this.combo++;
    const pts = hits.size * 10 * this.combo + (hits.size > 3 ? (hits.size - 3) * 20 : 0);
    this.score += pts;
    this.timeLeft = Math.min(TIME + 20, this.timeLeft + (this.combo > 1 ? 1 : 0));
    this.audio.blip(clamp(this.combo * 2, 1, 12));
    if (this.combo > 1) this.hud.toast(`CHAIN ×${this.combo}`, 700);
    for (const i of hits) {
      const g = this.gems[Math.floor(i / N)][i % N];
      this.burst.burst(g.position, COLS[g.userData.kind], 5, 6);
      this.scene.remove(g);
    }
    // Rebuild the arrays: survivors fall, new gems drop in from above.
    const next = collapse(this.grid, hits, () => Math.floor(Math.random() * KINDS));
    const oldGems = this.gems;
    const newGems = Array.from({ length: N }, () => new Array(N));
    for (let c = 0; c < N; c++) {
      const survivors = [];
      for (let r = N - 1; r >= 0; r--) if (!hits.has(r * N + c)) survivors.push(oldGems[r][c]);
      let fresh = 0;
      for (let r = N - 1; r >= 0; r--) {
        let g = survivors.shift();
        if (!g) {
          g = this.makeGem(next[r][c], r, c);
          g.position.y = 0.7;
          g.position.z = -OFF - S * (++fresh);
        }
        g.userData.r = r; g.userData.c = c;
        newGems[r][c] = g;
      }
    }
    this.grid = next;
    this.gems = newGems;
    this.phase = 'fall';
    this.phaseT = 0.32;
  }

  reshuffle() {
    this.hud.toast('NO MOVES · SHUFFLE', 900);
    this.grid = freshGrid();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      this.scene.remove(this.gems[r][c]);
      this.gems[r][c] = this.makeGem(this.grid[r][c], r, c);
    }
  }

  update(dt) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const g = this.gems[r][c];
        g.position.x = damp(g.position.x, c * S - OFF, 16, dt);
        g.position.z = damp(g.position.z, r * S - OFF, 16, dt);
        const sel = this.selected && this.selected[0] === r && this.selected[1] === c;
        g.position.y = damp(g.position.y, sel ? 1.3 : 0.7, 14, dt);
        g.rotation.y += dt * (sel ? 4 : 0.6);
        g.material.emissiveIntensity = sel ? 0.9 : 0.25;
      }
    }
    this.burst.update(dt);

    if (this.phase !== 'idle') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.phase === 'swap') {
          if (this.swapBack) { const [a, b, c, d] = this.swapBack; this.swapBack = null; this.swap(a, b, c, d); this.phase = 'idle'; }
          else this.resolve();
        } else this.resolve();
      }
    } else {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) return this.finish();
      if (this.clickedNow()) {
        const all = this.gems.flat();
        const hit = this.pickAt(all);
        if (hit) {
          const { r, c } = hit.object.userData;
          if (!this.selected) { this.selected = [r, c]; this.audio.blip(2); }
          else if (this.selected[0] === r && this.selected[1] === c) this.selected = null;
          else if (Math.abs(this.selected[0] - r) + Math.abs(this.selected[1] - c) === 1) this.trySwap(this.selected[0], this.selected[1], r, c);
          else this.selected = [r, c];
        }
      }
    }
    this.hud.stat('Score', this.score);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 10);
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `You scored ${this.score} points.`);
  }
}
