import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, damp, shuffle, PALETTE,
} from '../engine/utils.js';

const COLS = 10;
const ROWS = 20;
const CELL = 1;
const SHAPES = {
  I: { color: PALETTE.cyan, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { color: PALETTE.amber, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  T: { color: PALETTE.violet, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { color: PALETTE.lime, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { color: PALETTE.red, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { color: PALETTE.blue, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { color: PALETTE.pink, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};
const NAMES = Object.keys(SHAPES);
const LINE_POINTS = [0, 100, 300, 500, 800];

/** Rotates a piece's cells a quarter turn clockwise inside its 4x4 box (I) or 3x3 box (the rest; O never changes). */
export function rotate(name, cells) {
  if (name === 'O') return cells;
  const n = name === 'I' ? 4 : 3;
  return cells.map(([x, y]) => [n - 1 - y, x]);
}

export default class TetraDrop extends Game {
  start() {
    sky(this.scene, '#241a4a', '#07040f', 50, 140);
    lights(this.scene, { sky: 0xd0c4ff, groundCol: 0x180f30 });
    this.add(ground(80, 0x0d0819));

    // Well walls and floor
    const wallMat = mat(0x3a2f6b, { roughness: 0.6 });
    for (const [w, h, x, y] of [[0.5, ROWS + 1, -COLS / 2 - 0.25, ROWS / 2 - 0.5], [0.5, ROWS + 1, COLS / 2 + 0.25, ROWS / 2 - 0.5], [COLS + 1, 0.5, 0, -0.75]]) {
      const b = box(w, h, 1.4, wallMat);
      b.position.set(x, y, 0);
      this.add(b);
    }

    // A lighter back panel with a faint grid so the cells read against the dark.
    const back = box(COLS, ROWS, 0.2, mat(0x1b1440, { roughness: 0.9 }), { cast: false });
    back.position.set(0, ROWS / 2 - 0.5, -0.7);
    this.add(back);
    for (let i = 1; i < COLS; i++) {
      const l = box(0.03, ROWS, 0.05, mat(0x30265f), { cast: false, receive: false });
      l.position.set(i - COLS / 2, ROWS / 2 - 0.5, -0.58);
      this.add(l);
    }
    for (let j = 1; j < ROWS; j++) {
      const l = box(COLS, 0.03, 0.05, mat(0x30265f), { cast: false, receive: false });
      l.position.set(0, j - 0.5, -0.58);
      this.add(l);
    }

    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));   // board[y][x] = colour or null; y = 0 is the bottom
    this.cellMeshes = [];
    for (let i = 0; i < COLS * ROWS + 8; i++) {
      const m = box(CELL * 0.92, CELL * 0.92, CELL * 0.92, glow(0xffffff, { emissiveIntensity: 0.35 }), { cast: false });
      m.visible = false;
      this.cellMeshes.push(this.add(m));
    }
    this.bag = [];
    this.next = this.takeFromBag();
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.fall = 0;
    this.das = 0;
    this.over = false;
    this.burst = new Burst(this.scene, 90, 0.2);
    this.spawn();

    this.camera.position.set(0, ROWS / 2 - 0.5, 27);
    this.camera.lookAt(0, ROWS / 2 - 0.5, 0);
    this.hud.hint('← → move · ↑ or W rotate · ↓ soft drop · Space hard drop · clear rows to score');
  }

  takeFromBag() {
    if (!this.bag.length) this.bag = shuffle([...NAMES]);
    return this.bag.pop();
  }

  spawn() {
    this.name = this.next;
    this.next = this.takeFromBag();
    this.cells = SHAPES[this.name].cells.map(([x, y]) => [x, y]);
    this.px = Math.floor((COLS - (this.name === 'I' ? 4 : 3)) / 2);
    this.py = ROWS - 2;     // the piece's box origin (bottom-left); its cells sit at y + cell y
    if (this.collides(this.cells, this.px, this.py)) this.gameOver();
  }

  collides(cells, ox, oy) {
    for (const [cx, cy] of cells) {
      const x = ox + cx;
      const y = oy + (1 - cy) + (this.name === 'I' ? 0 : 0);   // cells are stored top-down; flip so y grows upward
      if (x < 0 || x >= COLS || y < 0) return true;
      if (y < ROWS && this.board[y][x]) return true;
    }
    return false;
  }

  tryMove(dx, dy) {
    if (this.collides(this.cells, this.px + dx, this.py + dy)) return false;
    this.px += dx; this.py += dy;
    return true;
  }

  tryRotate() {
    const rotated = rotate(this.name, this.cells);
    for (const kick of [0, -1, 1, -2, 2]) {   // nudge sideways if it would hit a wall
      if (!this.collides(rotated, this.px + kick, this.py)) {
        this.cells = rotated;
        this.px += kick;
        this.audio.blip(4);
        return true;
      }
    }
    return false;
  }

  lock() {
    const colour = SHAPES[this.name].color;
    for (const [cx, cy] of this.cells) {
      const x = this.px + cx;
      const y = this.py + (1 - cy);
      if (y >= ROWS) return this.gameOver();
      this.board[y][x] = colour;
    }
    this.audio.thud();
    let cleared = 0;
    for (let y = 0; y < ROWS; y++) {
      if (this.board[y].every(Boolean)) {
        for (let x = 0; x < COLS; x++) this.burst.burst({ x: x - COLS / 2 + 0.5, y: y + 0.5, z: 0 }, this.board[y][x], 2, 5);
        this.board.splice(y, 1);
        this.board.push(Array(COLS).fill(null));
        y--;
        cleared++;
      }
    }
    if (cleared) {
      this.lines += cleared;
      this.score += LINE_POINTS[cleared] * this.level;
      this.level = 1 + Math.floor(this.lines / 10);
      this.audio[cleared >= 4 ? 'win' : 'good']();
      if (cleared >= 4) this.hud.toast('TETRA!', 900);
    }
    if (!this.over) this.spawn();
  }

  hardDrop() {
    let n = 0;
    while (this.tryMove(0, -1)) n++;
    this.score += n * 2;
    this.lock();
  }

  update(dt) {
    if (this.over) return;

    // Left / right with auto-repeat while held
    const dir = (this.input.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.input.key('KeyA', 'ArrowLeft') ? 1 : 0) || (this.input.gpButton(15) ? 1 : 0) - (this.input.gpButton(14) ? 1 : 0);
    if (dir && (this.input.hit('KeyD', 'ArrowRight', 'KeyA', 'ArrowLeft') || this.input.gpHit(14) || this.input.gpHit(15))) { this.tryMove(dir, 0); this.das = 0.16; }
    else if (dir) { this.das -= dt; if (this.das <= 0) { this.tryMove(dir, 0); this.das = 0.05; } }
    else this.das = 0;

    if (this.input.hit('KeyW', 'ArrowUp', 'KeyX') || this.input.gpHit(0) || this.input.gpHit(12)) this.tryRotate();
    if (this.input.hit('Space') || this.input.gpHit(3)) { this.hardDrop(); if (this.over) return; }

    // Gravity, faster with the level or while Down is held
    const soft = this.input.key('KeyS', 'ArrowDown') || this.input.gpButton(13);
    const interval = soft ? 0.04 : Math.max(0.07, 0.75 * Math.pow(0.86, this.level - 1));
    this.fall += dt;
    while (this.fall >= interval && !this.over) {
      this.fall -= interval;
      if (!this.tryMove(0, -1)) { this.lock(); this.fall = 0; break; }
      if (soft) this.score += 1;
    }

    this.draw();
    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lines', this.lines);
    this.hud.stat('Level', this.level);
    this.hud.stat('Next', this.next);
  }

  draw() {
    let i = 0;
    const put = (x, y, colour, ghost = false) => {
      const m = this.cellMeshes[i++];
      m.visible = true;
      m.position.set(x - COLS / 2 + 0.5, y + 0.5, 0);
      m.material.color.setHex(colour);
      m.material.emissive.setHex(colour);
      m.material.emissiveIntensity = ghost ? 0.08 : 0.35;
      m.material.transparent = ghost;
      m.material.opacity = ghost ? 0.3 : 1;
    };
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (this.board[y][x]) put(x, y, this.board[y][x]);
    if (!this.over) {
      // where it would land
      let gy = this.py;
      while (!this.collides(this.cells, this.px, gy - 1)) gy--;
      for (const [cx, cy] of this.cells) put(this.px + cx, gy + (1 - cy), SHAPES[this.name].color, true);
      for (const [cx, cy] of this.cells) if (this.py + (1 - cy) < ROWS) put(this.px + cx, this.py + (1 - cy), SHAPES[this.name].color);
    }
    for (; i < this.cellMeshes.length; i++) this.cellMeshes[i].visible = false;
  }

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.audio.lose();
    this.end(this.score, `${this.lines} line${this.lines === 1 ? '' : 's'} cleared, level ${this.level}.`);
  }
}
