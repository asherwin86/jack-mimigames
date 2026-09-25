import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const B = 4;                    // boxes per side (5 x 5 dots)
const S = 2.6;
const OFF = (B * S) / 2;
const YOU = 1;
const BOT = 2;
const HORIZ = B * (B + 1);      // ids 0..19 are horizontal edges, 20..39 vertical

export const hEdge = (r, c) => r * B + c;                 // r in 0..B, c in 0..B-1
export const vEdge = (r, c) => HORIZ + r * (B + 1) + c;   // r in 0..B-1, c in 0..B
/** The four edges around box (r, c). */
export const boxSides = (r, c) => [hEdge(r, c), hEdge(r + 1, c), vEdge(r, c), vEdge(r, c + 1)];
export const EDGE_COUNT = HORIZ * 2;

/** How many sides of box (r, c) are drawn. */
export const sidesDrawn = (edges, r, c) => boxSides(r, c).filter((e) => edges[e]).length;

/** Boxes that drawing edge e would complete: [[r, c]]. */
export function completes(edges, e) {
  const out = [];
  for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) {
    const s = boxSides(r, c);
    if (s.includes(e) && !edges[e] && s.filter((x) => edges[x]).length === 3) out.push([r, c]);
  }
  return out;
}

/** The boxes the opponent could grab in a row if you draw e (they keep taking while they can). */
function giveaway(edges, e) {
  const g = edges.slice();
  g[e] = 1;
  let taken = 0;
  for (let again = true; again;) {
    again = false;
    for (let x = 0; x < EDGE_COUNT; x++) {
      if (g[x]) continue;
      const done = completes(g, x);
      if (done.length) { g[x] = 1; taken += done.length; again = true; break; }
    }
  }
  return taken;
}

/** The bot's edge. Level 0 wanders; higher levels grab boxes and avoid handing the third side to you. */
export function botEdge(edges, level, rng = Math.random) {
  const free = [];
  for (let e = 0; e < EDGE_COUNT; e++) if (!edges[e]) free.push(e);
  if (!free.length) return null;
  if (rng() < [0.6, 0.25, 0.08, 0][Math.min(3, level)]) return free[Math.floor(rng() * free.length)];
  const grabs = free.filter((e) => completes(edges, e).length);
  if (grabs.length) return grabs[Math.floor(rng() * grabs.length)];
  const safe = free.filter((e) => giveaway(edges, e) === 0);
  if (safe.length) return safe[Math.floor(rng() * safe.length)];
  let best = free[0];
  let bestV = Infinity;
  for (const e of free) { const v = giveaway(edges, e) + rng() * 0.1; if (v < bestV) { bestV = v; best = e; } }
  return best;
}

export default class DotsAndBoxes extends Game {
  start() {
    sky(this.scene, '#1f2a3a', '#070a10', 30, 90);
    lights(this.scene, { sky: 0xdde8ff, groundCol: 0x10161f });
    this.add(ground(70, 0x0b1017));

    for (let r = 0; r <= B; r++) for (let c = 0; c <= B; c++) {
      const d = ball(0.22, glow(0xffffff, { emissiveIntensity: 0.5 }), { cast: false });
      d.position.set(c * S - OFF, 0.3, r * S - OFF);
      this.add(d);
    }
    this.edgeMeshes = [];
    for (let e = 0; e < EDGE_COUNT; e++) {
      const horiz = e < HORIZ;
      const r = horiz ? Math.floor(e / B) : Math.floor((e - HORIZ) / (B + 1));
      const c = horiz ? e % B : (e - HORIZ) % (B + 1);
      const len = S - 0.5;
      const m = box(horiz ? len : 0.34, 0.3, horiz ? 0.34 : len, glow(0x2c3a52, { emissiveIntensity: 0.2 }));
      m.position.set(horiz ? c * S - OFF + S / 2 : c * S - OFF, 0.25, horiz ? r * S - OFF : r * S - OFF + S / 2);
      m.userData.edge = e;
      // a fatter invisible target so a thin line is easy to hit
      const hit = box(horiz ? len : 0.9, 0.5, horiz ? 0.9 : len, mat(0xffffff), { cast: false, receive: false });
      hit.material.transparent = true;
      hit.material.opacity = 0;
      hit.material.depthWrite = false;
      hit.userData.edge = e;
      hit.position.copy(m.position);
      this.add(hit);
      this.edgeMeshes.push({ line: this.add(m), hit });
    }
    this.boxMeshes = [];
    for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) {
      const t = box(S - 0.7, 0.2, S - 0.7, glow(0x22304a, { emissiveIntensity: 0 }), { cast: false });
      t.position.set(c * S - OFF + S / 2, 0.1, r * S - OFF + S / 2);
      t.visible = false;
      this.boxMeshes.push(this.add(t));
    }
    this.burst = new Burst(this.scene, 60, 0.2);
    this.wins = 0;
    this.level = 0;
    this.showCursor = true;
    this.newGame();
    this.camera.position.set(0, 15, 7);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('Click a gap between two dots to draw a line · close the fourth side of a box to claim it and go again · most boxes wins · win to face a smarter bot');
  }

  newGame() {
    this.edges = new Array(EDGE_COUNT).fill(0);   // 0 free, 1 = yours, 2 = bot's
    this.owner = new Array(B * B).fill(0);
    this.turn = YOU;
    this.wait = 0;
    this.result = null;
    this.after = 0;
    this.paint();
  }

  /** Draws edge e for `who`. Returns true if it was free. */
  draw(e, who) {
    if (this.result || this.edges[e]) return false;
    const done = completes(this.edges, e);
    this.edges[e] = who;
    for (const [r, c] of done) {
      this.owner[r * B + c] = who;
      this.burst.burst(this.boxMeshes[r * B + c].position, who === YOU ? PALETTE.cyan : PALETTE.pink, 6, 5);
    }
    this.audio.blip(done.length ? 8 : who === YOU ? 3 : 5);
    this.paint();
    const yours = this.owner.filter((o) => o === YOU).length;
    const theirs = this.owner.filter((o) => o === BOT).length;
    if (yours + theirs === B * B) {
      this.result = yours > theirs ? 'win' : yours < theirs ? 'loss' : 'draw';
      this.after = 1.6;
      this.audio[this.result === 'win' ? 'win' : 'bad']();
      this.hud.toast(this.result === 'win' ? `YOU WIN ${yours}–${theirs}` : this.result === 'loss' ? `BOT WINS ${theirs}–${yours}` : `DRAW ${yours}–${theirs}`, 1300);
    } else if (!done.length) {
      this.turn = who === YOU ? BOT : YOU;
      this.wait = rand(0.5, 0.9);
    } else {
      this.wait = rand(0.4, 0.7);
    }
    return true;
  }

  paint() {
    this.edges.forEach((v, e) => {
      const m = this.edgeMeshes[e].line;
      m.material.color.setHex(v === YOU ? PALETTE.cyan : v === BOT ? PALETTE.pink : 0x2c3a52);
      m.material.emissive.setHex(v === YOU ? PALETTE.cyan : v === BOT ? PALETTE.pink : 0x2c3a52);
      m.material.emissiveIntensity = v ? 0.7 : 0.2;
      m.scale.y = v ? 1.4 : 1;
    });
    this.owner.forEach((o, i) => {
      const t = this.boxMeshes[i];
      t.visible = !!o;
      if (o) { t.material.color.setHex(o === YOU ? 0x1f6f8f : 0x8f1f5a); t.material.emissive.setHex(o === YOU ? PALETTE.cyan : PALETTE.pink); t.material.emissiveIntensity = 0.3; }
    });
  }

  update(dt) {
    this.burst.update(dt);
    if (!this.result) {
      if (this.turn === YOU) {
        if (this.clickedNow()) {
          const hit = this.pickAt(this.edgeMeshes.map((x) => x.hit));
          if (hit) this.draw(hit.object.userData.edge, YOU);
        }
      } else if ((this.wait -= dt) <= 0) {
        const e = botEdge(this.edges, this.level);
        if (e !== null) this.draw(e, BOT);
      }
    } else if ((this.after -= dt) <= 0) {
      if (this.result === 'win') { this.wins++; this.level++; this.newGame(); }
      else if (this.result === 'draw') this.newGame();
      else return this.finish();
    }
    this.hud.stat('You', this.owner.filter((o) => o === YOU).length);
    this.hud.stat('Bot', this.owner.filter((o) => o === BOT).length);
    this.hud.stat('Wins', this.wins);
    this.hud.stat('Turn', this.result ? '—' : this.turn === YOU ? 'you' : 'bot');
  }

  finish() {
    this.end(this.wins, `${this.wins} win${this.wins === 1 ? '' : 's'} in a row before the bot outboxed you.`);
  }
}
