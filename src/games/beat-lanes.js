import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, clamp, damp, seeded, COLORS,
} from '../engine/utils.js';

const LANES = 4;
const KEYS = [['KeyD', 'ArrowLeft'], ['KeyF', 'ArrowDown'], ['KeyJ', 'ArrowUp'], ['KeyK', 'ArrowRight']];
const SPACING = 2.6;
const HIT_Z = 0;        // notes are judged as they cross z = 0
const TRAVEL = 60;      // how far up the track a note starts
const BPM = 132;

export default class BeatLanes extends Game {
  start() {
    sky(this.scene, '#141d4d', '#05060f', 30, 120);
    lights(this.scene, { sky: 0xa8b8ff, groundCol: 0x151a35 });

    const off = ((LANES - 1) * SPACING) / 2;
    this.lanes = [];
    for (let i = 0; i < LANES; i++) {
      const x = -off + i * SPACING;
      const floor = box(SPACING - 0.15, 0.2, TRAVEL + 20, mat(0x1a2145), { cast: false });
      floor.position.set(x, -0.2, -TRAVEL / 2 + 5);
      this.add(floor);

      const pad = box(SPACING - 0.3, 0.3, 2.2, glow(COLORS[i], { emissiveIntensity: 0.25 }), { cast: false });
      pad.position.set(x, 0, HIT_Z);
      this.add(pad);
      this.lanes.push({ x, pad, flash: 0 });
    }

    this.notes = [];
    this.burst = new Burst(this.scene, 90, 0.2);
    this.rng = seeded(20260829);
    this.beat = 60 / BPM;
    this.nextBeat = 1.6;
    this.beatIndex = 0;
    this.speed = 34;

    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.perfect = 0;
    this.hits = 0;
    this.missed = 0;
    this.lives = 5;

    this.camera.position.set(0, 6.5, 12);
    this.camera.lookAt(0, 0, -14);
    this.hud.hint('D F J K (or arrow keys) as the notes cross the pads');
  }

  spawnNote(lane) {
    const n = box(SPACING - 0.5, 0.5, 1.2, glow(COLORS[lane], { emissiveIntensity: 0.8 }), { cast: false });
    n.position.set(this.lanes[lane].x, 0.4, HIT_Z - TRAVEL);
    n.userData = { lane, judged: false };
    this.notes.push(this.add(n));
  }

  update(dt) {
    // Chart generation: a steady pulse with occasional doubles, seeded so the
    // same song plays every run.
    this.nextBeat -= dt;
    if (this.nextBeat <= 0) {
      this.beatIndex++;
      const density = clamp(0.55 + this.time * 0.006, 0.55, 0.95);
      if (this.rng() < density) {
        this.spawnNote(Math.floor(this.rng() * LANES));
        if (this.rng() < 0.16) this.spawnNote(Math.floor(this.rng() * LANES));
      }
      this.nextBeat += this.beat / (this.beatIndex % 8 === 0 ? 2 : 1);
      this.audio.tone(this.beatIndex % 4 === 0 ? 90 : 70, 0.05, { type: 'sine', gain: 0.05 });
    }

    this.speed = 34 + Math.min(16, this.time * 0.3);
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      n.position.z += this.speed * dt;
      if (!n.userData.judged && n.position.z > HIT_Z + 1.6) {
        n.userData.judged = true;
        this.miss();
        if (this.finished) return;
      }
      if (n.position.z > HIT_Z + 6) this.removeNote(i);
    }

    for (let i = 0; i < LANES; i++) {
      const l = this.lanes[i];
      if (this.input.hit(...KEYS[i])) this.strike(i);
      l.flash = Math.max(0, l.flash - dt * 4);
      l.pad.material.emissiveIntensity = damp(l.pad.material.emissiveIntensity, 0.25 + l.flash * 1.6, 14, dt);
      l.pad.position.y = damp(l.pad.position.y, l.flash > 0.5 ? -0.15 : 0, 16, dt);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Combo', this.combo);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives <= 2);
  }

  strike(lane) {
    this.lanes[lane].flash = 1;
    // Judge the note closest to the pad in this lane.
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.userData.lane !== lane || n.userData.judged) continue;
      const d = Math.abs(n.position.z - HIT_Z);
      if (d < bestDist) { bestDist = d; best = i; }
    }

    if (best < 0 || bestDist > 2.4) {
      this.combo = 0;
      this.audio.tone(120, 0.05, { type: 'sine', gain: 0.05 });
      return;
    }

    const n = this.notes[best];
    n.userData.judged = true;
    this.hits++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    const mult = 1 + Math.floor(this.combo / 10);
    if (bestDist < 0.7) {
      this.perfect++;
      this.score += 100 * mult;
      this.hud.toast('PERFECT', 320);
      this.audio.tone(880, 0.07, { type: 'triangle', gain: 0.13 });
    } else {
      this.score += 50 * mult;
      this.audio.tone(660, 0.06, { type: 'triangle', gain: 0.11 });
    }
    this.burst.burst(n.position, COLORS[lane], 8, 5);
    this.removeNote(best);
  }

  miss() {
    this.combo = 0;
    this.missed++;
    this.lives--;
    this.audio.bad();
    if (this.lives <= 0) {
      const total = this.hits + this.missed;
      const acc = total ? Math.round((this.hits / total) * 100) : 0;
      this.audio.lose();
      this.end(this.score, `${acc}% accuracy · ${this.perfect} perfect · best combo ${this.bestCombo}.`);
    }
  }

  removeNote(i) {
    const n = this.notes[i];
    this.scene.remove(n);
    n.geometry.dispose();
    n.material.dispose();
    this.notes.splice(i, 1);
  }
}
