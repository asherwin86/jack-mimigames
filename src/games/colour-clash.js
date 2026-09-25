import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, labelPlane, setLabel, Burst, damp, randInt, PALETTE,
} from '../engine/utils.js';

const TIME = 60;
export const INKS = [
  { name: 'RED', hex: PALETTE.red, css: '#ff4d5e' },
  { name: 'BLUE', hex: PALETTE.blue, css: '#4d8dff' },
  { name: 'GREEN', hex: PALETTE.lime, css: '#63e07a' },
  { name: 'YELLOW', hex: PALETTE.amber, css: '#ffd23f' },
];

/** A round: the word says one colour, the ink is another; the answer is the INK's index. */
export function makeRound(rng = Math.random, hard = false) {
  const word = Math.floor(rng() * 4);
  let ink = Math.floor(rng() * 4);
  if (hard || rng() < 0.75) while (ink === word) ink = Math.floor(rng() * 4);   // mostly clashing
  return { word, ink };
}

export default class ColourClash extends Game {
  start() {
    sky(this.scene, '#1a1a2e', '#07070d', 30, 90);
    lights(this.scene, { sky: 0xe4e4ff, groundCol: 0x101018 });
    this.add(ground(70, 0x0c0c14));
    this.burst = new Burst(this.scene, 50, 0.2);

    this.board = labelPlane('', 10, 4, { size: 256, aspect: 2.5 });
    this.board.position.set(0, 5, 0);
    this.add(this.board);
    this.buttons = INKS.map((ink, i) => {
      const b = box(3.4, 0.8, 2.4, glow(ink.hex, { emissiveIntensity: 0.5 }));
      b.position.set((i - 1.5) * 4, 0.4, 3);
      b.userData.i = i;
      return this.add(b);
    });

    this.correct = 0;
    this.streak = 0;
    this.timeLeft = TIME;
    this.showCursor = true;
    this.next();
    this.camera.position.set(0, 7.5, 12);
    this.camera.lookAt(0, 2.4, 1.5);
    this.hud.hint('Click the button matching the colour of the INK — not what the word says · 1–4 or A / B / X / Y also answer · a wrong answer costs 3 seconds');
  }

  next() {
    this.round = makeRound(Math.random, this.correct > 10);
    setLabel(this.board, INKS[this.round.word].name, { size: 256, fg: INKS[this.round.ink].css, scale: 0.5 });
  }

  /** Answer with a button index (0-3). Returns true when right. */
  answer(i) {
    if (i === this.round.ink) {
      this.correct++;
      this.streak++;
      this.timeLeft += this.streak % 5 === 0 ? 1 : 0;
      this.audio.blip(Math.min(12, 2 + this.streak));
      this.burst.burst(this.buttons[i].position, INKS[i].hex, 8, 6);
      this.next();
      return true;
    }
    this.streak = 0;
    this.timeLeft -= 3;
    this.audio.bad();
    this.hud.toast('−3 s', 500);
    this.buttons[i].position.y = -0.2;
    return false;
  }

  update(dt) {
    this.timeLeft -= dt;
    this.burst.update(dt);
    for (const b of this.buttons) b.position.y = damp(b.position.y, 0.4, 10, dt);
    this.hud.stat('Correct', this.correct);
    this.hud.stat('Streak', this.streak);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 10);
    if (this.timeLeft <= 0) return this.finish();
    for (let i = 0; i < 4; i++) {
      if (this.input.hit(`Digit${i + 1}`, `Numpad${i + 1}`) || this.input.gpHit(i)) return this.answer(i);
    }
    if (this.input.clicked) {
      const hit = this.pickAt(this.buttons);
      if (hit) this.answer(hit.object.userData.i);
    }
  }

  finish() {
    this.audio.lose();
    this.end(this.correct, `${this.correct} right — your brain beat the words.`);
  }
}
