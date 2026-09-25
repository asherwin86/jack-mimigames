import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const START_Z = 9;
const PIN_Z = -11;
const LANE_HALF = 1.75;
const BALL_R = 0.42;
const PIN_R = 0.3;
const FRAMES = 5;
const ROW_GAP = 0.85;

export default class BowlingLane extends Game {
  start() {
    sky(this.scene, '#26202e', '#08060c', 35, 90);
    lights(this.scene, { sky: 0xffe8c8, groundCol: 0x201830 });

    const lane = box(LANE_HALF * 2, 0.3, 28, mat(0xc98d52, { roughness: 0.35 }), { cast: false });
    lane.position.set(0, -0.15, -3);
    this.add(lane);
    for (const s of [-1, 1]) {
      const gutter = box(0.6, 0.2, 28, mat(0x1a1620), { cast: false });
      gutter.position.set(s * (LANE_HALF + 0.35), -0.3, -3);
      this.add(gutter);
      const rail = box(0.4, 0.8, 28, mat(0x3a2f4a));
      rail.position.set(s * (LANE_HALF + 0.9), 0.2, -3);
      this.add(rail);
    }
    const pit = box(LANE_HALF * 2 + 2.4, 1.2, 2, mat(0x0c0a12));
    pit.position.set(0, 0.1, PIN_Z - 4.4);
    this.add(pit);

    this.pins = [];
    let idx = 0;
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k <= row; k++) {
        const pin = new THREE.Group();
        pin.add(cyl(0.22, 0.3, 0.9, mat(0xf4f4fa)));
        const neck = cyl(0.13, 0.18, 0.5, mat(0xf4f4fa)); neck.position.y = 0.65;
        const stripe = cyl(0.23, 0.23, 0.1, mat(0xd8344a)); stripe.position.y = 0.55;
        pin.add(neck, stripe);
        pin.userData = { home: new THREE.Vector3((k - row / 2) * 0.7, 0.45, PIN_Z - row * ROW_GAP), vel: new THREE.Vector3(), down: false, tilt: 0, idx: idx++ };
        this.pins.push(this.add(pin));
      }
    }
    this.ball = this.add(ball(BALL_R, glow(PALETTE.violet, { emissiveIntensity: 0.4 })));
    this.marker = this.add(new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 20), new THREE.MeshBasicMaterial({ color: PALETTE.amber, side: THREE.DoubleSide })));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.02;
    this.burst = new Burst(this.scene, 80, 0.2);

    this.frame = 1;
    this.rollNo = 1;          // 1st or 2nd ball of the frame
    this.score = 0;
    this.strikes = 0;
    this.spares = 0;
    this.state = 'aim';       // aim -> rolling -> settle
    this.power = 0;
    this.aimX = 0;
    this.showCursor = true;
    this.resetPins();
    this.placeBall();

    this.camera.position.set(0, 3.4, 13.2);
    this.camera.lookAt(0, 0.7, -7);
    this.hud.hint('Move the mouse to choose where to aim · click to roll (the power bar swings: the middle is straightest) · 5 frames, two balls each');
  }

  resetPins() {
    for (const p of this.pins) {
      p.position.copy(p.userData.home);
      p.rotation.set(0, 0, 0);
      p.userData.vel.set(0, 0, 0);
      p.userData.down = false;
      p.userData.tilt = 0;
      p.visible = true;
    }
  }

  standing() { return this.pins.filter((p) => !p.userData.down); }

  placeBall() {
    this.ball.position.set(0, BALL_R, START_Z);
    this.bvel = new THREE.Vector3();
    this.ball.visible = true;
  }

  /** Where the pointer's ray meets the lane (the marker shows it), across the lane's width. */
  aimPoint() {
    const p = this.groundPoint(0);
    return p ? clamp(p.x, -LANE_HALF + 0.3, LANE_HALF - 0.3) : 0;
  }

  update(dt) {
    if (this.state === 'aim') {
      this.aimX = this.aimPoint();
      const kb = this.input.axisX();
      if (kb) this.aimX = clamp(this.aimX + kb * 0.02, -LANE_HALF + 0.3, LANE_HALF - 0.3);
      this.power = 0.5 + 0.5 * Math.sin(this.time * 2.6);
      this.marker.position.set(this.aimX, 0.02, PIN_Z + 1);
      this.marker.visible = true;
      this.ball.position.x = damp(this.ball.position.x, this.aimX * 0.4, 12, dt);
      if (this.clickedNow() || this.input.hit('Space')) this.roll();
    } else if (this.state === 'rolling') {
      this.marker.visible = false;
      this.stepPhysics(dt);
      this.rollT += dt;
      if (this.ball.position.z < PIN_Z - 6 || this.rollT > 5.5) { this.state = 'settle'; this.settleT = 1.3; this.ball.visible = false; }
    } else if (this.state === 'settle') {
      this.stepPins(dt);
      this.settleT -= dt;
      if (this.settleT <= 0) this.finishRoll();
    }

    // Fallen pins tip over
    for (const p of this.pins) {
      const u = p.userData;
      if (u.down) { u.tilt = damp(u.tilt, 1.45, 8, dt); p.rotation.z = u.tilt * (u.idx % 2 ? 1 : -1); p.rotation.x = u.tilt * 0.3; p.position.y = damp(p.position.y, 0.2, 8, dt); }
    }
    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Frame', `${Math.min(this.frame, FRAMES)}/${FRAMES}`);
    this.hud.stat('Ball', this.rollNo);
    this.hud.stat('Power', this.state === 'aim' ? `${Math.round(this.power * 100)}%` : '—');
  }

  roll() {
    // The power bar swings; the middle is the straightest, hard or soft throws wander.
    const wander = (Math.abs(this.power - 0.6)) * 0.16;
    const angle = Math.atan2(this.aimX - this.ball.position.x, START_Z - (PIN_Z - 1)) + (Math.random() < 0.5 ? -1 : 1) * wander * Math.random();
    const speed = 9 + this.power * 12;
    this.bvel.set(Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    this.state = 'rolling';
    this.rollT = 0;
    this.audio.tone([200, 400], 0.15, { type: 'triangle', gain: 0.08 });
  }

  stepPhysics(dt) {
    const b = this.ball.position;
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      b.x += this.bvel.x * dt / steps;
      b.z += this.bvel.z * dt / steps;
      if (Math.abs(b.x) > LANE_HALF) { b.y = -0.1; this.bvel.x = 0; }       // into the gutter: it just runs straight to the end
      if (b.y > -0.05) this.ballHitsPins();
      this.stepPins(dt / steps);
    }
    this.ball.rotation.x -= this.bvel.z * dt * 2;
  }

  ballHitsPins() {
    const b = this.ball.position;
    for (const p of this.pins) {
      const dx = p.position.x - b.x;
      const dz = p.position.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < BALL_R + PIN_R && d > 1e-4) {
        const nx = dx / d; const nz = dz / d;
        const speed = Math.hypot(this.bvel.x, this.bvel.z);
        p.userData.vel.x = this.bvel.x * 0.9 + nx * speed * 0.55;
        p.userData.vel.z = this.bvel.z * 0.9 + nz * speed * 0.55;
        this.markDown(p);
        this.bvel.x *= 0.93; this.bvel.z *= 0.93;
        this.bvel.x -= nx * 0.6; this.bvel.z -= nz * 0.15;
      }
    }
  }

  markDown(p) {
    if (p.userData.down) return;
    p.userData.down = true;
    this.burst.burst(p.position, PALETTE.white, 3, 4);
    this.audio.thud();
  }

  stepPins(dt) {
    for (const p of this.pins) {
      const u = p.userData;
      p.position.x += u.vel.x * dt;
      p.position.z += u.vel.z * dt;
      u.vel.multiplyScalar(Math.exp(-1.6 * dt));
      // pins that are moving fast enough knock their neighbours over
      const sp = Math.hypot(u.vel.x, u.vel.z);
      if (sp > 0.6) this.markDown(p);
      if (sp > 0.3) {
        for (const q of this.pins) {
          if (q === p) continue;
          const dx = q.position.x - p.position.x;
          const dz = q.position.z - p.position.z;
          const d = Math.hypot(dx, dz);
          if (d < PIN_R * 2 && d > 1e-4) {
            const push = Math.min(1, sp * 0.6);
            q.userData.vel.x += (dx / d) * sp * 0.6 * push;
            q.userData.vel.z += (dz / d) * sp * 0.6 * push;
            u.vel.multiplyScalar(0.8);
            if (sp > 0.9) this.markDown(q);
          }
        }
      }
      // off the deck / into the pit: gone
      if (Math.abs(p.position.x) > LANE_HALF + 1 || p.position.z < PIN_Z - 3.6) { p.userData.down = true; p.visible = false; u.vel.set(0, 0, 0); }
    }
  }

  finishRoll() {
    const downNow = this.pins.filter((p) => p.userData.down).length;
    const first = this.rollNo === 1;
    const knocked = downNow - (first ? 0 : this.downAfterFirst);
    this.score += knocked;
    let done = false;
    if (first && downNow === 10) { this.score += 10; this.strikes++; this.hud.toast('STRIKE! +10', 1100); this.audio.win(); done = true; }
    else if (!first && downNow === 10) { this.score += 5; this.spares++; this.hud.toast('SPARE +5', 1000); this.audio.good(); done = true; }
    else if (first) { this.downAfterFirst = downNow; this.hud.toast(knocked ? `${knocked} down` : 'GUTTER', 700); }
    else { done = true; this.hud.toast(`${knocked} down`, 700); }

    if (done) {
      this.frame++;
      this.rollNo = 1;
      if (this.frame > FRAMES) return this.finish();
      this.resetPins();
    } else {
      this.rollNo = 2;
      for (const p of this.pins) if (p.userData.down) p.visible = false;   // clear the fallen pins for the second ball
    }
    this.state = 'aim';
    this.placeBall();
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.strikes} strike${this.strikes === 1 ? '' : 's'}, ${this.spares} spare${this.spares === 1 ? '' : 's'}.`);
  }
}
