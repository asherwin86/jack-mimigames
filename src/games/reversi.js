import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const N = 8;
const S = 1.6;
const OFF = ((N - 1) * S) / 2;
const YOU = 1;   // black
const BOT = 2;   // white
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
// Corners are gold, squares next to them are poison, edges are decent.
const WEIGHT = [
  [100, -20, 10, 5, 5, 10, -20, 100],
  [-20, -40, -2, -2, -2, -2, -40, -20],
  [10, -2, 1, 1, 1, 1, -2, 10],
  [5, -2, 1, 0, 0, 1, -2, 5],
  [5, -2, 1, 0, 0, 1, -2, 5],
  [10, -2, 1, 1, 1, 1, -2, 10],
  [-20, -40, -2, -2, -2, -2, -40, -20],
  [100, -20, 10, 5, 5, 10, -20, 100],
];

export function startBoard() {
  const b = Array.from({ length: N }, () => new Array(N).fill(0));
  b[3][3] = BOT; b[4][4] = BOT; b[3][4] = YOU; b[4][3] = YOU;
  return b;
}

/** The discs that would flip if `who` played (r, c): [[r, c], ...] (empty means an illegal move). */
export function flips(b, r, c, who) {
  if (b[r][c]) return [];
  const other = who === YOU ? BOT : YOU;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let y = r + dr;
    let x = c + dc;
    while (y >= 0 && y < N && x >= 0 && x < N && b[y][x] === other) { line.push([y, x]); y += dr; x += dc; }
    if (line.length && y >= 0 && y < N && x >= 0 && x < N && b[y][x] === who) out.push(...line);
  }
  return out;
}

export function legalMoves(b, who) {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (flips(b, r, c, who).length) out.push([r, c]);
  return out;
}

export function applyMove(b, r, c, who) {
  const f = flips(b, r, c, who);
  const next = b.map((row) => row.slice());
  next[r][c] = who;
  for (const [y, x] of f) next[y][x] = who;
  return next;
}

export const count = (b, who) => b.flat().filter((v) => v === who).length;

function evalBoard(b, who) {
  const other = who === YOU ? BOT : YOU;
  let s = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) s += (b[r][c] === who ? 1 : b[r][c] === other ? -1 : 0) * WEIGHT[r][c];
  return s + (legalMoves(b, who).length - legalMoves(b, other).length) * 3;
}

/** The bot's move. Level 0 is random, 1 greedy, 2 positional, 3+ looks two moves ahead. Null if it must pass. */
export function botMove(b, level, rng = Math.random) {
  const moves = legalMoves(b, BOT);
  if (!moves.length) return null;
  if (level <= 0 || rng() < ([0.5, 0.15, 0.05][level] ?? 0)) return moves[Math.floor(rng() * moves.length)];
  let best = null;
  let bestV = -Infinity;
  for (const [r, c] of moves) {
    let v;
    if (level === 1) v = flips(b, r, c, BOT).length;
    else {
      const nb = applyMove(b, r, c, BOT);
      v = level === 2 ? evalBoard(nb, BOT) : (() => {
        const replies = legalMoves(nb, YOU);
        if (!replies.length) return evalBoard(nb, BOT) + 20;
        return Math.min(...replies.map(([a, d]) => evalBoard(applyMove(nb, a, d, YOU), BOT)));
      })();
    }
    v += rng() * 0.01;
    if (v > bestV) { bestV = v; best = [r, c]; }
  }
  return best;
}

export default class Reversi extends Game {
  start() {
    sky(this.scene, '#15352a', '#050e0a', 30, 90);
    lights(this.scene, { sky: 0xd0ffe4, groundCol: 0x0a1c14 });
    this.add(ground(70, 0x0a140f));
    this.tiles = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = box(S - 0.06, 0.3, S - 0.06, mat(0x1f6b45, { roughness: 0.7 }));
      t.position.set(c * S - OFF, 0.15, r * S - OFF);
      t.userData = { r, c };
      this.tiles.push(this.add(t));
    }
    this.discs = new Map();
    this.burst = new Burst(this.scene, 60, 0.2);
    this.wins = 0;
    this.level = 0;
    this.showCursor = true;
    this.newGame();
    this.camera.position.set(0, 15.5, 7);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click a green-lit square to place a black disc · you flip every white disc trapped in a line · most discs wins · win to face a sharper bot · corners are gold');
  }

  newGame() {
    for (const d of this.discs.values()) this.scene.remove(d);
    this.discs.clear();
    this.board = startBoard();
    this.turn = YOU;
    this.wait = 0;
    this.result = null;
    this.after = 0;
    this.sync();
  }

  sync() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = this.board[r][c];
        const k = r * N + c;
        let d = this.discs.get(k);
        if (v && !d) {
          d = cyl(S * 0.4, S * 0.4, 0.22, mat(v === YOU ? 0x15151a : 0xf2f2f2, { roughness: 0.35 }));
          d.position.set(c * S - OFF, 0.42, r * S - OFF);
          d.userData.side = v;
          this.discs.set(k, this.add(d));
        }
        if (d) {
          d.userData.want = v === YOU ? 0 : Math.PI;
          d.material.color.setHex(v === YOU ? 0x15151a : 0xf2f2f2);
        }
      }
    }
  }

  /** Plays a move for a side. Returns true if legal. */
  play(r, c, who) {
    if (!flips(this.board, r, c, who).length) return false;
    const f = flips(this.board, r, c, who);
    this.board = applyMove(this.board, r, c, who);
    for (const [y, x] of f) this.burst.burst(new THREE.Vector3(x * S - OFF, 0.6, y * S - OFF), who === YOU ? 0x333333 : 0xffffff, 2, 3);
    this.sync();
    this.audio.blip(who === YOU ? 3 : 6);
    this.turn = who === YOU ? BOT : YOU;
    this.wait = rand(0.5, 0.9);
    this.checkTurn();
    return true;
  }

  /** After a move: skip a side with no moves, or end the game. */
  checkTurn() {
    const mine = legalMoves(this.board, this.turn).length;
    if (mine) return;
    const other = this.turn === YOU ? BOT : YOU;
    if (legalMoves(this.board, other).length) {
      this.hud.toast(this.turn === YOU ? 'YOU PASS' : 'BOT PASSES', 900);
      this.turn = other;
      this.wait = 0.7;
      return;
    }
    const a = count(this.board, YOU);
    const b = count(this.board, BOT);
    this.result = a > b ? 'win' : a < b ? 'loss' : 'draw';
    this.after = 1.6;
    this.audio[this.result === 'win' ? 'win' : 'bad']();
    this.hud.toast(this.result === 'win' ? `YOU WIN ${a}–${b}` : this.result === 'loss' ? `BOT WINS ${b}–${a}` : `DRAW ${a}–${b}`, 1400);
  }

  update(dt) {
    for (const d of this.discs.values()) {
      d.rotation.x = damp(d.rotation.x, d.userData.want ?? 0, 14, dt);
      d.position.y = 0.42 + Math.sin(Math.min(1, Math.abs(d.rotation.x - (d.userData.want ?? 0)) / Math.PI) * Math.PI) * 0.4;
    }
    this.burst.update(dt);
    const legal = this.turn === YOU && !this.result ? legalMoves(this.board, YOU) : [];
    for (const t of this.tiles) t.material.color.setHex(legal.some(([r, c]) => r === t.userData.r && c === t.userData.c) ? 0x3fbf6a : 0x1f6b45);

    if (!this.result) {
      if (this.turn === YOU) {
        if (this.clickedNow()) {
          const hit = this.pickAt(this.tiles);
          if (hit) this.play(hit.object.userData.r, hit.object.userData.c, YOU);
        }
      } else if ((this.wait -= dt) <= 0) {
        const m = botMove(this.board, this.level);
        if (m) this.play(m[0], m[1], BOT); else this.checkTurn();
      }
    } else if ((this.after -= dt) <= 0) {
      if (this.result === 'win') { this.wins++; this.level++; this.newGame(); }
      else if (this.result === 'draw') this.newGame();
      else return this.finish();
    }
    this.hud.stat('You', count(this.board, YOU));
    this.hud.stat('Bot', count(this.board, BOT));
    this.hud.stat('Wins', this.wins);
    this.hud.stat('Level', ['easy', 'fair', 'sharp', 'tough'][Math.min(3, this.level)]);
  }

  finish() {
    this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} in a row before the bot beat you.`);
  }
}
