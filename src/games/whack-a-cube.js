import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, randInt, PALETTE,
} from '../engine/utils.js';

const N = 5;
const GAP = 2.3;
const ROUND = 45;

export default class WhackACube extends Game {
  start() {
    sky(this.scene, '#20344f', '#080b14', 20, 70);
    lights(this.scene, { sky: 0xbfe0ff, groundCol: 0x1d2740 });
    this.add(ground(60, 0x141c30));

    // Sunken sockets the cubes pop out of.
    const half = ((N - 1) * GAP) / 2;
    this.cells = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -half + i * GAP;
        const z = -half + j * GAP;
        const socket = box(1.85, 0.3, 1.85, mat(0x0d1424, { roughness: 0.9 }), { cast: false });
        socket.position.set(x, 0.15, z);
        this.add(socket);

        const cube = box(1.5, 1.5, 1.5, glow(PALETTE.slate, { emissiveIntensity: 0 }));
        cube.position.set(x, -1.1, z);
        cube.userData = { home: x, z, state: 'down', t: 0, kind: null, y0: -1.1 };
        this.add(cube);
        this.cells.push(cube);
      }
    }

    this.burst = new Burst(this.scene, 90, 0.2);
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.combo = 0;
    this.timeLeft = ROUND;
    this.nextPop = 0.6;

    this.camera.position.set(0, 11.5, 11);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('Smash cyan cubes · gold is worth triple · never hit red');
  }

  popRandom() {
    const down = this.cells.filter((c) => c.userData.state === 'down');
    if (!down.length) return;
    const c = down[randInt(0, down.length - 1)];
    const roll = Math.random();
    const kind = roll < 0.18 ? 'bomb' : roll < 0.32 ? 'gold' : 'good';
    const colour = kind === 'bomb' ? PALETTE.red : kind === 'gold' ? PALETTE.amber : PALETTE.cyan;
    c.material.color.set(colour);
    c.material.emissive.set(colour);
    c.material.emissiveIntensity = 0.8;
    c.userData.kind = kind;
    c.userData.state = 'up';
    c.userData.t = 0;
    // Later in the round cubes duck back down faster.
    c.userData.life = clamp(1.9 - this.time * 0.02, 0.75, 1.9) * rand(0.85, 1.2);
    this.audio.tone(kind === 'bomb' ? 200 : 520, 0.06, { type: 'sine', gain: 0.07 });
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();

    this.nextPop -= dt;
    if (this.nextPop <= 0) {
      this.popRandom();
      if (Math.random() < 0.35) this.popRandom();
      this.nextPop = clamp(0.85 - this.time * 0.011, 0.28, 0.85) * rand(0.7, 1.3);
    }

    for (const c of this.cells) {
      const d = c.userData;
      d.t += dt;
      if (d.state === 'up') {
        c.position.y = damp(c.position.y, 0.9, 12, dt);
        c.rotation.y += dt * 1.2;
        if (d.t > d.life) this.retract(c, d.kind !== 'bomb');
      } else if (d.state === 'down') {
        c.position.y = damp(c.position.y, d.y0, 10, dt);
        c.rotation.y = damp(c.rotation.y, 0, 8, dt);
      }
    }

    if (this.input.clicked) this.swing();

    this.burst.update(dt);

    this.hud.stat('Score', this.score);
    this.hud.stat('Combo', `×${1 + Math.floor(this.combo / 4)}`);
    this.hud.stat('Time', this.timeLeft.toFixed(1), this.timeLeft < 8);
  }

  swing() {
    const ups = this.cells.filter((c) => c.userData.state === 'up');
    const hit = this.input.pick(this.camera, ups, false);
    if (!hit) {
      this.combo = 0;
      this.audio.tone(140, 0.05, { type: 'sine', gain: 0.05 });
      return;
    }
    const c = hit.object;
    const kind = c.userData.kind;

    if (kind === 'bomb') {
      this.score = Math.max(0, this.score - 60);
      this.combo = 0;
      this.misses++;
      this.burst.burst(c.position, PALETTE.red, 18, 8);
      this.audio.boom();
      this.hud.toast('-60', 500);
    } else {
      const mult = 1 + Math.floor(this.combo / 4);
      const base = kind === 'gold' ? 75 : 25;
      const gained = base * mult;
      this.score += gained;
      this.combo++;
      this.hits++;
      this.burst.burst(c.position, kind === 'gold' ? PALETTE.amber : PALETTE.cyan, 12, 6);
      this.audio.blip(clamp(this.combo, 0, 14));
      if (mult > 1) this.hud.toast(`+${gained}`, 420);
    }
    this.retract(c, false);
  }

  retract(c, penalise) {
    c.userData.state = 'down';
    c.userData.t = 0;
    c.material.emissiveIntensity = 0;
    c.material.color.set(PALETTE.slate);
    if (penalise) this.combo = 0;
  }

  finish() {
    const acc = this.hits + this.misses ? Math.round((this.hits / (this.hits + this.misses)) * 100) : 0;
    this.audio.win();
    this.end(this.score, `${this.hits} hits · ${acc}% clean.`);
  }
}
