import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, damp, randInt, shuffle, PALETTE, COLORS,
} from '../engine/utils.js';

const TIME = 60;

/** A question at a given difficulty (0, 1, 2...): { text, answer }. */
export function makeQuestion(level, rng = Math.random) {
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const kind = ri(0, level >= 2 ? 2 : 1);
  if (kind === 0) {
    const hi = 9 + level * 6;
    const a = ri(2, hi); const b = ri(2, hi);
    return { text: `${a} + ${b}`, answer: a + b };
  }
  if (kind === 1) {
    const hi = 12 + level * 6;
    const a = ri(6, hi); const b = ri(2, a - 1);
    return { text: `${a} − ${b}`, answer: a - b };
  }
  const hi = Math.min(12, 4 + level * 2);
  const a = ri(2, hi); const b = ri(2, hi);
  return { text: `${a} × ${b}`, answer: a * b };
}

/** Four distinct choices including the answer, as numbers. */
export function makeChoices(answer, rng = Math.random) {
  const set = new Set([answer]);
  const near = [1, -1, 2, -2, 10, -10, 3, -3];
  let guard = 0;
  while (set.size < 4 && guard++ < 50) {
    const v = answer + near[Math.floor(rng() * near.length)] * (rng() < 0.5 ? 1 : 1);
    if (v >= 0) set.add(v);
  }
  let pad = 4;
  while (set.size < 4) set.add(answer + pad++);
  return shuffle([...set], rng);
}

export default class MathDash extends Game {
  start() {
    sky(this.scene, '#132a3a', '#050c12', 30, 90);
    lights(this.scene, { sky: 0xd6f0ff, groundCol: 0x0c1a24 });
    this.add(ground(70, 0x09131a));
    this.burst = new Burst(this.scene, 50, 0.2);

    this.board = labelPlane('', 11, 3.4, { size: 256, aspect: 11 / 3.4 });
    this.board.position.set(0, 5.6, 0);
    this.add(this.board);

    this.buttons = [];
    for (let i = 0; i < 4; i++) {
      const b = box(3.6, 0.7, 2.2, glow(COLORS[i], { emissiveIntensity: 0.25 }));
      b.position.set((i - 1.5) * 4, 0.35, 3);
      b.userData.i = i;
      this.buttons.push(this.add(b));
      const lp = labelPlane('', 3, 1.6, { size: 128, fg: '#0a0e14', aspect: 3 / 1.6 });
      lp.rotation.x = -Math.PI / 2;
      lp.position.set(b.position.x, 0.75, 3);
      this.add(lp);
      b.userData.label = lp;
    }

    this.correct = 0;
    this.points = 0;
    this.streak = 0;
    this.timeLeft = TIME;
    this.asked = 0;
    this.level = 0;
    this.showCursor = true;
    this.next();

    this.camera.position.set(0, 8, 12);
    this.camera.lookAt(0, 2.2, 1.5);
    this.hud.hint('Click the right answer (or press 1–4 · controller A / B / X / Y) · streaks score more · a wrong answer costs 2 seconds');
  }

  next() {
    this.q = makeQuestion(this.level);
    this.choices = makeChoices(this.q.answer);
    setLabel(this.board, `${this.q.text} = ?`, { size: 256, fg: '#f2f6ff', scale: 0.55 });
    this.buttons.forEach((b, i) => setLabel(b.userData.label, String(this.choices[i]), { size: 128, fg: '#0a0e14' }));
  }

  /** Pick answer number i (0-3). Returns true when right. */
  answer(i) {
    this.asked++;
    if (this.choices[i] === this.q.answer) {
      this.correct++;
      this.streak++;
      this.points += 10 + Math.min(this.streak - 1, 10);
      this.level = Math.floor(this.correct / 5);
      this.audio.blip(Math.min(12, 2 + this.streak));
      this.burst.burst(this.buttons[i].position, PALETTE.lime, 8, 6);
      this.next();
      return true;
    }
    this.streak = 0;
    this.timeLeft -= 2;
    this.audio.bad();
    this.hud.toast('−2 s', 500);
    this.buttons[i].position.y = -0.15;
    return false;
  }

  update(dt) {
    this.timeLeft -= dt;
    this.burst.update(dt);
    for (const b of this.buttons) b.position.y = damp(b.position.y, 0.35, 10, dt);
    this.hud.stat('Points', this.points);
    this.hud.stat('Streak', this.streak);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 10);
    if (this.timeLeft <= 0) return this.finish();

    for (let i = 0; i < 4; i++) {
      if (this.input.hit(`Digit${i + 1}`, `Numpad${i + 1}`) || this.input.gpHit([0, 1, 2, 3][i])) return this.answer(i);
    }
    if (this.input.clicked) {
      const hit = this.pickAt(this.buttons);
      if (hit) this.answer(hit.object.userData.i);
    }
  }

  finish() {
    this.audio.lose();
    this.end(this.points, `${this.correct} of ${this.asked} right — ${this.points} points.`);
  }
}
