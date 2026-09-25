import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, damp, randInt, PALETTE,
} from '../engine/utils.js';

const N = 4;
const SIZE = 2.3;
const OFF = ((N - 1) * SIZE) / 2;
const START_TIME = 75;
const BONUS = 5;       // seconds added for every puzzle cleared

export default class LightsOut extends Game {
  start() {
    sky(this.scene, '#0f2a3a', '#04090e', 30, 90);
    lights(this.scene, { sky: 0x9fe8ff, groundCol: 0x0a1c26 });
    this.add(ground(60, 0x0b1820));

    this.cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = box(SIZE - 0.25, 0.5, SIZE - 0.25, glow(PALETTE.cyan, { emissiveIntensity: 0 }));
        cell.position.set(c * SIZE - OFF, 0.25, r * SIZE - OFF);
        cell.userData = { r, c, on: false, glow: 0 };
        this.cells.push(this.add(cell));
      }
    }

    this.burst = new Burst(this.scene, 80, 0.2);
    this.cleared = 0;
    this.moves = 0;
    this.timeLeft = START_TIME;
    this.next = 0;
    this.showCursor = true;
    this.newPuzzle();

    this.camera.position.set(0, 12, 7);
    this.camera.lookAt(0, 0, 0.3);
    this.hud.hint('Click a light to flip it and its neighbours · turn every light off · each puzzle you clear adds 5 seconds');
  }

  cell(r, c) { return r >= 0 && r < N && c >= 0 && c < N ? this.cells[r * N + c] : null; }

  /** Flips a cell and the four beside it. */
  press(r, c) {
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cell = this.cell(r + dr, c + dc);
      if (cell) cell.userData.on = !cell.userData.on;
    }
  }

  allOff() { return this.cells.every((c) => !c.userData.on); }

  /** A fresh puzzle: start from all-off and press a few random cells, so it is always solvable. */
  newPuzzle() {
    for (const c of this.cells) c.userData.on = false;
    const presses = randInt(3, Math.min(9, 4 + this.cleared));
    const picked = new Set();
    while (picked.size < presses) picked.add(randInt(0, N * N - 1));
    for (const i of picked) this.press(Math.floor(i / N), i % N);
    if (this.allOff()) { this.press(0, 0); picked.add(0); }
    this.solution = picked;   // the cells that undo it (pressing each once, in any order)
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();

    if (this.next > 0) {
      this.next -= dt;
      if (this.next <= 0) this.newPuzzle();
    } else if (this.clickedNow()) {
      const hit = this.pickAt(this.cells);
      if (hit) {
        const { r, c } = hit.object.userData;
        this.press(r, c);
        this.moves++;
        this.audio.blip(3);
        if (this.allOff()) {
          this.cleared++;
          this.timeLeft = Math.min(this.timeLeft + BONUS, 120);
          this.next = 0.6;
          this.audio.good();
          this.hud.toast(`CLEARED · +${BONUS} s`, 700);
          for (const cell of this.cells) this.burst.burst(cell.position, PALETTE.lime, 3, 6);
        }
      }
    }

    for (const cell of this.cells) {
      const d = cell.userData;
      d.glow = damp(d.glow, d.on ? 1 : 0, 14, dt);
      cell.material.emissiveIntensity = d.glow * 1.1;
      cell.material.color.setHex(d.on ? 0xfff2a8 : 0x28405a);
      cell.material.emissive.setHex(d.on ? 0xffd23f : 0x000000);
      cell.position.y = 0.25 + d.glow * 0.25;
    }

    this.burst.update(dt);
    this.hud.stat('Cleared', this.cleared);
    this.hud.stat('Time', Math.ceil(this.timeLeft), this.timeLeft < 10);
    this.hud.stat('Lit', this.cells.filter((c) => c.userData.on).length);
  }

  finish() {
    this.audio.lose();
    this.end(this.cleared, `${this.cleared} puzzle${this.cleared === 1 ? '' : 's'} cleared in ${this.moves} moves.`);
  }
}
