import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const W = 9;        // court half-width
const H = 5.5;      // court half-height
const DEPTH = 46;   // wall at z = -DEPTH, paddle plane at z = 0
const BALL_R = 0.45;
const PAD = { w: 3.4, h: 2.6 };

export default class PaddleRally extends Game {
  start() {
    sky(this.scene, '#12294d', '#05070e', 30, 120);
    lights(this.scene, { sky: 0x9ecdff, groundCol: 0x101a30 });

    // Court: floor, ceiling, side walls, and the target wall at the far end.
    const shell = mat(0x1a2440, { roughness: 0.9, side: THREE.DoubleSide });
    const mk = (w, h, d, x, y, z) => {
      const m = box(w, h, d, shell, { cast: false });
      m.position.set(x, y, z);
      return this.add(m);
    };
    mk(W * 2, 0.4, DEPTH, 0, -H, -DEPTH / 2);
    mk(W * 2, 0.4, DEPTH, 0, H, -DEPTH / 2);
    mk(0.4, H * 2, DEPTH, -W, 0, -DEPTH / 2);
    mk(0.4, H * 2, DEPTH, W, 0, -DEPTH / 2);
    this.wall = mk(W * 2, H * 2, 0.5, 0, 0, -DEPTH);
    this.wall.material = glow(0x2b3f74, { emissiveIntensity: 0.25 });

    // Depth rings to make the tunnel readable.
    for (let i = 1; i < 9; i++) {
      const r = box(W * 2, H * 2, 0.12, glow(PALETTE.cyan, { emissiveIntensity: 0.25, transparent: true, opacity: 0.18, wireframe: true }), { cast: false, receive: false });
      r.position.z = -i * (DEPTH / 9);
      this.add(r);
    }

    this.paddle = this.add(box(PAD.w, PAD.h, 0.4, glow(PALETTE.lime, { transparent: true, opacity: 0.55 }), { cast: false }));
    this.paddle.position.set(0, 0, 0);

    this.ball = this.add(ball(BALL_R, glow(PALETTE.amber)));
    this.burst = new Burst(this.scene, 70, 0.18);

    this.rally = 0;
    this.best = 0;
    this.lives = 3;
    this.speed = 22;
    this.serve(-1);

    this.camera.position.set(0, 1.2, 9);
    this.camera.lookAt(0, 0, -DEPTH * 0.5);
    this.hud.hint('Move the mouse to slide the paddle · keep the rally alive');
  }

  serve(dir) {
    this.ball.position.set(rand(-3, 3), rand(-2, 2), dir < 0 ? -6 : -DEPTH + 6);
    this.vel = new THREE.Vector3(rand(-5, 5), rand(-4, 4), this.speed * dir);
    this.serving = 0.5;
  }

  update(dt) {
    // Paddle tracks the pointer inside the court bounds.
    const tx = clamp(this.input.pointer.x * W, -W + PAD.w / 2, W - PAD.w / 2);
    const ty = clamp(this.input.pointer.y * H, -H + PAD.h / 2, H - PAD.h / 2);
    this.paddle.position.x = damp(this.paddle.position.x, tx, 16, dt);
    this.paddle.position.y = damp(this.paddle.position.y, ty, 16, dt);

    if (this.serving > 0) { this.serving -= dt; }

    const p = this.ball.position;
    p.addScaledVector(this.vel, dt);

    // Side / floor / ceiling bounces
    if (p.x < -W + BALL_R) { p.x = -W + BALL_R; this.vel.x *= -1; this.ping(0.6); }
    if (p.x > W - BALL_R) { p.x = W - BALL_R; this.vel.x *= -1; this.ping(0.6); }
    if (p.y < -H + BALL_R) { p.y = -H + BALL_R; this.vel.y *= -1; this.ping(0.6); }
    if (p.y > H - BALL_R) { p.y = H - BALL_R; this.vel.y *= -1; this.ping(0.6); }

    // Far wall always returns the ball.
    if (p.z < -DEPTH + BALL_R + 0.3) {
      p.z = -DEPTH + BALL_R + 0.3;
      this.vel.z *= -1;
      this.burst.burst(p, PALETTE.cyan, 8, 5);
      this.audio.tone(330, 0.07, { type: 'square', gain: 0.1 });
      // The wall adds a little unpredictability as the rally heats up.
      const chaos = clamp(this.rally * 0.25, 0, 5);
      this.vel.x += rand(-chaos, chaos);
      this.vel.y += rand(-chaos, chaos);
    }

    // Paddle plane
    if (this.vel.z > 0 && p.z > -0.4) {
      const dx = Math.abs(p.x - this.paddle.position.x);
      const dy = Math.abs(p.y - this.paddle.position.y);
      if (dx < PAD.w / 2 + BALL_R && dy < PAD.h / 2 + BALL_R) this.hit(p);
      else if (p.z > 3) return this.miss();
    }

    this.ball.rotation.x += dt * 4;
    this.burst.update(dt);

    // Camera nudges toward the paddle for a bit of parallax.
    this.camera.position.x = damp(this.camera.position.x, this.paddle.position.x * 0.3, 5, dt);
    this.camera.position.y = damp(this.camera.position.y, 1.2 + this.paddle.position.y * 0.25, 5, dt);
    this.camera.lookAt(p.x * 0.25, p.y * 0.25, -DEPTH * 0.5);

    this.hud.stat('Rally', this.rally);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
    this.hud.stat('Ball', `${Math.round(this.vel.length())} u/s`);
  }

  ping(g = 1) { this.audio.tone(220, 0.05, { type: 'sine', gain: 0.06 * g }); }

  hit(p) {
    this.rally++;
    this.best = Math.max(this.best, this.rally);
    this.speed = Math.min(58, 22 + this.rally * 1.6);

    // Where you hit the paddle steers the return.
    const offX = (p.x - this.paddle.position.x) / (PAD.w / 2);
    const offY = (p.y - this.paddle.position.y) / (PAD.h / 2);
    this.vel.z = -this.speed;
    this.vel.x = offX * this.speed * 0.45;
    this.vel.y = offY * this.speed * 0.4;
    p.z = -0.6;

    this.burst.burst(p, PALETTE.lime, 10, 6);
    this.audio.blip(clamp(this.rally, 0, 18));
    if (this.rally % 10 === 0) { this.hud.toast(`RALLY ${this.rally}`, 700); this.audio.good(); }
  }

  miss() {
    this.lives--;
    this.audio.bad();
    this.burst.burst(this.ball.position, PALETTE.red, 16, 7);
    if (this.lives <= 0) {
      this.audio.lose();
      return this.end(this.best, `Longest rally: ${this.best}.`);
    }
    this.hud.toast(`${this.lives} left`, 800);
    this.rally = 0;
    this.speed = 22;
    this.serve(-1);
  }
}
