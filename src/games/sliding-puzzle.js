import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, mat, labelPlane, Burst, damp, randInt, PALETTE, COLORS,
} from '../engine/utils.js';

const N = 3;
const SIZE = 2.5;
const OFF = ((N - 1) * SIZE) / 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // [dc, dr]

export default class SlidingPuzzle extends Game {
  start() {
    sky(this.scene, '#26204d', '#080714', 30, 90);
    lights(this.scene, { sky: 0xd0c4ff, groundCol: 0x191532 });
    this.add(ground(60, 0x100e22));
    const frame = box(N * SIZE + 0.8, 0.4, N * SIZE + 0.8, mat(0x1b1740), { cast: false });
    frame.position.y = -0.1;
    this.add(frame);

    // grid[r][c] = tile number 1..8, or 0 for the blank. Scrambled by legal moves from the solved board, so it is always solvable.
    this.grid = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => (r * N + c + 1) % (N * N)));
    this.tiles = new Map();
    for (let n = 1; n < N * N; n++) {
      const t = box(SIZE - 0.2, 0.55, SIZE - 0.2, mat(COLORS[(n - 1) % COLORS.length], { roughness: 0.5 }));
      t.position.y = 0.3;
      const label = labelPlane(String(n), SIZE - 0.7, SIZE - 0.7, { fg: '#0b0e17' });
      label.rotation.x = -Math.PI / 2;
      label.position.y = 0.29;
      t.add(label);
      t.userData.n = n;
      this.tiles.set(n, this.add(t));
    }
    this.scramble();
    this.snapTiles();

    this.moves = 0;
    this.elapsed = 0;
    this.burst = new Burst(this.scene, 70, 0.2);
    this.showCursor = true;

    this.camera.position.set(0, 12.5, 7.5);
    this.camera.lookAt(0, 0, 0.4);
    this.hud.hint('Click a tile next to the gap to slide it (or use the arrow keys) · put 1 to 8 in order');
  }

  blank() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.grid[r][c] === 0) return { r, c };
    return { r: N - 1, c: N - 1 };
  }

  solved() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.grid[r][c] !== (r * N + c + 1) % (N * N)) return false;
    return true;
  }

  scramble() {
    let last = null;
    for (let i = 0; i < 90 || this.solved(); i++) {
      const b = this.blank();
      const opts = DIRS.map(([dc, dr]) => ({ r: b.r + dr, c: b.c + dc })).filter((p) => p.r >= 0 && p.r < N && p.c >= 0 && p.c < N
        && !(last && p.r === last.r && p.c === last.c));
      const p = opts[randInt(0, opts.length - 1)];
      this.grid[b.r][b.c] = this.grid[p.r][p.c];
      this.grid[p.r][p.c] = 0;
      last = b;
    }
  }

  cellPos(r, c) { return [c * SIZE - OFF, r * SIZE - OFF]; }

  snapTiles() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const n = this.grid[r][c];
        if (!n) continue;
        const [x, z] = this.cellPos(r, c);
        this.tiles.get(n).position.set(x, 0.3, z);
      }
    }
  }

  /** Slides the tile at (r, c) into the gap if it is next to it. */
  slide(r, c) {
    if (r < 0 || c < 0 || r >= N || c >= N) return false;
    const b = this.blank();
    if (Math.abs(b.r - r) + Math.abs(b.c - c) !== 1) return false;
    this.grid[b.r][b.c] = this.grid[r][c];
    this.grid[r][c] = 0;
    this.moves++;
    this.audio.blip(2);
    if (this.solved()) this.finish();
    return true;
  }

  update(dt) {
    this.elapsed += dt;

    if (this.clickedNow()) {
      const hit = this.pickAt([...this.tiles.values()]);
      if (hit) {
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (this.grid[r][c] === hit.object.userData.n) this.slide(r, c);
      }
    }
    // Arrow keys move the tile in that direction into the gap (so Left slides the tile on the gap's right, and so on).
    const b = this.blank();
    if (this.input.hit('ArrowLeft', 'KeyA') || this.input.gpHit(14)) this.slide(b.r, b.c + 1);
    else if (this.input.hit('ArrowRight', 'KeyD') || this.input.gpHit(15)) this.slide(b.r, b.c - 1);
    else if (this.input.hit('ArrowUp', 'KeyW') || this.input.gpHit(12)) this.slide(b.r + 1, b.c);
    else if (this.input.hit('ArrowDown', 'KeyS') || this.input.gpHit(13)) this.slide(b.r - 1, b.c);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const n = this.grid[r][c];
        if (!n) continue;
        const [x, z] = this.cellPos(r, c);
        const t = this.tiles.get(n);
        t.position.x = damp(t.position.x, x, 16, dt);
        t.position.z = damp(t.position.z, z, 16, dt);
        const home = n === r * N + c + 1;
        t.material.emissive.setHex(home ? 0x224422 : 0x000000);
      }
    }

    this.burst.update(dt);
    this.hud.stat('Time', this.elapsed.toFixed(1));
    this.hud.stat('Moves', this.moves);
  }

  finish() {
    const t = Math.round(this.elapsed * 10) / 10;
    this.burst.burst(this.tiles.get(5).position, PALETTE.lime, 30, 9);
    this.audio.win();
    this.end(t, `Solved in ${t}s and ${this.moves} moves.`);
  }
}
