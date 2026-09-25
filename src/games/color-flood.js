import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, damp, randInt, PALETTE,
} from '../engine/utils.js';

const N = 8;
const SIZE = 1.5;
const OFF = ((N - 1) * SIZE) / 2;
const PICKS = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber, PALETTE.violet, PALETTE.red];
const MOVES = 22;

export default class ColorFlood extends Game {
  start() {
    sky(this.scene, '#1f2f4a', '#070b14', 30, 90);
    lights(this.scene, { sky: 0xc4dcff, groundCol: 0x141c30 });
    this.add(ground(60, 0x0e1526));

    this.grid = Array.from({ length: N }, () => Array.from({ length: N }, () => randInt(0, PICKS.length - 1)));
    this.cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const m = box(SIZE - 0.08, 0.4, SIZE - 0.08, glow(PICKS[this.grid[r][c]], { emissiveIntensity: 0.25 }));
        m.position.set(c * SIZE - OFF, 0.2, r * SIZE - OFF);
        m.userData = { r, c };
        this.cells.push(this.add(m));
      }
    }
    // The colour buttons, in a row below the board.
    this.buttons = PICKS.map((col, i) => {
      const b = box(1.7, 0.6, 1.7, glow(col, { emissiveIntensity: 0.6 }));
      b.position.set((i - (PICKS.length - 1) / 2) * 2.0, 0.3, OFF + 3.3);
      b.userData = { color: i };
      return this.add(b);
    });

    this.movesLeft = MOVES;
    this.burst = new Burst(this.scene, 80, 0.2);
    this.over = false;
    this.showCursor = true;

    this.camera.position.set(0, 15, 12);
    this.camera.lookAt(0, 0, 2);
    this.hud.hint('Pick a colour to flood outwards from the top-left corner · fill the whole board before you run out of moves');
  }

  /** Cells joined to the top-left corner by a path of the same colour. */
  region() {
    const target = this.grid[0][0];
    const seen = new Set(['0,0']);
    const stack = [[0, 0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N || seen.has(`${nr},${nc}`) || this.grid[nr][nc] !== target) continue;
        seen.add(`${nr},${nc}`);
        stack.push([nr, nc]);
      }
    }
    return [...seen].map((k) => k.split(',').map(Number));
  }

  flood(color) {
    if (this.over || color === this.grid[0][0]) return false;
    for (const [r, c] of this.region()) this.grid[r][c] = color;
    this.movesLeft--;
    this.audio.blip(color);
    this.burst.burst(this.cells[0].position, PICKS[color], 6, 5);
    const size = this.region().length;
    if (size === N * N) this.finish(true);
    else if (this.movesLeft <= 0) this.finish(false);
    return true;
  }

  update(dt) {
    if (this.clickedNow() && !this.over) {
      const hit = this.pickAt([...this.buttons, ...this.cells]);
      if (hit) {
        const u = hit.object.userData;
        this.flood(u.color !== undefined ? u.color : this.grid[u.r][u.c]);
      }
    }

    for (const cell of this.cells) {
      const col = PICKS[this.grid[cell.userData.r][cell.userData.c]];
      cell.material.color.setHex(col);
      cell.material.emissive.setHex(col);
    }
    this.burst.update(dt);
    this.hud.stat('Moves left', this.movesLeft, this.movesLeft <= 4);
    this.hud.stat('Flooded', `${this.region().length}/${N * N}`);
  }

  finish(won) {
    this.over = true;
    const captured = this.region().length;
    const score = captured + (won ? 20 + this.movesLeft * 5 : 0);
    (won ? this.audio.win() : this.audio.lose());
    this.end(score, won ? `Flooded the board with ${this.movesLeft} move${this.movesLeft === 1 ? '' : 's'} to spare.` : `Out of moves with ${captured} of ${N * N} squares flooded.`);
  }
}
