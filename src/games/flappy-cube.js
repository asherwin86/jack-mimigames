import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const GRAV = 34;
const FLAP = 11.5;
const SPEED = 7;
const GAP_H = 5.6;
const SPACING = 13;
const CEIL = 12;

export default class FlappyCube extends Game {
  start() {
    sky(this.scene, '#3a7bd8', '#cfe8ff', 60, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4c7a3a, intensity: 1.1 });
    const floor = this.add(ground(300, 0x4c7a3a));
    floor.position.y = -0.2;

    this.bird = this.add(box(1.2, 1.2, 1.2, glow(PALETTE.amber, { emissiveIntensity: 0.4 })));
    this.bird.position.set(-5, 6, 0);
    this.vy = 0;

    this.pipes = [];
    this.burst = new Burst(this.scene, 60, 0.2);
    this.score = 0;
    this.travel = 0;
    this.started = false;
    this.armed = 0.3;
    for (let i = 0; i < 6; i++) this.spawnPipe(14 + i * SPACING);

    this.camera.position.set(0, 6, 22);
    this.camera.lookAt(0, 6, 0);
    this.hud.hint('Click, tap or press Space to flap · fly through the gaps · don\'t touch anything');
  }

  spawnPipe(x) {
    const gapY = rand(GAP_H / 2 + 1.2, CEIL - GAP_H / 2 - 1.2);
    const col = COLORS[this.pipes.length % COLORS.length];
    const top = box(2.2, CEIL - (gapY + GAP_H / 2) + 2, 2.2, mat(col));
    const bottom = box(2.2, gapY - GAP_H / 2, 2.2, mat(col));
    top.position.set(x, (gapY + GAP_H / 2) + (CEIL - (gapY + GAP_H / 2) + 2) / 2, 0);
    bottom.position.set(x, (gapY - GAP_H / 2) / 2, 0);
    this.pipes.push({ x, gapY, top: this.add(top), bottom: this.add(bottom), passed: false });
  }

  update(dt) {
    this.armed -= dt;
    const flap = (this.input.hit('Space', 'ArrowUp', 'KeyW') || this.input.clicked || this.input.gpHit(0)) && this.armed <= 0;
    if (flap) {
      if (!this.started) { this.started = true; }
      this.vy = FLAP;
      this.audio.tone([500, 800], 0.07, { type: 'triangle', gain: 0.1 });
    }

    if (this.started) {
      this.vy -= GRAV * dt;
      this.bird.position.y += this.vy * dt;
      this.travel += SPEED * dt;
    } else {
      this.bird.position.y = 6 + Math.sin(this.time * 4) * 0.4;   // hovering until the first flap
    }
    this.bird.rotation.z = damp(this.bird.rotation.z, clamp(this.vy * 0.06, -0.7, 0.5), 10, dt);

    const by = this.bird.position.y;
    if (by < 0.6 || by > CEIL + 1) return this.crash();

    for (const p of this.pipes) {
      if (this.started) {
        p.x -= SPEED * dt;
        p.top.position.x = p.x;
        p.bottom.position.x = p.x;
      }
      if (Math.abs(p.x - this.bird.position.x) < 1.7 && (by > p.gapY + GAP_H / 2 - 0.6 || by < p.gapY - GAP_H / 2 + 0.6)) return this.crash();
      if (!p.passed && p.x < this.bird.position.x - 1.7) {
        p.passed = true;
        this.score++;
        this.audio.blip(Math.min(this.score, 18));
        if (this.score % 10 === 0) { this.hud.toast(`${this.score}!`, 700); this.audio.good(); }
      }
    }
    // Recycle pipes that have gone by.
    while (this.pipes.length && this.pipes[0].x < -26) {
      const old = this.pipes.shift();
      this.scene.remove(old.top);
      this.scene.remove(old.bottom);
      this.spawnPipe(this.pipes[this.pipes.length - 1].x + SPACING);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Best gap', `${GAP_H.toFixed(1)} m`);
  }

  crash() {
    this.burst.burst(this.bird.position, PALETTE.amber, 22, 9);
    this.bird.visible = false;
    this.audio.boom();
    this.audio.lose();
    this.end(this.score, `You flew through ${this.score} gap${this.score === 1 ? '' : 's'}.`);
  }
}
