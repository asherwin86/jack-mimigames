import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, clamp, damp, rand, sign, PALETTE, COLORS,
} from '../engine/utils.js';

const W = 11;          // playfield half-width
const TOP = 9;
const BOTTOM = -8;
const COLS = 9;
const ROWS = 5;
const BALL_R = 0.42;

export default class BrickWall extends Game {
  start() {
    sky(this.scene, '#131f45', '#05070e', 25, 90);
    lights(this.scene, { sky: 0xa8c0ff, groundCol: 0x131a30 });

    // Back panel and side rails frame the playfield.
    const backing = box(W * 2 + 1, TOP - BOTTOM + 2, 0.5, mat(0x161d38), { cast: false });
    backing.position.set(0, (TOP + BOTTOM) / 2, -1.4);
    this.add(backing);
    for (const x of [-W - 0.4, W + 0.4]) {
      const rail = box(0.6, TOP - BOTTOM + 2, 1.4, glow(0x2b3a6b, { emissiveIntensity: 0.3 }), { cast: false });
      rail.position.set(x, (TOP + BOTTOM) / 2, -0.4);
      this.add(rail);
    }
    const top = box(W * 2 + 1.6, 0.6, 1.4, glow(0x2b3a6b, { emissiveIntensity: 0.3 }), { cast: false });
    top.position.set(0, TOP + 0.6, -0.4);
    this.add(top);

    this.bricks = [];
    const bw = (W * 2 - 0.8) / COLS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = box(bw - 0.16, 0.9, 1, glow(COLORS[r % COLORS.length], { emissiveIntensity: 0.4 }));
        b.position.set(-W + 0.4 + bw * (c + 0.5), TOP - 1.4 - r * 1.15, 0);
        b.userData = { hp: r < 1 ? 2 : 1, points: (ROWS - r) * 20 };
        this.bricks.push(this.add(b));
      }
    }

    this.paddle = this.add(box(4, 0.7, 1.2, glow(PALETTE.lime)));
    this.paddle.position.set(0, BOTTOM, 0);
    this.ball = this.add(box(BALL_R * 2, BALL_R * 2, BALL_R * 2, glow(PALETTE.amber)));

    this.burst = new Burst(this.scene, 90, 0.2);
    this.score = 0;
    this.lives = 3;
    this.speed = 17;
    this.launch();

    this.camera.position.set(0, 1.5, 24);
    this.camera.lookAt(0, 1, 0);
    this.hud.hint('Move the mouse to slide the paddle · clear every brick');
  }

  launch() {
    this.ball.position.set(this.paddle.position.x, BOTTOM + 1.4, 0);
    this.vel = new THREE.Vector3(rand(-6, 6), this.speed, 0);
    this.stuck = 0.7;
  }

  update(dt) {
    const tx = clamp(this.input.pointer.x * (W + 2), -W + 2, W - 2);
    this.paddle.position.x = damp(this.paddle.position.x, tx, 18, dt);

    if (this.stuck > 0) {
      this.stuck -= dt;
      this.ball.position.x = this.paddle.position.x;
      this.ball.position.y = BOTTOM + 1.4;
    } else {
      // Small substeps stop the ball tunnelling through bricks when fast.
      const steps = 3;
      for (let i = 0; i < steps; i++) {
        this.ball.position.addScaledVector(this.vel, dt / steps);
        this.collide();
        if (this.finished) return;
      }
    }

    this.ball.rotation.x += dt * 5;
    this.ball.rotation.y += dt * 3;
    this.burst.update(dt);

    if (this.ball.position.y < BOTTOM - 3) return this.drop();

    this.hud.stat('Score', this.score);
    this.hud.stat('Bricks', this.bricks.length);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
  }

  collide() {
    const p = this.ball.position;

    if (p.x < -W + BALL_R) { p.x = -W + BALL_R; this.vel.x = Math.abs(this.vel.x); this.audio.tone(300, 0.04, { gain: 0.06 }); }
    if (p.x > W - BALL_R) { p.x = W - BALL_R; this.vel.x = -Math.abs(this.vel.x); this.audio.tone(300, 0.04, { gain: 0.06 }); }
    if (p.y > TOP) { p.y = TOP; this.vel.y = -Math.abs(this.vel.y); this.audio.tone(300, 0.04, { gain: 0.06 }); }

    // Paddle: contact point sets the outgoing angle.
    if (this.vel.y < 0 && p.y < BOTTOM + 0.9 && p.y > BOTTOM - 0.9) {
      const off = (p.x - this.paddle.position.x) / 2.4;
      if (Math.abs(off) <= 1.15) {
        p.y = BOTTOM + 0.9;
        const angle = off * 1.05;
        const s = Math.min(34, this.speed + 0.35);
        this.speed = s;
        this.vel.set(Math.sin(angle) * s, Math.cos(angle) * s, 0);
        this.audio.blip(6);
        this.burst.burst(p, PALETTE.lime, 6, 4);
      }
    }

    for (let i = this.bricks.length - 1; i >= 0; i--) {
      const b = this.bricks[i];
      const dx = p.x - b.position.x;
      const dy = p.y - b.position.y;
      const hx = b.geometry.parameters.width / 2 + BALL_R;
      const hy = b.geometry.parameters.height / 2 + BALL_R;
      if (Math.abs(dx) >= hx || Math.abs(dy) >= hy) continue;

      // Bounce off whichever face was least deeply penetrated.
      if (hx - Math.abs(dx) < hy - Math.abs(dy)) {
        this.vel.x = Math.abs(this.vel.x) * sign(dx || 1);
        p.x = b.position.x + sign(dx || 1) * hx;
      } else {
        this.vel.y = Math.abs(this.vel.y) * sign(dy || 1);
        p.y = b.position.y + sign(dy || 1) * hy;
      }
      this.hitBrick(b, i);
      break;
    }
  }

  hitBrick(b, i) {
    b.userData.hp--;
    this.burst.burst(b.position, b.material.color.getHex(), 8, 5);
    if (b.userData.hp > 0) {
      b.material.emissiveIntensity = 0.9;
      b.scale.set(0.9, 0.9, 0.9);
      this.audio.tone(420, 0.05, { type: 'square', gain: 0.08 });
      return;
    }
    this.score += b.userData.points;
    this.audio.blip(clamp(ROWS * 2 - i % 10, 0, 18));
    this.scene.remove(b);
    b.geometry.dispose();
    b.material.dispose();
    this.bricks.splice(i, 1);
    if (!this.bricks.length) {
      this.audio.win();
      this.end(this.score + this.lives * 250, `Wall cleared with ${this.lives} live${this.lives === 1 ? '' : 's'} spare.`);
    }
  }

  drop() {
    this.lives--;
    this.audio.bad();
    if (this.lives <= 0) {
      this.audio.lose();
      return this.end(this.score, `${this.bricks.length} bricks left standing.`);
    }
    this.speed = 17;
    this.hud.toast(`${this.lives} left`, 800);
    this.launch();
  }
}
