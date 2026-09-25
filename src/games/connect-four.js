import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const COLS = 7;
const ROWS = 6;
const CELL = 1.7;
const OFFX = ((COLS - 1) * CELL) / 2;
const PLAYER = 1;
const BOT = 2;

/** Every line of four on the board, as lists of [col, row]. */
const LINES = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const line = [];
      for (let k = 0; k < 4; k++) line.push([c + dc * k, r + dr * k]);
      if (line.every(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS)) LINES.push(line);
    }
  }
}

/** A board is an array of columns, each a list of 1s and 2s from the bottom up. */
export function winnerOf(board) {
  for (const line of LINES) {
    const v = board[line[0][0]][line[0][1]];
    if (v && line.every(([c, r]) => board[c][r] === v)) return { player: v, line };
  }
  return null;
}
const heightOf = (board, c) => board[c].filter(Boolean).length;
const isFull = (board) => board.every((col) => col.every(Boolean));
const cloneBoard = (board) => board.map((col) => col.slice());
const canDrop = (board, c) => heightOf(board, c) < ROWS;
function dropped(board, c, who) { const b = cloneBoard(board); b[c][heightOf(b, c)] = who; return b; }

/** How good a board looks for `who` (windows of four with only their pieces score; centre columns count a little). */
function evaluate(board, who) {
  const other = who === PLAYER ? BOT : PLAYER;
  let s = 0;
  for (const line of LINES) {
    let mine = 0; let theirs = 0;
    for (const [c, r] of line) { const v = board[c][r]; if (v === who) mine++; else if (v === other) theirs++; }
    if (mine && !theirs) s += mine === 3 ? 6 : mine === 2 ? 2 : 0.4;
    if (theirs && !mine) s -= theirs === 3 ? 7 : theirs === 2 ? 2 : 0.4;
  }
  for (let r = 0; r < ROWS; r++) if (board[3][r] === who) s += 1;
  return s;
}

function minimax(board, depth, alpha, beta, turn, who) {
  const win = winnerOf(board);
  if (win) return win.player === who ? 1000 + depth : -1000 - depth;
  if (depth === 0 || isFull(board)) return evaluate(board, who);
  const other = who === PLAYER ? BOT : PLAYER;
  const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => canDrop(board, c));
  if (turn === who) {
    let best = -Infinity;
    for (const c of order) {
      best = Math.max(best, minimax(dropped(board, c, who), depth - 1, alpha, beta, other, who));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const c of order) {
    best = Math.min(best, minimax(dropped(board, c, turn), depth - 1, alpha, beta, who, who));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** The bot's column. `level` 0 is easy, 3 is sharp; a little randomness keeps it beatable. */
export function botMove(board, level, rng = Math.random) {
  const open = [0, 1, 2, 3, 4, 5, 6].filter((c) => canDrop(board, c));
  if (rng() < [0.5, 0.3, 0.18, 0.1][Math.min(3, level)]) return open[Math.floor(rng() * open.length)];
  let bestScore = -Infinity;
  let best = open[0];
  for (const c of open) {
    const score = minimax(dropped(board, c, BOT), 2 + Math.min(2, level), -Infinity, Infinity, PLAYER, BOT) + rng() * 0.01;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export default class ConnectFour extends Game {
  start() {
    sky(this.scene, '#16305a', '#060b16', 40, 110);
    lights(this.scene, { sky: 0xbfd6ff, groundCol: 0x101a30 });
    this.add(ground(60, 0x0d1424));

    // The board: a blue back panel with dark holes, side rails and a base, so the discs stay visible in front of it.
    const back = box(COLS * CELL + 0.6, ROWS * CELL + 0.6, 0.3, mat(0x1c4fb8, { roughness: 0.5 }));
    back.position.set(0, (ROWS * CELL) / 2 + 0.3, -0.45);
    this.add(back);
    for (const side of [-1, 1]) {
      const rail = box(0.35, ROWS * CELL + 0.6, 1.0, mat(0x163f94, { roughness: 0.5 }));
      rail.position.set(side * (COLS * CELL / 2 + 0.15), (ROWS * CELL) / 2 + 0.3, 0);
      this.add(rail);
    }
    const base = box(COLS * CELL + 1.1, 0.5, 1.4, mat(0x163f94, { roughness: 0.5 }));
    base.position.set(0, 0.05, 0);
    this.add(base);
    const holeMat = mat(0x0a1a3f, { roughness: 0.9 });
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const hole = cyl(CELL * 0.38, CELL * 0.38, 0.05, holeMat, { cast: false, receive: false });
        hole.rotation.x = Math.PI / 2;
        hole.position.set(c * CELL - OFFX, r * CELL + CELL / 2 + 0.3, -0.28);
        this.add(hole);
      }
    }
    // Picking targets: one tall invisible column per file.
    this.columns = [];
    for (let c = 0; c < COLS; c++) {
      const col = box(CELL - 0.1, ROWS * CELL + 1.5, 1.4, mat(0xffffff), { cast: false, receive: false });
      col.material.transparent = true;
      col.material.opacity = 0;
      col.position.set(c * CELL - OFFX, (ROWS * CELL) / 2 + 0.4, 0);
      col.userData = { col: c };
      this.columns.push(this.add(col));
    }
    this.pieces = [];
    this.burst = new Burst(this.scene, 80, 0.2);
    this.wins = 0;
    this.level = 0;
    this.showCursor = true;
    this.newGame();

    this.camera.position.set(0, 7.5, 14.5);
    this.camera.lookAt(0, 5.3, 0);
    this.hud.hint('Click a column to drop your red disc · connect four in any direction before the bot does · win to face a sharper bot');
  }

  newGame() {
    for (const p of this.pieces) this.scene.remove(p);
    this.pieces = [];
    this.board = Array.from({ length: COLS }, () => Array(ROWS).fill(0));
    this.turn = PLAYER;
    this.busy = 0;
    this.result = null;
    this.hover = 3;
    this.wait = 0;
    this.falling = null;
  }

  spawnPiece(c, r, who) {
    const p = cyl(CELL * 0.4, CELL * 0.4, 0.5, glow(who === PLAYER ? PALETTE.red : PALETTE.amber, { emissiveIntensity: 0.4 }));
    p.rotation.x = Math.PI / 2;
    p.position.set(c * CELL - OFFX, ROWS * CELL + 1.5, 0);
    p.userData = { targetY: r * CELL + CELL / 2 + 0.3, vy: 0, who };
    this.pieces.push(this.add(p));
    this.falling = p;
  }

  play(c, who) {
    if (!canDrop(this.board, c)) return false;
    const r = heightOf(this.board, c);
    this.board[c][r] = who;
    this.spawnPiece(c, r, who);
    this.audio.blip(c);
    return true;
  }

  update(dt) {
    // Discs fall under gravity and settle on the stack.
    if (this.falling) {
      const p = this.falling;
      p.userData.vy -= 40 * dt;
      p.position.y += p.userData.vy * dt;
      if (p.position.y <= p.userData.targetY) {
        p.position.y = p.userData.targetY;
        this.falling = null;
        this.audio.thud();
        this.afterDrop();
      }
    }

    if (!this.result && !this.falling) {
      if (this.turn === PLAYER) {
        const hit = this.pickAt(this.columns);
        if (hit) this.hover = hit.object.userData.col;
        if (this.clickedNow() && hit && this.play(hit.object.userData.col, PLAYER)) this.turn = 0;   // 0 = discs in flight
      } else if (this.turn === BOT) {
        this.wait -= dt;
        if (this.wait <= 0) { this.play(botMove(this.board, this.level), BOT); this.turn = 0; }
      }
    }
    if (this.result) {
      this.wait -= dt;
      if (this.wait <= 0) this.endOfGame();
    }

    for (const p of this.pieces) p.rotation.z += 0; // (discs are static once down)
    this.burst.update(dt);
    this.hud.stat('Wins', this.wins);
    this.hud.stat('Bot', ['easy', 'medium', 'sharp', 'tough'][Math.min(3, this.level)]);
    this.hud.stat('Turn', this.result ? '—' : this.turn === PLAYER ? 'you' : 'bot');
  }

  afterDrop() {
    const win = winnerOf(this.board);
    if (win) {
      this.result = win.player === PLAYER ? 'win' : 'loss';
      this.wait = 1.4;
      for (const [c, r] of win.line) this.burst.burst({ x: c * CELL - OFFX, y: r * CELL + CELL / 2 + 0.3, z: 0.4 }, win.player === PLAYER ? PALETTE.lime : PALETTE.red, 10, 6);
      (win.player === PLAYER ? this.audio.win() : this.audio.bad());
      this.hud.toast(win.player === PLAYER ? 'YOU WIN' : 'BOT WINS', 1200);
    } else if (isFull(this.board)) {
      this.result = 'draw';
      this.wait = 1;
      this.hud.toast('DRAW', 900);
    } else {
      // the disc that just landed ends that side's turn
      const last = this.pieces[this.pieces.length - 1].userData.who;
      this.turn = last === PLAYER ? BOT : PLAYER;
      if (this.turn === BOT) this.wait = rand(0.4, 0.8);
    }
  }

  endOfGame() {
    if (this.result === 'win') {
      this.wins++;
      this.level++;
      this.newGame();
    } else if (this.result === 'draw') {
      this.newGame();
    } else {
      this.audio.lose();
      this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} in a row before the bot got you.`);
    }
  }
}
