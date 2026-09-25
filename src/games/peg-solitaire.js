import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, damp, PALETTE,
} from '../engine/utils.js';

const N = 7;
const S = 1.7;
const OFF = ((N - 1) * S) / 2;
const DIRS = [[0, 2], [0, -2], [2, 0], [-2, 0]];

/** The English cross: a 7x7 board with the four corner 2x2 blocks cut off. */
export const onBoard = (r, c) => r >= 0 && r < N && c >= 0 && c < N && !((r < 2 || r > 4) && (c < 2 || c > 4));

export function freshBoard() {
  const b = [];
  for (let r = 0; r < N; r++) b.push(Array.from({ length: N }, (_, c) => (onBoard(r, c) ? (r === 3 && c === 3 ? 0 : 1) : -1)));
  return b;
}

/** Legal jumps for a peg: [[toR, toC]]. */
export function jumpsFrom(board, r, c) {
  if (board[r]?.[c] !== 1) return [];
  return DIRS.map(([dr, dc]) => [r + dr, c + dc])
    .filter(([tr, tc]) => onBoard(tr, tc) && board[tr][tc] === 0 && board[(r + tr) / 2][(c + tc) / 2] === 1);
}

export const pegCount = (board) => board.flat().filter((v) => v === 1).length;
export const anyMoves = (board) => board.some((row, r) => row.some((_, c) => jumpsFrom(board, r, c).length));

export default class PegSolitaire extends Game {
  start() {
    sky(this.scene, '#3a2a1a', '#0e0904', 30, 90);
    lights(this.scene, { sky: 0xffe2b8, groundCol: 0x2a1c10 });
    this.add(ground(60, 0x1a120b));

    this.board = freshBoard();
    this.holes = [];
    this.pegs = new Map();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!onBoard(r, c)) continue;
        const hole = box(S - 0.15, 0.3, S - 0.15, mat(0x5a3f26, { roughness: 0.7 }));
        hole.position.set(c * S - OFF, 0.15, r * S - OFF);
        hole.userData = { r, c };
        this.holes.push(this.add(hole));
        if (this.board[r][c] === 1) this.makePeg(r, c);
      }
    }
    this.selected = null;
    this.burst = new Burst(this.scene, 60, 0.2);
    this.jumps = 0;
    this.over = 0;
    this.showCursor = true;

    this.camera.position.set(0, 15, 6);
    this.camera.lookAt(0, 0, 0.4);
    this.hud.hint('Click a peg, then click the empty hole two places away with a peg between — that peg is captured · finish with a single peg (in the centre is perfect)');
  }

  makePeg(r, c) {
    const p = ball(0.55, mat(PALETTE.cyan, { roughness: 0.35 }));
    p.position.set(c * S - OFF, 0.75, r * S - OFF);
    p.userData = { r, c };
    this.pegs.set(r * N + c, this.add(p));
  }

  /** Jumps the peg at (fr, fc) into (tr, tc). Returns true if the move was legal. */
  jump(fr, fc, tr, tc) {
    if (!jumpsFrom(this.board, fr, fc).some(([r, c]) => r === tr && c === tc)) return false;
    const mr = (fr + tr) / 2;
    const mc = (fc + tc) / 2;
    this.board[fr][fc] = 0;
    this.board[mr][mc] = 0;
    this.board[tr][tc] = 1;
    const mover = this.pegs.get(fr * N + fc);
    this.pegs.delete(fr * N + fc);
    mover.userData = { r: tr, c: tc };
    this.pegs.set(tr * N + tc, mover);
    const gone = this.pegs.get(mr * N + mc);
    this.pegs.delete(mr * N + mc);
    if (gone) { this.burst.burst(gone.position, PALETTE.amber, 8, 5); this.scene.remove(gone); }
    this.jumps++;
    this.selected = null;
    this.audio.thud();
    if (pegCount(this.board) === 1 || !anyMoves(this.board)) this.over = 1.1;
    return true;
  }

  score() {
    const left = pegCount(this.board);
    return (32 - left) * 10 + (left === 1 ? 100 + (this.board[3][3] === 1 ? 50 : 0) : 0);
  }

  update(dt) {
    for (const [k, peg] of this.pegs) {
      const r = Math.floor(k / N);
      const c = k % N;
      const sel = this.selected && this.selected[0] === r && this.selected[1] === c;
      peg.position.x = damp(peg.position.x, c * S - OFF, 18, dt);
      peg.position.z = damp(peg.position.z, r * S - OFF, 18, dt);
      peg.position.y = damp(peg.position.y, sel ? 1.4 : 0.75, 16, dt);
      peg.material.color.setHex(sel ? PALETTE.amber : PALETTE.cyan);
    }
    const legal = this.selected ? jumpsFrom(this.board, ...this.selected) : [];
    for (const h of this.holes) {
      const ok = legal.some(([r, c]) => r === h.userData.r && c === h.userData.c);
      h.material.color.setHex(ok ? 0x2f8f4a : 0x5a3f26);
    }
    this.burst.update(dt);

    if (this.over > 0) {
      this.over -= dt;
      if (this.over <= 0) this.finish();
      return;
    }
    if (this.clickedNow()) {
      const hit = this.pickAt([...this.holes, ...this.pegs.values()]);
      if (hit) {
        const { r, c } = hit.object.userData;
        if (this.board[r][c] === 1) { this.selected = this.selected && this.selected[0] === r && this.selected[1] === c ? null : [r, c]; this.audio.blip(3); }
        else if (this.selected) this.jump(this.selected[0], this.selected[1], r, c) || (this.selected = null);
      }
    }
    this.hud.stat('Pegs left', pegCount(this.board));
    this.hud.stat('Jumps', this.jumps);
  }

  finish() {
    const left = pegCount(this.board);
    this.audio[left === 1 ? 'win' : 'lose']();
    this.end(this.score(), left === 1 ? 'One peg left — brilliant!' : `${left} pegs left with no moves.`);
  }
}
