import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, ground, lights, sky, mat, labelPlane, Burst, randInt, PALETTE,
} from '../engine/utils.js';

const N = 9;
const MINES = 10;
const S = 1.5;
const OFF = ((N - 1) * S) / 2;
const NUM_COL = ['', '#4fc3ff', '#5ee08a', '#ff6b6b', '#c7a6ff', '#ffb84d', '#4fe3d0', '#f2f6ff', '#9aa4b5'];

/** The in-bounds cells around (r, c). */
export function neighbours(r, c, rows = N, cols = N) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols) out.push([r + dr, c + dc]);
    }
  }
  return out;
}

/** A set of mine positions (r * cols + c), never on or next to the first click. */
export function placeMines(rows, cols, count, safeR, safeC, rng = Math.random) {
  const banned = new Set([safeR * cols + safeC, ...neighbours(safeR, safeC, rows, cols).map(([r, c]) => r * cols + c)]);
  const cells = [];
  for (let i = 0; i < rows * cols; i++) if (!banned.has(i)) cells.push(i);
  const mines = new Set();
  while (mines.size < count && cells.length) mines.add(cells.splice(Math.floor(rng() * cells.length), 1)[0]);
  return mines;
}

export default class Minesweeper extends Game {
  start() {
    sky(this.scene, '#22303f', '#0a0f16', 30, 90);
    lights(this.scene, { sky: 0xcfe6ff, groundCol: 0x141c26 });
    this.add(ground(60, 0x10161e));

    this.cells = [];
    this.flags = [];
    this.mines = null;
    this.adj = [];
    this.open = [];
    this.flagged = [];
    for (let r = 0; r < N; r++) {
      this.adj.push(new Array(N).fill(0));
      this.open.push(new Array(N).fill(false));
      this.flagged.push(new Array(N).fill(false));
      for (let c = 0; c < N; c++) {
        const cell = box(S - 0.1, 0.4, S - 0.1, mat(0x6a80b8, { roughness: 0.6 }));
        cell.position.set(c * S - OFF, 0.2, r * S - OFF);
        cell.userData = { r, c };
        this.cells.push(this.add(cell));
        const flag = new THREE.Group();
        const pole = cyl(0.04, 0.04, 0.7, mat(0xdddddd), { cast: false });
        pole.position.y = 0.35;
        const cloth = box(0.4, 0.26, 0.04, mat(PALETTE.red), { cast: false });
        cloth.position.set(0.2, 0.62, 0);
        flag.add(pole, cloth);
        flag.position.set(c * S - OFF, 0.4, r * S - OFF);
        flag.visible = false;
        this.flags.push(this.add(flag));
      }
    }
    this.labels = new Map();
    this.mineMeshes = [];

    this.burst = new Burst(this.scene, 80, 0.2);
    this.opened = 0;
    this.placed = false;
    this.elapsed = 0;
    this.flagMode = false;
    this.over = null;
    this.overT = 0;
    this.showCursor = true;

    this.camera.position.set(0, 15.5, 6.5);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click a tile to dig · numbers count the mines next to them · right-click or F (or B) to plant flags · click a number with all its flags placed to clear around it');
  }

  cellAt(r, c) { return this.cells[r * N + c]; }
  flagCount() { return this.flagged.flat().filter(Boolean).length; }
  isMine(r, c) { return !!this.mines?.has(r * N + c); }

  /** Digs a tile. The first dig is always safe, and a zero floods outward. */
  dig(r, c) {
    if (this.over || r < 0 || r >= N || c < 0 || c >= N || this.flagged[r][c]) return;
    if (this.open[r][c]) return this.chord(r, c);
    if (!this.placed) {
      this.mines = placeMines(N, N, MINES, r, c);
      for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) this.adj[rr][cc] = neighbours(rr, cc).filter(([a, b]) => this.isMine(a, b)).length;
      this.placed = true;
    }
    if (this.isMine(r, c)) return this.boom(r, c);
    const stack = [[r, c]];
    while (stack.length) {
      const [y, x] = stack.pop();
      if (this.open[y][x] || this.flagged[y][x]) continue;
      this.open[y][x] = true;
      this.opened++;
      this.show(y, x);
      if (this.adj[y][x] === 0) for (const nb of neighbours(y, x)) stack.push(nb);
    }
    this.audio.blip(2);
    if (this.opened === N * N - MINES) this.win();
  }

  toggleFlag(r, c) {
    if (this.over || this.open[r]?.[c] !== false) return;
    this.flagged[r][c] = !this.flagged[r][c];
    this.flags[r * N + c].visible = this.flagged[r][c];
    this.audio.blip(5);
  }

  /** On an opened number whose flags are all placed, dig every other tile around it. */
  chord(r, c) {
    const around = neighbours(r, c);
    if (this.adj[r][c] === 0 || around.filter(([a, b]) => this.flagged[a][b]).length !== this.adj[r][c]) return;
    for (const [a, b] of around) if (!this.open[a][b] && !this.flagged[a][b]) this.dig(a, b);
  }

  show(r, c) {
    const cell = this.cellAt(r, c);
    cell.position.y = -0.05;
    cell.material.color.setHex(0x151d2b);
    this.flags[r * N + c].visible = false;
    const n = this.adj[r][c];
    if (n > 0 && !this.labels.has(r * N + c)) {
      const lp = labelPlane(String(n), S * 0.8, S * 0.8, { fg: NUM_COL[n] });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(c * S - OFF, 0.16, r * S - OFF);
      this.labels.set(r * N + c, this.add(lp));
    }
  }

  boom(r, c) {
    this.over = 'lost';
    this.overT = 1.6;
    this.audio.boom();
    for (const i of this.mines) {
      const rr = Math.floor(i / N);
      const cc = i % N;
      const m = ball(0.4, mat(rr === r && cc === c ? PALETTE.red : 0x222222));
      m.position.set(cc * S - OFF, 0.45, rr * S - OFF);
      this.mineMeshes.push(this.add(m));
      this.cellAt(rr, cc).material.color.setHex(0x5a2a2a);
      this.burst.burst(m.position, PALETTE.red, 6, 6);
    }
  }

  win() {
    this.over = 'won';
    this.overT = 1.4;
    this.audio.win();
    for (const cell of this.cells) this.burst.burst(cell.position, PALETTE.lime, 1, 6);
  }

  score() {
    return this.opened * 10 + (this.over === 'won' ? 100 + Math.max(0, 300 - Math.floor(this.elapsed)) : 0);
  }

  update(dt) {
    if (this.over) {
      this.overT -= dt;
      this.burst.update(dt);
      if (this.overT <= 0) {
        const score = this.score();
        this.end(score, this.over === 'won'
          ? `Cleared the field in ${Math.floor(this.elapsed)} s!`
          : `You hit a mine after clearing ${this.opened} tiles.`);
      }
      return;
    }
    if (this.placed) this.elapsed += dt;

    if (this.input.hit('KeyF') || this.input.gpHit(1)) {
      this.flagMode = !this.flagMode;
      this.hud.toast(this.flagMode ? 'FLAG MODE' : 'DIG MODE', 600);
    }
    const wantFlag = this.input.clickedButton?.(2);
    if (wantFlag || this.clickedNow()) {
      const hit = this.pickAt(this.cells);
      if (hit) {
        const { r, c } = hit.object.userData;
        if (wantFlag || this.flagMode) this.toggleFlag(r, c); else this.dig(r, c);
      }
    }

    this.burst.update(dt);
    this.hud.stat('Mines left', MINES - this.flagCount());
    this.hud.stat('Cleared', `${this.opened}/${N * N - MINES}`);
    this.hud.stat('Time', Math.floor(this.elapsed));
    this.hud.stat('Mode', this.flagMode ? 'FLAG' : 'dig');
  }
}
