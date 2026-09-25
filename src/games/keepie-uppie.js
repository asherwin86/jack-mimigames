import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HALF_W = 9;
const CEIL = 13;
const R = 0.75;
const REACH = 1.9;   // how far from the ball a click still connects

/** Ball velocity after a touch: straight up, sideways away from where the foot met it. */
export function kickVelocity(ball, foot, touches) {
  const off = clamp(ball.x - foot.x, -REACH, REACH);
  const up = 11.5 + Math.min(3, touches * 0.05) + (1 - Math.abs(off) / REACH) * 1.5;
  return { vx: clamp(off * 4.5, -7, 7), vy: up };
}

export default class KeepieUppie extends Game {
  start() {
    sky(this.scene, '#6ab0f0', '#e8f6ff', 80, 260);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    const floor = box(60, 1, 8, mat(0x3a8a3a));
    floor.position.set(0, -0.5, 0);
    this.add(floor);
    for (const s of [-1, 1]) {
      const post = box(0.3, CEIL + 2, 1, glow(PALETTE.blue, { emissiveIntensity: 0.4 }), { cast: false });
      post.position.set(s * (HALF_W + 0.8), (CEIL + 2) / 2, 0);
      this.add(post);
    }
    this.ball = this.add(ball(R, mat(0xf6f6f6, { roughness: 0.4 })));
    // A few dark patches so the spin is visible.
    for (let i = 0; i < 5; i++) {
      const patch = ball(0.22, mat(0x222222), { cast: false });
      patch.position.set(...new THREE.Vector3().randomDirection().multiplyScalar(R * 0.95).toArray());
      this.ball.add(patch);
    }
    this.foot = this.add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 28), new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.85, depthTest: false })));
    this.foot.renderOrder = 10;
    this.burst = new Burst(this.scene, 40, 0.2);
    this.pos = { x: 0, y: 7.5 };
    this.grace = 1.6;        // the ball hangs in the air for a moment so you can get your foot under it
    this.vel = { x: rand(-1, 1), y: 0 };
    this.touches = 0;
    this.best = 0;
    this.cursor = { x: 0, y: 1.5 };
    this.spin = 0;
    this.showCursor = true;
    this.camera.position.set(0, 6.5, 22);
    this.camera.lookAt(0, 6.5, 0);
    this.hud.hint('Move the mouse under the ball and click to kick it back up — where you meet it decides which way it goes · keep it off the ground · gravity gets stronger as you go');
  }

  /** A click with the foot ring at (fx, fy): connects when the ball is close. Returns true if it did. */
  kick(fx = this.cursor.x, fy = this.cursor.y) {
    const d = Math.hypot(this.pos.x - fx, this.pos.y - fy);
    if (d > REACH + R * 0.5) return false;
    const v = kickVelocity(this.pos, { x: fx, y: fy }, this.touches);
    this.vel.x = v.vx;
    this.vel.y = v.vy;
    this.spin = -v.vx * 0.6;
    this.touches++;
    this.audio.blip(Math.min(12, 2 + (this.touches % 12)));
    this.burst.burst(new THREE.Vector3(this.pos.x, this.pos.y - R, 0), PALETTE.amber, 4, 4);
    if (this.touches % 10 === 0) this.hud.toast(`${this.touches}!`, 700);
    return true;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    const p = this.planePoint(0);
    if (p) { this.cursor.x = clamp(p.x, -HALF_W, HALF_W); this.cursor.y = clamp(p.y, 0.3, CEIL); }
    const kx = this.input.axisX();
    const ky = this.input.axisY();
    if (kx || ky) { this.cursor.x = clamp(this.cursor.x + kx * 16 * dt, -HALF_W, HALF_W); this.cursor.y = clamp(this.cursor.y + ky * 16 * dt, 0.3, CEIL); }
    this.foot.position.set(this.cursor.x, this.cursor.y, 0.5);
    if (this.clickedNow() || this.input.hit('Space')) this.kick();

    if (this.grace > 0 && this.touches === 0) {
      this.grace -= dt;
      this.ball.position.set(this.pos.x, this.pos.y + Math.sin(this.time * 5) * 0.15, 0);
      this.hud.stat('Touches', 0);
      this.hud.stat('Height', 'get ready');
      return;
    }
    const g = 17 + Math.min(9, this.touches * 0.12);
    this.vel.y -= g * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.x < -HALF_W + R) { this.pos.x = -HALF_W + R; this.vel.x = Math.abs(this.vel.x) * 0.85; }
    if (this.pos.x > HALF_W - R) { this.pos.x = HALF_W - R; this.vel.x = -Math.abs(this.vel.x) * 0.85; }
    if (this.pos.y > CEIL) { this.pos.y = CEIL; this.vel.y = -Math.abs(this.vel.y) * 0.4; }
    this.ball.position.set(this.pos.x, this.pos.y, 0);
    this.ball.rotation.z += this.spin * dt;
    this.spin = damp(this.spin, 0, 1, dt);
    this.foot.material.color.setHex(Math.hypot(this.pos.x - this.cursor.x, this.pos.y - this.cursor.y) <= REACH + R * 0.5 ? PALETTE.lime : PALETTE.amber);

    if (this.pos.y <= R) return this.drop();
    this.hud.stat('Touches', this.touches);
    this.hud.stat('Height', `${Math.max(0, this.pos.y).toFixed(1)} m`);
  }

  drop() {
    this.audio.lose();
    this.end(this.touches, `${this.touches} touch${this.touches === 1 ? '' : 'es'} before it hit the grass.`);
  }
}
