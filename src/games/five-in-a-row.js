import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const N = 11;
const S = 1.3;
const OFF = ((N - 1) * S) / 2;
const YOU = 1;
const BOT = 2;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** The winning five as [[r, c] x5] if either side has one, else null. */
export function winnerOf(b) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = b[r][c];
      if (!v) continue;
      for (const [dr, dc] of DIRS) {
        const line = [[r, c]];
        for (let k = 1; k < 5; k++) {
          const y = r + dr * k;
          const x = c + dc * k;
          if (y < 0 || y >= N || x < 0 || x >= N || b[y][x] !== v) break;
          line.push([y, x]);
        }
        if (line.length === 5) return { who: v, line };
      }
    }
  }
  return null;
}

/** Score for `who` putting a stone at (r, c): longer open lines are worth a lot more. */
function lineValue(b, r, c, who) {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let run = 1;
    let open = 0;
    for (const sign of [1, -1]) {
      let y = r + dr * sign;
      let x = c + dc * sign;
      while (y >= 0 && y < N && x >= 0 && x < N && b[y][x] === who) { run++; y += dr * sign; x += dc * sign; }
      if (y >= 0 && y < N && x >= 0 && x < N && b[y][x] === 0) open++;
    }
    if (run >= 5) total += 100000;
    else if (run === 4) total += open === 2 ? 10000 : open === 1 ? 1000 : 0;
    else if (run === 3) total += open === 2 ? 900 : open === 1 ? 60 : 0;
    else if (run === 2) total += open === 2 ? 50 : open === 1 ? 8 : 0;
    else total += open;
  }
  return total;
}

/** The bot's cell. Level 0 mostly wanders, 1+ always takes a win and blocks a four, higher levels weigh threats better. */
export function botMove(b, level, rng = Math.random) {
  const cells = [];
  let any = false;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { if (b[r][c]) any = true; else cells.push([r, c]); }
  if (!any) return [Math.floor(N / 2), Math.floor(N / 2)];
  const near = cells.filter(([r, c]) => { for (let y = r - 2; y <= r + 2; y++) for (let x = c - 2; x <= c + 2; x++) if (b[y]?.[x]) return true; return false; });
  const pool = near.length ? near : cells;
  if (rng() < [0.55, 0.2, 0.08, 0.02][Math.min(3, level)]) return pool[Math.floor(rng() * pool.length)];
  let best = pool[0];
  let bestV = -Infinity;
  const defence = [0.7, 0.9, 1.0, 1.05][Math.min(3, level)];
  for (const [r, c] of pool) {
    const v = lineValue(b, r, c, BOT) + lineValue(b, r, c, YOU) * defence + rng() * 2;
    if (v > bestV) { bestV = v; best = [r, c]; }
  }
  return best;
}

export default class FiveInARow extends Game {
  start() {
    sky(this.scene, '#3a2c18', '#0e0a05', 30, 90);
    lights(this.scene, { sky: 0xffe6b8, groundCol: 0x2a1c0c });
    this.add(ground(70, 0x1a1208));
    const board = box(N * S + 0.6, 0.4, N * S + 0.6, mat(0xb98a4a, { roughness: 0.7 }));
    board.position.y = -0.05;
    this.add(board);
    this.spots = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = box(S - 0.08, 0.06, S - 0.08, mat((r + c) % 2 ? 0xc99a5a : 0xb98a4a, { roughness: 0.7 }));
      t.position.set(c * S - OFF, 0.16, r * S - OFF);
      t.userData = { r, c };
      this.spots.push(this.add(t));
    }
    this.stones = [];
    this.marker = this.add(box(S * 0.9, 0.08, S * 0.9, glow(PALETTE.lime, { emissiveIntensity: 0.6 })));
    this.marker.visible = false;
    this.burst = new Burst(this.scene, 60, 0.2);
    this.wins = 0;
    this.level = 0;
    this.showCursor = true;
    this.newGame();
    this.camera.position.set(0, 16, 7.5);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click a point to place a stone · get five in a row (any direction) before the bot does · win to face a sharper bot');
  }

  newGame() {
    for (const s of this.stones) this.scene.remove(s);
    this.stones = [];
    this.board = Array.from({ length: N }, () => new Array(N).fill(0));
    this.turn = YOU;
    this.wait = 0;
    this.result = null;
    this.after = 0;
    this.moves = 0;
  }

  /** Puts a stone down. Returns true if the point was free and play is on. */
  place(r, c, who) {
    if (this.result || this.board[r]?.[c] !== 0) return false;
    this.board[r][c] = who;
    this.moves++;
    const s = cyl(S * 0.4, S * 0.4, 0.3, glow(who === YOU ? 0x15151a : 0xf2f2f2, { emissiveIntensity: who === YOU ? 0 : 0.15 }));
    s.position.set(c * S - OFF, 2, r * S - OFF);
    s.userData.y = 0.4;
    this.stones.push(this.add(s));
    this.marker.position.set(c * S - OFF, 0.22, r * S - OFF);
    this.marker.visible = true;
    this.audio.blip(who === YOU ? 3 : 6);
    const w = winnerOf(this.board);
    if (w) {
      this.result = w.who === YOU ? 'win' : 'loss';
      this.after = 1.5;
      for (const [y, x] of w.line) this.burst.burst({ x: x * S - OFF, y: 0.6, z: y * S - OFF }, w.who === YOU ? PALETTE.lime : PALETTE.red, 8, 6);
      this.audio[w.who === YOU ? 'win' : 'bad']();
      this.hud.toast(w.who === YOU ? 'FIVE! YOU WIN' : 'BOT GOT FIVE', 1300);
    } else if (this.moves >= N * N) {
      this.result = 'draw';
      this.after = 1;
    } else {
      this.turn = who === YOU ? BOT : YOU;
      this.wait = rand(0.4, 0.8);
    }
    return true;
  }

  update(dt) {
    for (const s of this.stones) s.position.y = damp(s.position.y, s.userData.y, 18, dt);
    this.burst.update(dt);
    if (!this.result) {
      if (this.turn === YOU) {
        if (this.clickedNow()) {
          const hit = this.pickAt(this.spots);
          if (hit) this.place(hit.object.userData.r, hit.object.userData.c, YOU);
        }
      } else if ((this.wait -= dt) <= 0) {
        const [r, c] = botMove(this.board, this.level);
        this.place(r, c, BOT);
      }
    } else if ((this.after -= dt) <= 0) {
      if (this.result === 'win') { this.wins++; this.level++; this.newGame(); }
      else if (this.result === 'draw') this.newGame();
      else return this.finish();
    }
    this.hud.stat('Wins', this.wins);
    this.hud.stat('Bot', ['easy', 'fair', 'sharp', 'tough'][Math.min(3, this.level)]);
    this.hud.stat('Turn', this.result ? '—' : this.turn === YOU ? 'you' : 'bot');
  }

  finish() {
    this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} in a row before the bot got five.`);
  }
}
