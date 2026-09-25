import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, torus, ground, lights, sky, glow, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const ROUNDS = 8;
const S = 3;
const YOU = 1;
const BOT = 2;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const BLUNDER = [0.7, 0.5, 0.38, 0.26, 0.16, 0.08, 0.03, 0];   // chance the bot plays a random move, by round

/** 1 or 2 if that player has three in a row, 0 otherwise. */
export function winner(b) {
  for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[y] === b[z]) return b[x];
  return 0;
}
export const full = (b) => b.every(Boolean);

function minimax(b, turn, me) {
  const w = winner(b);
  if (w) return w === me ? 10 : -10;
  if (full(b)) return 0;
  const other = me === YOU ? BOT : YOU;
  let best = turn === me ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const v = minimax(b, turn === me ? other : me, me);
    b[i] = 0;
    best = turn === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** The bot's cell for board `b`, playing as `who`. `blunder` is the chance it plays a random move instead. */
export function botMove(b, who, blunder = 0, rng = Math.random) {
  const free = [];
  for (let i = 0; i < 9; i++) if (!b[i]) free.push(i);
  if (rng() < blunder) return free[Math.floor(rng() * free.length)];
  let best = -Infinity;
  let picks = [];
  const other = who === YOU ? BOT : YOU;
  for (const i of free) {
    b[i] = who;
    const v = minimax(b, other, who);
    b[i] = 0;
    if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
  }
  return picks[Math.floor(rng() * picks.length)];
}

export default class TicTacToe extends Game {
  start() {
    sky(this.scene, '#1d2a48', '#070a14', 30, 90);
    lights(this.scene, { sky: 0xd4e2ff, groundCol: 0x10182a });
    this.add(ground(70, 0x0c1220));
    this.cells = [];
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      const t = box(S - 0.2, 0.4, S - 0.2, mat(0x4a6299, { roughness: 0.6 }));
      t.position.set((c - 1) * S, 0.2, (r - 1) * S);
      t.userData.i = i;
      this.cells.push(this.add(t));
    }
    this.marks = [];
    this.burst = new Burst(this.scene, 60, 0.2);
    this.game = 0;
    this.points = 0;
    this.wins = 0;
    this.draws = 0;
    this.showCursor = true;
    this.newBoard();
    this.camera.position.set(0, 13, 6.5);
    this.camera.lookAt(0, 0, 0.3);
    this.hud.hint('Click a square to place your X · three in a row wins · 8 games against a bot that starts sloppy and ends perfect · win 3 points, draw 1');
  }

  newBoard() {
    for (const m of this.marks) this.scene.remove(m);
    this.marks = [];
    this.board = new Array(9).fill(0);
    this.turn = this.game % 2 === 0 ? YOU : BOT;   // you and the bot take turns to start
    this.wait = 0.6;
    this.result = null;
    this.after = 0;
    for (const c of this.cells) c.material.color.setHex(0x4a6299);
  }

  addMark(i, who) {
    const g = new THREE.Group();
    if (who === YOU) {
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const bar = box(0.35, 0.5, 2, glow(PALETTE.cyan, { emissiveIntensity: 0.5 }));
        bar.rotation.y = a;
        g.add(bar);
      }
    } else {
      const ring = torus(0.85, 0.22, glow(PALETTE.pink, { emissiveIntensity: 0.5 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.position.set(((i % 3) - 1) * S, 0.7, (Math.floor(i / 3) - 1) * S);
    g.scale.setScalar(0.01);
    this.marks.push(this.add(g));
  }

  /** Puts `who` on cell i. Returns true if it was free and the game is still going. */
  place(i, who) {
    if (this.result || this.board[i]) return false;
    this.board[i] = who;
    this.addMark(i, who);
    this.audio.blip(who === YOU ? 3 : 6);
    const w = winner(this.board);
    if (w) {
      this.result = w === YOU ? 'win' : 'loss';
      this.after = 1.4;
      const line = LINES.find(([a, b, c]) => this.board[a] === w && this.board[b] === w && this.board[c] === w);
      for (const k of line) { this.cells[k].material.color.setHex(w === YOU ? 0x2f8f4a : 0x8f2f3a); this.burst.burst(this.cells[k].position, w === YOU ? PALETTE.lime : PALETTE.red, 8, 6); }
      this.audio[w === YOU ? 'good' : 'bad']();
    } else if (full(this.board)) {
      this.result = 'draw';
      this.after = 1.2;
    } else {
      this.turn = who === YOU ? BOT : YOU;
      this.wait = rand(0.5, 0.9);
    }
    return true;
  }

  update(dt) {
    for (const m of this.marks) m.scale.setScalar(damp(m.scale.x, 1, 14, dt));
    this.burst.update(dt);
    if (!this.result) {
      if (this.turn === YOU) {
        if (this.clickedNow()) {
          const hit = this.pickAt(this.cells);
          if (hit) this.place(hit.object.userData.i, YOU);
        }
      } else if ((this.wait -= dt) <= 0) {
        this.place(botMove(this.board, BOT, BLUNDER[this.game]), BOT);
      }
    } else if ((this.after -= dt) <= 0) {
      if (this.result === 'win') { this.wins++; this.points += 3; } else if (this.result === 'draw') { this.draws++; this.points += 1; }
      this.game++;
      if (this.game >= ROUNDS) return this.finish();
      this.newBoard();
    }
    this.hud.stat('Game', `${Math.min(this.game + 1, ROUNDS)}/${ROUNDS}`);
    this.hud.stat('Points', this.points);
    this.hud.stat('Turn', this.result ? '—' : this.turn === YOU ? 'you' : 'bot');
  }

  finish() {
    this.audio[this.points >= 12 ? 'win' : 'lose']();
    this.end(this.points, `${this.wins} win${this.wins === 1 ? '' : 's'}, ${this.draws} draw${this.draws === 1 ? '' : 's'} — ${this.points} points.`);
  }
}
