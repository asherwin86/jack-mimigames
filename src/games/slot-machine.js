import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, damp, PALETTE,
} from '../engine/utils.js';

const SPINS = 25;
const START = 250;
const COST = 10;
const SYMBOLS = ['●', '♣', '♥', '◆', '★', '7'];
const COLOURS = ['#ff5468', '#5ee08a', '#ff7bb5', '#5ecbff', '#ffd23f', '#ff9a3d'];
const WEIGHTS = [30, 25, 20, 14, 8, 3];   // per hundred
const TRIPLE = [5, 8, 12, 20, 50, 100];   // times the stake
const PAIR = 1;                          // any two alike (a pair) gives the stake back

/** A weighted random symbol index. */
export function randomSymbol(rng = Math.random) {
  let x = rng() * 100;
  for (let i = 0; i < WEIGHTS.length; i++) { x -= WEIGHTS[i]; if (x < 0) return i; }
  return 0;
}

/** Coins paid out for three reel symbols at a stake of `bet`. */
export function payout(reels, bet = COST) {
  const [a, b, c] = reels;
  if (a === b && b === c) return TRIPLE[a] * bet;
  if (a === b || b === c || a === c) return PAIR * bet;
  return 0;
}

export default class SlotMachine extends Game {
  start() {
    sky(this.scene, '#3a1030', '#0d0410', 30, 90);
    lights(this.scene, { sky: 0xffd0f5, groundCol: 0x240a20 });
    this.add(ground(70, 0x14060f));
    const body = box(14, 8, 3, mat(0xb01c3a, { roughness: 0.4 }));
    body.position.set(0, 4, -2.2);
    this.add(body);

    this.reels = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 4;
      const window = box(3.4, 3.6, 0.4, mat(0xf6f2ea, { roughness: 0.3 }));
      window.position.set(x, 4.6, -0.6);
      window.userData.reel = i;
      this.add(window);
      const label = labelPlane(SYMBOLS[0], 3, 3, { fg: COLOURS[0], size: 192, scale: 0.7 });
      label.position.set(x, 4.6, -0.36);
      this.add(label);
      const lamp = box(3.4, 0.25, 0.3, glow(PALETTE.lime, { emissiveIntensity: 0 }));
      lamp.position.set(x, 2.4, -0.4);
      this.add(lamp);
      this.reels.push({ window, label, lamp, sym: i, held: false, spinUntil: 0, tick: 0 });
    }
    this.buttons = {};
    const mk = (id, text, x, col) => {
      const b = box(4.6, 0.7, 2, glow(col, { emissiveIntensity: 0.3 }));
      b.position.set(x, 0.35, 3.2);
      b.userData.action = id;
      this.add(b);
      const lp = labelPlane(text, 4.2, 1.4, { fg: '#0a0e14', size: 128, scale: 0.45, aspect: 3 });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(x, 0.72, 3.2);
      this.add(lp);
      this.buttons[id] = { mesh: b, label: lp };
    };
    mk('spin', `SPIN −${COST}`, -3, PALETTE.lime);
    mk('respin', `RESPIN −${COST}`, 3, PALETTE.amber);

    this.burst = new Burst(this.scene, 70, 0.22);
    this.coins = START;
    this.spins = 0;
    this.phase = 'ready';        // ready | spinning | held (a result you may hold-and-respin) | done
    this.canRespin = false;
    this.lastWin = 0;
    this.after = 0;
    this.showCursor = true;
    this.camera.position.set(0, 6.5, 12);
    this.camera.lookAt(0, 2.0, 0);
    this.hud.hint('SPIN (Space / A) costs 10 · three alike pays big, a pair gives your stake back · after a spin click reels to HOLD them, then HOLD & RESPIN (H / Y) once for another 10 · 25 spins');
  }

  /** Starts a spin. `keep` is the set of reel indexes to leave alone. Returns true if it started. */
  spin(keep = []) {
    if (this.phase !== 'ready' && this.phase !== 'held') return false;
    if (this.coins < COST) return false;
    const respin = keep.length > 0;
    if (respin && !this.canRespin) return false;
    if (!respin && this.spins >= SPINS) return false;
    this.coins -= COST;
    if (!respin) this.spins++;
    this.canRespin = !respin;   // one respin per spin
    this.phase = 'spinning';
    this.results = this.reels.map((r, i) => (keep.includes(i) ? r.sym : randomSymbol()));
    this.reels.forEach((r, i) => { r.spinUntil = keep.includes(i) ? 0 : this.time + 0.7 + i * 0.35; r.held = false; r.lamp.material.emissiveIntensity = 0; });
    this.audio.blip(4);
    return true;
  }

  settle() {
    this.reels.forEach((r, i) => { r.sym = this.results[i]; setLabel(r.label, SYMBOLS[r.sym], { fg: COLOURS[r.sym], size: 192, scale: 0.7 }); });
    const win = payout(this.results);
    this.coins += win;
    this.lastWin = win;
    if (win > COST) { this.audio.win(); this.hud.toast(`WIN +${win}`, 1200); for (const r of this.reels) this.burst.burst(r.window.position, PALETTE.amber, 8, 8); }
    else if (win === COST) { this.audio.blip(5); this.hud.toast('PAIR · stake back', 700); }
    else this.audio.bad();
    if (this.spins >= SPINS) this.canRespin = false;   // no respin after the final spin
    if (this.coins < COST || (this.spins >= SPINS && !this.canRespin)) { this.phase = 'done'; this.after = 1.2; return; }
    this.phase = this.canRespin ? 'held' : 'ready';
  }

  toggleHold(i) {
    if (this.phase !== 'held') return false;
    this.reels[i].held = !this.reels[i].held;
    this.reels[i].lamp.material.emissiveIntensity = this.reels[i].held ? 1 : 0;
    this.audio.blip(2);
    return true;
  }

  respin() {
    const keep = this.reels.map((r, i) => (r.held ? i : -1)).filter((i) => i >= 0);
    if (!keep.length || keep.length === 3) return false;
    return this.spin(keep);
  }

  update(dt) {
    this.burst.update(dt);
    if (this.phase === 'spinning') {
      let anySpinning = false;
      this.reels.forEach((r, i) => {
        if (this.time < r.spinUntil) {
          anySpinning = true;
          if ((r.tick -= dt) <= 0) { r.tick = 0.06; const s = randomSymbol(); setLabel(r.label, SYMBOLS[s], { fg: COLOURS[s], size: 192, scale: 0.7 }); this.audio.blip?.(1); }
          r.window.position.y = 4.6 + Math.sin(this.time * 40 + i) * 0.05;
        } else r.window.position.y = 4.6;
      });
      if (!anySpinning) this.settle();
    } else if (this.phase === 'done') {
      if ((this.after -= dt) <= 0) return this.finish();
    } else {
      let action = null;
      if (this.input.hit('Space') || this.input.gpHit(0)) action = 'spin';
      if (this.input.hit('KeyH') || this.input.gpHit(3)) action = 'respin';
      for (let i = 0; i < 3; i++) if (this.input.hit(`Digit${i + 1}`)) this.toggleHold(i);
      if (!action && this.input.clicked) {
        const hit = this.pickAt([...Object.values(this.buttons).map((b) => b.mesh), ...this.reels.map((r) => r.window)]);
        if (hit) {
          if (hit.object.userData.action) action = hit.object.userData.action;
          else this.toggleHold(hit.object.userData.reel);
        }
      }
      if (action === 'spin') this.spin(); else if (action === 'respin') this.respin();
    }
    this.buttons.respin.mesh.material.emissiveIntensity = this.phase === 'held' ? 0.6 : 0.05;
    this.buttons.spin.mesh.material.emissiveIntensity = this.phase === 'ready' || this.phase === 'held' ? 0.5 : 0.05;
    this.hud.stat('Coins', this.coins);
    this.hud.stat('Spin', `${Math.min(this.spins, SPINS)}/${SPINS}`);
    this.hud.stat('Last win', this.lastWin);
  }

  finish() {
    this.audio[this.coins >= START ? 'win' : 'lose']();
    this.end(this.coins, `You finished with ${this.coins} coins.`);
  }
}
