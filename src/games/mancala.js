import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, rand, PALETTE, COLORS,
} from '../engine/utils.js';

// Pits 0-5 are yours (left to right), 6 is your store; 7-12 are the bot's, 13 its store.
const STORE = { 1: 6, 2: 13 };
const YOU = 1;
const BOT = 2;
const own = (side) => (side === YOU ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);
const opposite = (i) => 12 - i;

export const startPits = () => [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];

/**
 * Plays `pit` for `side` on a copy of `pits` (Kalah rules).
 * Returns { pits, steps (the board after each seed), again (extra turn), over, captured } or null when illegal.
 */
export function sow(pits, pit, side) {
  if (!own(side).includes(pit) || !pits[pit]) return null;
  const p = pits.slice();
  const skip = side === YOU ? 13 : 6;
  let seeds = p[pit];
  p[pit] = 0;
  let i = pit;
  const steps = [];
  while (seeds > 0) {
    i = (i + 1) % 14;
    if (i === skip) continue;
    p[i]++;
    seeds--;
    steps.push(p.slice());
  }
  let captured = 0;
  if (own(side).includes(i) && p[i] === 1 && p[opposite(i)] > 0) {
    captured = p[opposite(i)] + 1;
    p[STORE[side]] += captured;
    p[i] = 0;
    p[opposite(i)] = 0;
    steps.push(p.slice());
  }
  const again = i === STORE[side];
  let over = false;
  if (own(YOU).every((k) => !p[k]) || own(BOT).every((k) => !p[k])) {
    over = true;
    for (const s of [YOU, BOT]) for (const k of own(s)) { p[STORE[s]] += p[k]; p[k] = 0; }
    steps.push(p.slice());
  }
  return { pits: p, steps, again: again && !over, over, captured };
}

function search(pits, side, depth, alpha, beta) {
  const moves = own(side).filter((k) => pits[k]);
  if (depth === 0 || !moves.length) return pits[13] - pits[6];
  let best = side === BOT ? -Infinity : Infinity;
  for (const m of moves) {
    const r = sow(pits, m, side);
    const next = r.again ? side : side === YOU ? BOT : YOU;
    const v = r.over ? r.pits[13] - r.pits[6] : search(r.pits, next, depth - 1, alpha, beta);
    if (side === BOT) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
    if (beta <= alpha) break;
  }
  return best;
}

/** The bot's pit. Level 0 is random, 1 greedy, 2+ searches ahead. */
export function botPit(pits, level, rng = Math.random) {
  const moves = own(BOT).filter((k) => pits[k]);
  if (!moves.length) return null;
  if (level <= 0 || rng() < ([0.3, 0.08][level] ?? 0)) return moves[Math.floor(rng() * moves.length)];
  let best = moves[0];
  let bestV = -Infinity;
  for (const m of moves) {
    const r = sow(pits, m, BOT);
    let v;
    if (level === 1) v = r.pits[13] + (r.again ? 3 : 0);
    else v = r.over ? r.pits[13] - r.pits[6] : search(r.pits, r.again ? BOT : YOU, 1 + level * 2, -Infinity, Infinity) + (r.again ? 0.5 : 0);
    v += rng() * 0.01;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

const PIT_X = (i) => (i < 6 ? i - 2.5 : 12 - i - 2.5) * 2.3;
const PIT_Z = (i) => (i < 6 ? 2 : -2);

export default class Mancala extends Game {
  start() {
    sky(this.scene, '#3a2818', '#0e0904', 30, 90);
    lights(this.scene, { sky: 0xffe2b8, groundCol: 0x2a1c10 });
    this.add(ground(70, 0x1a1208));
    const board = box(18.5, 0.6, 8.6, mat(0x8a5a2a, { roughness: 0.7 }));
    board.position.y = 0.05;
    this.add(board);

    this.pitMeshes = [];
    this.counts = [];
    for (let i = 0; i < 14; i++) {
      const store = i === 6 || i === 13;
      const m = store ? box(2.3, 0.3, 6.2, mat(0x4a2c12)) : cyl(1, 1, 0.3, mat(0x4a2c12, { roughness: 0.9 }));
      if (store) m.position.set(i === 6 ? 8.2 : -8.2, 0.42, 0);
      else m.position.set(PIT_X(i), 0.42, PIT_Z(i));
      m.userData.pit = i;
      this.pitMeshes.push(this.add(m));
      const lp = labelPlane('0', 1.4, 1.4, { fg: i < 7 ? '#8fe8ff' : '#ffb3c7' });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(m.position.x, 0.62, store ? (i === 6 ? 3.7 : -3.7) : (i < 6 ? 3.5 : -3.5));
      this.counts.push(this.add(lp));
    }
    this.seeds = [];
    const seedGeo = new THREE.SphereGeometry(0.2, 10, 8);
    for (let k = 0; k < 60; k++) {
      const s = new THREE.Mesh(seedGeo, new THREE.MeshStandardMaterial({ color: COLORS[k % COLORS.length], roughness: 0.3 }));
      s.visible = false;
      this.seeds.push(this.add(s));
    }
    this.burst = new Burst(this.scene, 40, 0.2);
    this.pits = startPits();
    this.queue = [];
    this.turn = YOU;
    this.wait = 0;
    this.wins = 0;
    this.level = 0;
    this.result = null;
    this.after = 0;
    this.showCursor = true;
    this.layout(this.pits);
    this.camera.position.set(0, 13, 8);
    this.camera.lookAt(0, 0, 0.3);
    this.hud.hint('Click one of your pits (the front row) to pick up its seeds and sow them round · end in your store for another go · end in an empty pit of yours to capture the seeds opposite · most seeds wins');
  }

  layout(pits) {
    let k = 0;
    pits.forEach((n, i) => {
      const cx = this.pitMeshes[i].position.x;
      const cz = this.pitMeshes[i].position.z;
      const store = i === 6 || i === 13;
      setLabel(this.counts[i], String(n), { fg: i < 7 ? '#8fe8ff' : '#ffb3c7' });
      for (let j = 0; j < Math.min(n, 14) && k < this.seeds.length; j++, k++) {
        const s = this.seeds[k];
        const a = j * 2.4;
        const r = store ? 0.25 + (j % 4) * 0.22 : 0.15 + (j % 5) * 0.14;
        s.position.set(cx + Math.cos(a) * r * (store ? 1 : 1), 0.7 + Math.floor(j / 7) * 0.2, cz + Math.sin(a) * r * (store ? 2.2 : 1));
        s.visible = true;
      }
    });
    for (; k < this.seeds.length; k++) this.seeds[k].visible = false;
  }

  /** The current side plays a pit. Returns true if legal. */
  play(pit, side) {
    if (this.queue.length || this.result) return false;
    const r = sow(this.pits, pit, side);
    if (!r) return false;
    this.queue = r.steps.slice();
    this.pits = r.pits;
    this.audio.blip(side === YOU ? 3 : 6);
    if (r.captured) this.hud.toast(`CAPTURE +${r.captured}`, 900);
    if (r.over) {
      const a = this.pits[6];
      const b = this.pits[13];
      this.result = a > b ? 'win' : a < b ? 'loss' : 'draw';
      this.after = 2;
    } else {
      this.turn = r.again ? side : side === YOU ? BOT : YOU;
      if (r.again) this.hud.toast('GO AGAIN', 700);
      this.wait = rand(0.7, 1.1);
    }
    this.stepT = 0;
    return true;
  }

  update(dt) {
    this.burst.update(dt);
    if (this.queue.length) {
      this.stepT -= dt;
      if (this.stepT <= 0) { this.layout(this.queue.shift()); this.stepT = 0.16; this.audio.blip(2); }
    } else if (!this.result) {
      if (this.turn === YOU) {
        if (this.clickedNow()) {
          const hit = this.pickAt(this.pitMeshes);
          if (hit) this.play(hit.object.userData.pit, YOU) || this.audio.bad();
        }
      } else if ((this.wait -= dt) <= 0) {
        this.play(botPit(this.pits, this.level), BOT);
      }
    } else if ((this.after -= dt) <= 0) {
      if (this.result === 'win') { this.wins++; this.level++; this.pits = startPits(); this.layout(this.pits); this.turn = YOU; this.result = null; }
      else if (this.result === 'draw') { this.pits = startPits(); this.layout(this.pits); this.turn = YOU; this.result = null; }
      else return this.finish();
    }
    this.hud.stat('You', this.pits[6]);
    this.hud.stat('Bot', this.pits[13]);
    this.hud.stat('Wins', this.wins);
    this.hud.stat('Turn', this.result ? '—' : this.turn === YOU ? 'you' : 'bot');
  }

  finish() {
    this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} before the bot beat you.`);
  }
}
