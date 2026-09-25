import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, labelPlane, Burst, damp, randInt, PALETTE,
} from '../engine/utils.js';

const N = 8;
const S = 1.55;
const OFF = ((N - 1) * S) / 2;
const MOVES = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

/** Squares a knight on (r, c) can jump to that have not been visited: `seen` is a Set of r*N+c. */
export function knightMoves(r, c, seen = new Set(), n = N) {
  return MOVES.map(([dr, dc]) => [r + dr, c + dc]).filter(([a, b]) => a >= 0 && a < n && b >= 0 && b < n && !seen.has(a * n + b));
}

export default class KnightsTour extends Game {
  start() {
    sky(this.scene, '#1c2b3a', '#080d13', 30, 90);
    lights(this.scene, { sky: 0xd6ecff, groundCol: 0x101a24 });
    this.add(ground(60, 0x0c131b));

    this.tiles = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = box(S - 0.06, 0.3, S - 0.06, mat((r + c) % 2 ? 0x3a4a63 : 0x8a97ad, { roughness: 0.6 }));
        t.position.set(c * S - OFF, 0.15, r * S - OFF);
        t.userData = { r, c, base: (r + c) % 2 ? 0x3a4a63 : 0x8a97ad };
        this.tiles.push(this.add(t));
      }
    }
    this.knight = this.add(ball(0.55, glow(PALETTE.amber, { emissiveIntensity: 0.4 })));
    this.knight.scale.y = 1.4;
    this.seen = new Set();
    this.labels = [];
    this.burst = new Burst(this.scene, 60, 0.2);
    this.pos = null;
    this.visits = 0;
    this.over = 0;
    this.showCursor = true;
    this.hud.hint('Pick any square to start, then hop like a knight (an L: two along, one across) · never land on a square twice · visit all 64');

    this.camera.position.set(0, 15.5, 7);
    this.camera.lookAt(0, 0, 0.6);
    this.knight.visible = false;
  }

  /** Puts the knight on (r, c) — any square for the first move, then only legal jumps. Returns true if it moved. */
  go(r, c) {
    if (this.over > 0) return false;
    if (this.pos) {
      if (!knightMoves(this.pos[0], this.pos[1], this.seen).some(([a, b]) => a === r && b === c)) return false;
    } else if (r < 0 || r >= N || c < 0 || c >= N) return false;
    this.pos = [r, c];
    this.seen.add(r * N + c);
    this.visits++;
    const tile = this.tiles[r * N + c];
    tile.material.color.setHex(0x2f7f5a);
    const lp = labelPlane(String(this.visits), S * 0.7, S * 0.7, { fg: '#ffffff', size: 96 });
    lp.rotation.x = -Math.PI / 2;
    lp.position.set(c * S - OFF, 0.32, r * S - OFF);
    this.labels.push(this.add(lp));
    this.knight.visible = true;
    this.audio.blip(Math.min(12, 1 + Math.floor(this.visits / 5)));
    this.burst.burst(tile.position, PALETTE.lime, 4, 4);
    if (this.visits === N * N || !knightMoves(r, c, this.seen).length) this.over = 1.1;
    return true;
  }

  score() { return this.visits + (this.visits === N * N ? 36 : 0); }

  update(dt) {
    if (this.pos) {
      this.knight.position.x = damp(this.knight.position.x, this.pos[1] * S - OFF, 16, dt);
      this.knight.position.z = damp(this.knight.position.z, this.pos[0] * S - OFF, 16, dt);
      this.knight.position.y = 1 + Math.abs(Math.sin(this.time * 4)) * 0.15;
    }
    const legal = this.pos ? knightMoves(this.pos[0], this.pos[1], this.seen) : [];
    for (const t of this.tiles) {
      const { r, c } = t.userData;
      if (this.seen.has(r * N + c)) continue;
      t.material.color.setHex(legal.some(([a, b]) => a === r && b === c) ? 0x3fbf6a : t.userData.base);
    }
    this.burst.update(dt);

    if (this.over > 0) {
      this.over -= dt;
      if (this.over <= 0) this.finish();
      return;
    }
    if (this.clickedNow()) {
      const hit = this.pickAt(this.tiles);
      if (hit) this.go(hit.object.userData.r, hit.object.userData.c) || this.audio.bad();
    }
    this.hud.stat('Squares', `${this.visits}/${N * N}`);
    this.hud.stat('Moves open', legal.length);
  }

  finish() {
    const done = this.visits === N * N;
    this.audio[done ? 'win' : 'lose']();
    this.end(this.score(), done ? 'A full tour — every square visited!' : `The knight got stuck after ${this.visits} squares.`);
  }
}
