import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, damp, randInt, PALETTE,
} from '../engine/utils.js';

const N = 4;
const SIZE = 2.6;
const OFF = ((N - 1) * SIZE) / 2;
const COLOURS = {
  2: 0xeee4da, 4: 0xede0c8, 8: 0xf2b179, 16: 0xf59563, 32: 0xf67c5f, 64: 0xf65e3b, 128: 0xedcf72,
  256: 0xedcc61, 512: 0xedc850, 1024: 0xedc53f, 2048: 0xedc22e,
};

/** Slides and merges one row towards index 0. Returns the new row and the points gained. */
export function slideRow(row) {
  const tiles = row.filter(Boolean);
  const out = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) { out.push(tiles[i] * 2); gained += tiles[i] * 2; i++; }
    else out.push(tiles[i]);
  }
  while (out.length < row.length) out.push(0);
  return { row: out, gained };
}

export default class Merge2048 extends Game {
  start() {
    sky(this.scene, '#3a2c1c', '#0d0a06', 40, 110);
    lights(this.scene, { sky: 0xfff0d8, groundCol: 0x2a2014 });
    this.add(ground(80, 0x1a140c));
    const board = box(N * SIZE + 0.8, 0.5, N * SIZE + 0.8, mat(0x776e65, { roughness: 0.7 }), { cast: false });
    board.position.y = -0.1;
    this.add(board);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const slot = box(SIZE - 0.15, 0.1, SIZE - 0.15, mat(0xbbada0, { roughness: 0.9 }), { cast: false });
        slot.position.set(c * SIZE - OFF, 0.2, r * SIZE - OFF);
        this.add(slot);
      }
    }

    this.grid = Array.from({ length: N }, () => Array(N).fill(0));
    this.meshes = Array.from({ length: N }, () => Array(N).fill(null));
    this.burst = new Burst(this.scene, 60, 0.2);
    this.score = 0;
    this.best = 2;
    this.moves = 0;
    this.swipeStart = null;
    this.addTile(); this.addTile();

    this.camera.position.set(0, 13, 7.5);
    this.camera.lookAt(0, 0, 0.3);
    this.hud.hint('Arrows / WASD (or swipe) slide every tile · equal tiles merge · reach 2048 — or just score big');
  }

  addTile() {
    const empty = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!this.grid[r][c]) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[randInt(0, empty.length - 1)];
    this.grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  }

  /** Slides the board. dir = 'left' | 'right' | 'up' | 'down'. Returns true if anything moved. */
  move(dir) {
    const before = JSON.stringify(this.grid);
    let gained = 0;
    const get = (i, j) => {   // the j-th cell along line i, counted from the side tiles slide towards
      if (dir === 'left') return [i, j];
      if (dir === 'right') return [i, N - 1 - j];
      if (dir === 'up') return [j, i];
      return [N - 1 - j, i];
    };
    for (let i = 0; i < N; i++) {
      const line = [];
      for (let j = 0; j < N; j++) { const [r, c] = get(i, j); line.push(this.grid[r][c]); }
      const res = slideRow(line);
      gained += res.gained;
      for (let j = 0; j < N; j++) { const [r, c] = get(i, j); this.grid[r][c] = res.row[j]; }
    }
    if (JSON.stringify(this.grid) === before) return false;
    this.moves++;
    this.score += gained;
    this.best = Math.max(this.best, ...this.grid.flat());
    this.addTile();
    this.audio.blip(Math.min(12, Math.round(Math.log2(Math.max(2, gained || 2)))));
    if (gained) { this.audio.good(); this.hud.toast(`+${gained}`, 400); }
    if (this.stuck()) this.finish();
    return true;
  }

  stuck() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!this.grid[r][c]) return false;
        if (c + 1 < N && this.grid[r][c] === this.grid[r][c + 1]) return false;
        if (r + 1 < N && this.grid[r][c] === this.grid[r + 1][c]) return false;
      }
    }
    return true;
  }

  update(dt) {
    let dir = null;
    if (this.input.hit('ArrowLeft', 'KeyA') || this.input.gpHit(14)) dir = 'left';
    else if (this.input.hit('ArrowRight', 'KeyD') || this.input.gpHit(15)) dir = 'right';
    else if (this.input.hit('ArrowUp', 'KeyW') || this.input.gpHit(12)) dir = 'up';
    else if (this.input.hit('ArrowDown', 'KeyS') || this.input.gpHit(13)) dir = 'down';
    // Swipes: note where the finger went down, and read the direction when it lifts.
    if (this.input.clicked) this.swipeStart = this.input.pixel.clone();
    if (this.input.releasedClick && this.swipeStart) {
      const dx = this.input.pixel.x - this.swipeStart.x;
      const dy = this.input.pixel.y - this.swipeStart.y;
      if (Math.hypot(dx, dy) > 28) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      this.swipeStart = null;
    }
    if (dir && !this.finished) this.move(dir);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = this.grid[r][c];
        let m = this.meshes[r][c];
        if (!v) { if (m) m.visible = false; continue; }
        if (!m) {
          m = box(SIZE - 0.25, 0.5, SIZE - 0.25, mat(0xffffff, { roughness: 0.5 }));
          const label = labelPlane(String(v), SIZE - 0.6, SIZE - 0.6, { fg: '#3a3026', scale: 0.55 });
          label.rotation.x = -Math.PI / 2;
          label.position.y = 0.26;
          m.add(label);
          m.userData.label = label;
          m.userData.value = 0;
          m.position.set(c * SIZE - OFF, 0.4, r * SIZE - OFF);
          this.meshes[r][c] = this.add(m);
        }
        m.visible = true;
        if (m.userData.value !== v) {
          m.userData.value = v;
          m.material.color.setHex(COLOURS[v] ?? 0x3c3a32);
          setLabel(m.userData.label, String(v), { fg: v <= 4 ? '#3a3026' : '#ffffff', scale: v >= 1024 ? 0.42 : v >= 128 ? 0.5 : 0.6 });
          m.scale.setScalar(1.12);
        }
        m.scale.x = damp(m.scale.x, 1, 12, dt); m.scale.y = m.scale.x; m.scale.z = m.scale.x;
      }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Best tile', this.best);
    this.hud.stat('Moves', this.moves);
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `No moves left. Best tile ${this.best}, ${this.moves} moves.`);
  }
}
