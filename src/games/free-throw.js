import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, torus, ground, lights, sky, glow, mat, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const GRAV = 16;
const ANGLE = 0.95;              // fixed launch elevation, in radians
const HOOP = new THREE.Vector3(0, 3.6, -11);
const RIM_R = 0.62;

export default class FreeThrow extends Game {
  start() {
    sky(this.scene, '#1c2f4a', '#05070c', 40, 130);
    lights(this.scene, { sky: 0xbcd0ff, groundCol: 0x1a2030 });
    this.add(ground(60, 0x1c2436));

    this.add(box(3.4, 2.2, 0.15, PALETTE.white, { pos: [HOOP.x, HOOP.y + 0.9, HOOP.z - 0.4] }));
    this.rim = this.add(torus(RIM_R, 0.05, PALETTE.amber));
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.copy(HOOP);
    this.pole = this.add(cyl(0.05, 0.05, HOOP.y, mat(0x555555)));
    this.pole.position.set(HOOP.x, HOOP.y / 2, HOOP.z - 0.45);

    this.ballMesh = this.add(ball(0.32, glow(PALETTE.amber, { emissiveIntensity: 0.2 })));
    this.shots = [];
    this.burst = new Burst(this.scene, 90, 0.16);

    this.power = 0;
    this.charging = false;
    this.score = 0;
    this.made = 0;
    this.attempts = 0;
    this.timeLeft = 45;
    this.newSpot();
    this.hud.hint('Hold click and release at the right power to sink the shot');
  }

  newSpot() {
    const dist = rand(6, 12.5);
    const a = rand(-0.5, 0.5);
    this.spot = new THREE.Vector3(HOOP.x + Math.sin(a) * dist, 1.15, HOOP.z + Math.cos(a) * dist);
    this.dist = dist;
    this.points = Math.round(dist / 1.5) + 2;
    this.ballMesh.position.copy(this.spot);
    this.ballMesh.visible = true;
    // High and well back of the shooting spot: close in, a low camera can't
    // pitch down far enough to keep both the ball and the hoop in frame.
    this.camera.position.set(this.spot.x * 0.6, 6, this.spot.z + 7);
    // Look partway between the ball and the hoop, not at the hoop itself —
    // aimed straight at the (much higher) hoop, the foreground ball falls
    // below the view.
    this.lookTarget = this.spot.clone().lerp(HOOP, 0.65);
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0 && !this.shots.length) return this.finish();

    if (this.input.down && this.ballMesh.visible) {
      if (!this.charging) { this.charging = true; this.power = 0; }
      this.power = clamp(this.power + dt * 0.85, 0, 1);
    } else if (this.charging) {
      this.charging = false;
      this.fire();
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const wasFalling = s.userData.vel.y < 0;
      s.userData.vel.y -= GRAV * dt;
      s.position.addScaledVector(s.userData.vel, dt);
      s.rotation.x += dt * 8;

      const dxz = Math.hypot(s.position.x - HOOP.x, s.position.z - HOOP.z);
      if (wasFalling && dxz < RIM_R * 0.75 && Math.abs(s.position.y - HOOP.y) < 0.35) {
        this.make(s, i);
        continue;
      }
      if (s.position.y < 0.2) { this.miss(s, i); continue; }
    }

    this.burst.update(dt);
    this.camera.lookAt(this.lookTarget);

    this.hud.stat('Score', this.score);
    this.hud.stat('Made', `${this.made}/${this.attempts}`);
    this.hud.stat('Power', this.charging ? `${Math.round(this.power * 100)}%` : '—');
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)));
  }

  fire() {
    if (this.power < 0.04) return;
    this.attempts++;
    const dir = HOOP.clone().sub(this.spot).setY(0).normalize();
    const speed = 6 + this.power * (6 + this.dist * 1.1);
    const vel = new THREE.Vector3(
      dir.x * Math.cos(ANGLE) * speed,
      Math.sin(ANGLE) * speed,
      dir.z * Math.cos(ANGLE) * speed,
    );
    const s = ball(0.32, glow(PALETTE.amber, { emissiveIntensity: 0.2 }));
    s.position.copy(this.spot);
    s.userData = { vel };
    this.shots.push(this.add(s));
    this.ballMesh.visible = false;
    this.audio.tone([500, 700], 0.08, { type: 'triangle', gain: 0.1 });
    this.power = 0;
  }

  make(s, i) {
    this.made++;
    this.score += this.points;
    this.burst.burst(HOOP, PALETTE.amber, 22, 8);
    this.audio.good();
    this.hud.toast(`+${this.points}`, 700);
    this.removeShot(i);
    if (this.timeLeft > 0) this.newSpot();
  }

  miss(s, i) {
    this.burst.burst(s.position, 0x777777, 8, 4);
    this.audio.bad();
    this.removeShot(i);
    if (this.timeLeft > 0) this.newSpot();
  }

  removeShot(i) {
    const s = this.shots[i];
    this.scene.remove(s);
    s.geometry.dispose();
    s.material.dispose();
    this.shots.splice(i, 1);
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.made} of ${this.attempts} shots made.`);
  }
}
