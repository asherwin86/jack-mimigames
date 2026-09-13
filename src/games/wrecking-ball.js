import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, pick, COLORS, PALETTE,
} from '../engine/utils.js';

const ROPE = 9;
const COLS = 5;

export default class WreckingBall extends Game {
  start() {
    sky(this.scene, '#3a2c1a', '#0a0806', 30, 110);
    lights(this.scene, { sky: 0xffdca0, groundCol: 0x241a10 });
    this.add(ground(80, 0x201a14));

    this.pivot = this.add(new THREE.Group());
    this.pivot.position.set(0, 11, -6);
    this.rope = cyl(0.05, 0.05, ROPE, mat(0x222222));
    this.rope.position.y = -ROPE / 2;
    this.pivot.add(this.rope);
    this.wball = ball(0.9, glow(0x2c2c2c, { emissiveIntensity: 0.15 }));
    this.wball.position.y = -ROPE;
    this.pivot.add(this.wball);

    this.angle = 0;
    this.prevAngle = 0;
    this.blocks = [];
    this.falling = [];
    this.pool = [];
    for (let i = 0; i < 60; i++) {
      const b = box(1.4, 1.4, 1.4, pick(COLORS));
      b.visible = false;
      this.pool.push(this.add(b));
    }

    this.burst = new Burst(this.scene, 120, 0.2);
    this.score = 0;
    this.timeLeft = 45;
    this.buildTower();

    this.camera.position.set(0, 8, 14);
    this.camera.lookAt(0, 4, -4);
    this.hud.hint('Move the mouse left and right to swing the ball into the tower');
  }

  buildTower() {
    const rows = 4 + Math.min(4, Math.floor(this.score / COLS / 3));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const b = this.pool.pop();
        if (!b) return;
        b.material.color.set(pick(COLORS));
        b.position.set((c - (COLS - 1) / 2) * 1.5, 0.7 + r * 1.42, -6 + rand(-0.2, 0.2));
        b.rotation.set(0, 0, 0);
        b.visible = true;
        b.userData = { standing: true, vel: new THREE.Vector3() };
        this.blocks.push(b);
      }
    }
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();

    this.prevAngle = this.angle;
    const target = clamp(-this.input.pointer.x * 1.1, -1.1, 1.1);
    this.angle = damp(this.angle, target, 6, dt);
    const speed = Math.abs(this.angle - this.prevAngle) / dt;

    this.pivot.rotation.z = this.angle;
    const tip = new THREE.Vector3(0, -ROPE, 0).applyEuler(this.pivot.rotation).add(this.pivot.position);

    // Fast enough, and close enough, knocks a standing block loose.
    if (speed > 1.2) {
      for (let i = this.blocks.length - 1; i >= 0; i--) {
        const b = this.blocks[i];
        if (!b.userData.standing) continue;
        if (b.position.distanceTo(tip) < 1.7) this.knock(b, tip, speed);
      }
    }

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const b = this.falling[i];
      const d = b.userData;
      d.vel.y -= 22 * dt;
      b.position.addScaledVector(d.vel, dt);
      b.rotation.x += dt * 5;
      b.rotation.z += dt * 3.5;
      if (b.position.y < -6) this.recycle(b, i);
    }

    if (this.blocks.filter((b) => b.userData.standing).length === 0) {
      this.blocks = [];
      this.buildTower();
      this.hud.toast('NEW TOWER', 700);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)));
  }

  knock(b, tip, speed) {
    b.userData.standing = false;
    b.userData.vel = b.position.clone().sub(tip).setY(rand(2, 5)).normalize()
      .multiplyScalar(clamp(speed, 3, 9));
    this.falling.push(b);
    this.blocks.splice(this.blocks.indexOf(b), 1);
    this.score++;
    this.burst.burst(b.position, b.material.color.getHex(), 12, 6);
    this.audio.thud();
    this.audio.blip(clamp(this.score % 12, 0, 12));
  }

  recycle(b, i) {
    b.visible = false;
    this.falling.splice(i, 1);
    this.pool.push(b);
  }

  finish() {
    this.audio.win();
    this.end(this.score, `You knocked ${this.score} blocks loose.`);
  }
}
