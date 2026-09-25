import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, damp, rand, PALETTE,
} from '../engine/utils.js';

const ROUNDS = 5;
const FALSE_START = 250;   // milliseconds added to your total for jumping the light

export default class ReactionTest extends Game {
  start() {
    sky(this.scene, '#1a2440', '#070a14', 30, 90);
    lights(this.scene, { sky: 0xd0e0ff, groundCol: 0x101830 });
    this.add(ground(60, 0x0d1224));

    this.pad = this.add(box(9, 1.2, 6, glow(PALETTE.red, { emissiveIntensity: 0.7 })));
    this.pad.position.y = 0.6;
    this.burst = new Burst(this.scene, 60, 0.2);
    this.times = [];
    this.falseStarts = 0;
    this.state = 'ready';       // ready -> wait -> go -> shown
    this.stateT = 1.2;
    this.goAt = 0;
    this.showCursor = true;

    this.camera.position.set(0, 10, 11);
    this.camera.lookAt(0, 0.5, 0);
    this.hud.hint('Wait for the pad to turn green, then click as fast as you can · click too early and it costs you');
  }

  setPad(colour) {
    this.pad.material.color.setHex(colour);
    this.pad.material.emissive.setHex(colour);
  }

  update(dt) {
    this.stateT -= dt;
    const pressed = this.clickedNow() || this.input.hit('Space');

    if (this.state === 'ready') {
      this.setPad(PALETTE.red);
      if (this.stateT <= 0) { this.state = 'wait'; this.stateT = rand(1.3, 4.2); }
    } else if (this.state === 'wait') {
      this.setPad(PALETTE.red);
      if (pressed) {
        this.falseStarts++;
        this.hud.toast(`TOO SOON · +${FALSE_START} ms`, 900);
        this.audio.bad();
        this.setPad(PALETTE.amber);
        this.state = 'ready';
        this.stateT = 1.1;
      } else if (this.stateT <= 0) {
        this.state = 'go';
        this.goAt = this.time;
        this.setPad(PALETTE.lime);
        this.audio.tone(880, 0.1, { type: 'triangle', gain: 0.12 });
      }
    } else if (this.state === 'go') {
      if (pressed) {
        const ms = Math.round((this.time - this.goAt) * 1000);
        this.times.push(ms);
        this.lastMs = ms;
        this.burst.burst(this.pad.position, PALETTE.lime, 16, 7);
        this.audio.blip(Math.max(0, 12 - Math.floor(ms / 60)));
        this.hud.toast(`${ms} ms`, 1000);
        this.state = 'shown';
        this.stateT = 1.1;
        this.setPad(PALETTE.blue);
      }
    } else if (this.state === 'shown' && this.stateT <= 0) {
      if (this.times.length >= ROUNDS) return this.finish();
      this.state = 'ready';
      this.stateT = 0.6;
    }

    this.pad.scale.y = damp(this.pad.scale.y, this.state === 'go' ? 1.6 : 1, 20, dt);
    this.burst.update(dt);
    const avg = this.times.length ? Math.round(this.times.reduce((a, b) => a + b, 0) / this.times.length) : null;
    this.hud.stat('Round', `${Math.min(ROUNDS, this.times.length + 1)}/${ROUNDS}`);
    this.hud.stat('Last', this.lastMs ? `${this.lastMs} ms` : '—');
    this.hud.stat('Average', avg ? `${avg} ms` : '—');
  }

  finish() {
    const total = this.times.reduce((a, b) => a + b, 0) + this.falseStarts * FALSE_START;
    const avg = Math.round(total / ROUNDS);
    this.audio.win();
    this.end(avg, `Average ${avg} ms (best ${Math.min(...this.times)} ms)${this.falseStarts ? `, ${this.falseStarts} false start${this.falseStarts === 1 ? '' : 's'}` : ''}.`);
  }
}
