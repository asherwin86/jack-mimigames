import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const LENGTH = 120;
const FALL_ANGLE = 1.0;

/** One physics step of the walker's tilt: gravity pulls it further over, the player and the wind push. */
export function stepTilt(angle, vel, input, wind, difficulty, dt) {
  const acc = Math.sin(angle) * (2.2 + difficulty * 1.6) + input * 7.5 + wind;
  const v = (vel + acc * dt) * Math.exp(-0.7 * dt);
  return { angle: angle + v * dt, vel: v };
}

export default class Tightrope extends Game {
  start() {
    sky(this.scene, '#f4a86a', '#fde8c4', 90, 300);
    lights(this.scene, { sky: 0xfff0d8, groundCol: 0x8a6a4a, intensity: 1.1 });
    const rope = cyl(0.08, 0.08, LENGTH + 40, mat(0x3a2a1a));
    rope.rotation.z = Math.PI / 2;
    rope.position.set(0, 8, 0);
    this.add(rope);
    // Two platforms and a drop below.
    for (const x of [-4, LENGTH + 4]) {
      const p = box(8, 1, 6, mat(0x6a5a4a));
      p.position.set(x, 7.5, 0);
      this.add(p);
    }
    this.clouds = [];
    for (let i = 0; i < 14; i++) {
      const c = box(rand(5, 10), rand(1, 2), rand(3, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }), { cast: false });
      c.position.set(rand(-20, LENGTH + 20), rand(-4, 2), rand(-14, -4));
      this.clouds.push(this.add(c));
    }

    this.walker = new THREE.Group();
    const torso = box(0.6, 1.3, 0.5, glow(PALETTE.cyan, { emissiveIntensity: 0.3 }));
    torso.position.y = 1.0;
    const head = ball(0.3, mat(0xf2c9a0));
    head.position.y = 1.95;
    const legs = box(0.5, 0.7, 0.4, mat(0x2a3050));
    legs.position.y = 0.35;
    this.pole = box(7, 0.12, 0.12, glow(PALETTE.amber, { emissiveIntensity: 0.4 }));
    this.pole.position.y = 1.5;
    this.walker.add(torso, head, legs, this.pole);
    this.walker.position.set(0, 8.1, 0);
    this.add(this.walker);
    this.pivot = new THREE.Group();   // tilts about the feet
    this.burst = new Burst(this.scene, 40, 0.2);

    this.angle = 0.05;
    this.vel = 0;
    this.x = 0;
    this.wind = 0;
    this.windT = 3;
    this.gust = 0;
    this.grace = 1.4;        // a moment to get ready before the wobble starts
    this.showCursor = false;
    this.camera.position.set(0, 9.5, 14);
    this.camera.lookAt(0, 8.5, 0);
    this.hud.hint('Lean against the tilt: A / D or the arrows (or move the mouse left / right) · you walk on by yourself · gusts of wind shove you · cross the whole rope');
  }

  update(dt) {
    if (this.finished) return;
    if (this.grace > 0) {
      this.grace -= dt;
      this.hud.stat('Distance', '0 / 120 m');
      this.hud.stat('Balance', 'get ready');
      return;
    }
    this.time0 = (this.time0 ?? 0) + dt;
    const diff = clamp(this.x / LENGTH, 0, 1);
    // Wind gusts arrive at random, stronger further along.
    this.windT -= dt;
    if (this.windT <= 0) { this.gust = rand(-1, 1) * (1.2 + diff * 3.2); this.windT = rand(1.4, 3.2); }
    this.wind = damp(this.wind, this.gust, 2, dt);
    this.gust = damp(this.gust, 0, 0.6, dt);

    let lean = this.input.axisX();
    if (lean) this.mouseLean = false;
    else if (this.input.delta.x || this.input.delta.y) this.mouseLean = true;
    if (!lean && this.mouseLean) lean = clamp(this.input.pointer.x * 1.3, -1, 1);
    const r = stepTilt(this.angle, this.vel, lean, this.wind, diff, dt);
    this.angle = r.angle;
    this.vel = r.vel;

    const speed = 3.4 - Math.abs(this.angle) * 2.2;
    this.x += Math.max(0.8, speed) * dt;
    this.walker.position.x = this.x;
    // The walker tilts about the rope; the pole tips with them.
    this.walker.rotation.z = -this.angle;
    this.camera.position.x = damp(this.camera.position.x, this.x, 6, dt);
    this.camera.lookAt(this.camera.position.x, 8.5, 0);
    this.burst.update(dt);

    this.hud.stat('Distance', `${Math.floor(this.x)} / ${LENGTH} m`);
    this.hud.stat('Balance', Math.abs(this.angle) < 0.6 ? 'steady' : 'WOBBLING', Math.abs(this.angle) >= 0.6);
    this.hud.stat('Wind', `${this.wind > 0.2 ? '→' : this.wind < -0.2 ? '←' : '·'}`);
    if (Math.abs(this.angle) >= FALL_ANGLE) return this.fall();
    if (this.x >= LENGTH) return this.win();
  }

  fall() {
    this.audio.lose();
    const m = Math.floor(this.x);
    this.burst.burst(this.walker.position, PALETTE.cyan, 16, 8);
    this.end(m, `You wobbled off after ${m} metres.`);
  }

  win() {
    this.audio.win();
    this.end(LENGTH + Math.max(0, 40 - Math.floor(this.time0)), `You crossed the rope in ${this.time0.toFixed(1)} seconds!`);
  }
}
