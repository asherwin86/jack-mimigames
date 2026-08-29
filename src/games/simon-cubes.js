import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, damp, clamp, randInt, PALETTE,
} from '../engine/utils.js';

const PADS = [
  { colour: PALETTE.cyan, note: 329.63 },
  { colour: PALETTE.pink, note: 392.00 },
  { colour: PALETTE.lime, note: 493.88 },
  { colour: PALETTE.amber, note: 587.33 },
  { colour: PALETTE.violet, note: 659.25 },
];

export default class SimonCubes extends Game {
  start() {
    sky(this.scene, '#241d4a', '#07070f', 22, 70);
    lights(this.scene, { sky: 0xcbb8ff, groundCol: 0x1a1633, intensity: 0.8 });
    this.add(ground(60, 0x120f22));

    this.pads = PADS.map((p, i) => {
      const a = (-0.55 + (i / (PADS.length - 1)) * 1.1);
      const pillar = box(2.1, 1.4, 2.1, glow(p.colour, { emissiveIntensity: 0.12 }));
      pillar.position.set(Math.sin(a) * 8.5, 0.7, -Math.cos(a) * 8.5 + 5);
      pillar.lookAt(0, 0.7, 5);
      pillar.userData = { ...p, index: i, lit: 0, base: pillar.position.y };
      return this.add(pillar);
    });

    this.sequence = [];
    this.round = 0;
    this.step = 0;
    this.phase = 'idle';
    this.timer = 0.9;
    this.showIndex = 0;
    this.inputClock = 0;

    this.camera.position.set(0, 8.5, 15);
    this.camera.lookAt(0, 0.5, 1);
    this.hud.hint('Watch the sequence, then click it back');
  }

  nextRound() {
    this.sequence.push(randInt(0, PADS.length - 1));
    this.round++;
    this.phase = 'show';
    this.showIndex = 0;
    this.timer = 0.45;
    this.step = 0;
    this.hud.toast(`Round ${this.round}`, 700);
  }

  flash(i, dur = 0.42) {
    const p = this.pads[i];
    p.userData.lit = dur;
    this.audio.tone(p.userData.note, Math.min(dur, 0.3), { type: 'triangle', gain: 0.16 });
  }

  update(dt) {
    for (const p of this.pads) {
      const d = p.userData;
      if (d.lit > 0) d.lit -= dt;
      const on = d.lit > 0;
      p.material.emissiveIntensity = damp(p.material.emissiveIntensity, on ? 1.5 : 0.12, 12, dt);
      p.position.y = damp(p.position.y, on ? d.base + 0.5 : d.base, 14, dt);
    }

    this.timer -= dt;

    if (this.phase === 'idle') {
      if (this.timer <= 0) this.nextRound();
    } else if (this.phase === 'show') {
      if (this.timer <= 0) {
        if (this.showIndex < this.sequence.length) {
          this.flash(this.sequence[this.showIndex], clamp(0.5 - this.round * 0.012, 0.22, 0.5));
          this.showIndex++;
          this.timer = clamp(0.62 - this.round * 0.016, 0.3, 0.62);
        } else {
          this.phase = 'input';
          this.inputClock = this.timeAllowed();
        }
      }
    } else if (this.phase === 'input') {
      this.inputClock -= dt;
      if (this.inputClock <= 0) return this.fail('Too slow.');
      if (this.input.clicked) this.handleClick();
    }

    const label = this.phase === 'show' ? 'watch' : this.phase === 'input' ? 'your turn' : '…';
    this.hud.stat('Round', this.round);
    this.hud.stat('Sequence', `${this.step}/${this.sequence.length}`);
    this.hud.stat('Phase', label, this.phase === 'input' && this.inputClock < 2);
  }

  timeAllowed() { return 2.2 + this.sequence.length * 1.1; }

  handleClick() {
    const hit = this.input.pick(this.camera, this.pads, false);
    if (!hit) return;
    const i = hit.object.userData.index;
    this.flash(i, 0.3);

    if (i !== this.sequence[this.step]) return this.fail('Wrong pad.');

    this.step++;
    if (this.step >= this.sequence.length) {
      this.audio.good();
      this.phase = 'idle';
      this.timer = 0.8;
    } else {
      this.inputClock = this.timeAllowed();
    }
  }

  fail(why) {
    this.audio.lose();
    for (const p of this.pads) { p.material.color.set(PALETTE.red); p.userData.lit = 1; }
    const done = this.round - 1;
    this.end(done, `${why} You matched ${done} round${done === 1 ? '' : 's'}.`);
  }
}
