import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, lerp, rand, PALETTE,
} from '../engine/utils.js';

const GOAL_Z = -14;
const GOAL_HALF = 6;
const GOAL_H = 4;
const KICKS = 10;
const SPOT = new THREE.Vector3(0, 0.4, 6);

/** Where the ball actually goes: the aim point plus an error that grows the further the power is from the sweet spot (0.85). */
export function actualShot(target, power, rng = Math.random) {
  const err = Math.abs(power - 0.85) * 3.2 + 0.15;
  return { x: target.x + (rng() - 0.5) * 2 * err, y: target.y + (rng() - 0.5) * 2 * err * 0.8 };
}

/** The keeper's dive point: he reads the shot more often as the round goes on. */
export function keeperDive(target, kick, rng = Math.random) {
  const read = Math.min(0.62, 0.18 + kick * 0.045);
  if (rng() < read) return { x: clamp(target.x + (rng() - 0.5) * 2, -5.2, 5.2), y: clamp(target.y + (rng() - 0.5) * 1.6, 0.5, 3.4) };
  return { x: rand(-5, 5), y: rand(0.6, 3.4) };
}

/** 'goal' | 'save' | 'miss' for a ball arriving at `shot` with `power` against a keeper diving to `dive`. */
export function judge(shot, power, dive) {
  if (Math.abs(shot.x) > GOAL_HALF - 0.15 || shot.y > GOAL_H - 0.1 || shot.y < 0) return 'miss';
  const reach = 1.75 + (power < 0.5 ? (0.5 - power) * 3 : 0) - (power > 0.8 ? 0.35 : 0);
  return Math.hypot(shot.x - dive.x, shot.y - dive.y) < reach ? 'save' : 'goal';
}

/** Points for a goal: a bonus for the top corners. */
export const pointsFor = (shot) => 10 + (Math.abs(shot.x) > 4.2 && shot.y > 2.5 ? 5 : 0);

export default class PenaltyKicks extends Game {
  start() {
    sky(this.scene, '#3f8fe0', '#d6ecff', 60, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x3f7a3a, intensity: 1.1 });
    this.add(ground(200, 0x2f7a30));
    // Goal frame and net
    const postMat = mat(0xf2f2f2);
    for (const s of [-1, 1]) {
      const p = cyl(0.13, 0.13, GOAL_H, postMat);
      p.position.set(s * GOAL_HALF, GOAL_H / 2, GOAL_Z);
      this.add(p);
    }
    const bar = cyl(0.13, 0.13, GOAL_HALF * 2, postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_H, GOAL_Z);
    this.add(bar);
    const net = box(GOAL_HALF * 2, GOAL_H, 0.05, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 }), { cast: false });
    net.position.set(0, GOAL_H / 2, GOAL_Z - 1.2);
    this.add(net);

    this.keeper = new THREE.Group();
    const body = box(1, 1.6, 0.6, glow(PALETTE.amber, { emissiveIntensity: 0.3 }));
    body.position.y = 1.2;
    const head = ball(0.32, mat(0xf2c9a0));
    head.position.y = 2.3;
    const arms = box(2.4, 0.25, 0.3, glow(PALETTE.amber, { emissiveIntensity: 0.3 }));
    arms.position.y = 1.7;
    this.keeper.add(body, head, arms);
    this.keeper.position.set(0, 0, GOAL_Z + 0.3);
    this.add(this.keeper);

    this.ball = this.add(ball(0.38, mat(0xf6f6f6, { roughness: 0.4 })));
    this.ball.position.copy(SPOT);
    this.marker = this.add(new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.9, depthTest: false })));
    this.marker.renderOrder = 10;
    this.burst = new Burst(this.scene, 60, 0.2);

    this.kick = 0;
    this.score = 0;
    this.goals = 0;
    this.phase = 'aim';
    this.power = 0;
    this.powerT = 0;
    this.after = 0;
    this.target = { x: 0, y: 2 };
    this.showCursor = true;
    this.camera.position.set(0, 2.4, 11.5);
    this.camera.lookAt(0, 2, GOAL_Z);
    this.hud.hint('Move the mouse to aim · click once to start the power bar, click again to shoot — the sweet spot is near the top but not all the way · top corners score extra · 10 kicks');
  }

  /** Locks the power and takes the kick. Returns the outcome. */
  shoot(power = this.power) {
    this.phase = 'flight';
    const shot = actualShot(this.target, power);
    const dive = keeperDive(this.target, this.kick);
    this.flight = { shot, dive, power, t: 0, dur: 0.42 + (1 - power) * 0.55, result: judge(shot, power, dive) };
    this.audio.thud();
    return this.flight.result;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    if (this.phase === 'aim' || this.phase === 'power') {
      const p = this.planePoint(GOAL_Z);
      if (p) this.target = { x: clamp(p.x, -7, 7), y: clamp(p.y, 0.2, 5) };
      this.marker.position.set(this.target.x, this.target.y, GOAL_Z + 0.2);
      this.marker.visible = true;
      this.keeper.position.x = damp(this.keeper.position.x, Math.sin(this.time * 1.7) * 2.2, 4, dt);
      if (this.phase === 'aim' && this.clickedNow()) { this.phase = 'power'; this.powerT = 0; }
      else if (this.phase === 'power') {
        this.powerT += dt;
        const c = (this.powerT / 0.65) % 2;
        this.power = c < 1 ? c : 2 - c;
        if (this.clickedNow() && this.powerT > 0.1) this.shoot();
      }
    } else if (this.phase === 'flight') {
      const f = this.flight;
      f.t += dt / f.dur;
      const u = clamp(f.t, 0, 1);
      this.marker.visible = false;
      this.ball.position.set(lerp(SPOT.x, f.shot.x, u), lerp(SPOT.y, f.shot.y, u) + Math.sin(u * Math.PI) * 1.2, lerp(SPOT.z, GOAL_Z, u));
      this.ball.rotation.x += dt * 12;
      // the keeper dives towards his chosen point
      const k = clamp(u * 1.8, 0, 1);
      this.keeper.position.x = lerp(this.keeper.position.x, f.dive.x, k * 0.25);
      this.keeper.position.y = lerp(this.keeper.position.y, Math.max(0, f.dive.y - 1.6), k * 0.25);
      this.keeper.rotation.z = -clamp((f.dive.x - this.keeper.position.x), -1.5, 1.5) * 0.25;
      if (f.t >= 1) this.land();
    } else if (this.phase === 'result') {
      this.after -= dt;
      if (this.after <= 0) {
        this.kick++;
        if (this.kick >= KICKS) return this.finish();
        this.phase = 'aim';
        this.ball.position.copy(SPOT);
        this.keeper.position.set(0, 0, GOAL_Z + 0.3);
        this.keeper.rotation.z = 0;
      }
    }
    this.hud.stat('Kick', `${Math.min(this.kick + 1, KICKS)}/${KICKS}`);
    this.hud.stat('Goals', this.goals);
    this.hud.stat('Score', this.score);
    this.hud.stat('Power', this.phase === 'power' ? '▮'.repeat(Math.round(this.power * 12)) + '▯'.repeat(12 - Math.round(this.power * 12)) : '—');
  }

  land() {
    const f = this.flight;
    this.phase = 'result';
    this.after = 1.3;
    if (f.result === 'goal') {
      const pts = pointsFor(f.shot);
      this.score += pts;
      this.goals++;
      this.hud.toast(pts > 10 ? `TOP CORNER! +${pts}` : `GOAL! +${pts}`, 1100);
      this.audio.win();
      this.burst.burst(this.ball.position, PALETTE.lime, 20, 9);
    } else if (f.result === 'save') {
      this.hud.toast('SAVED!', 1000);
      this.audio.bad();
      this.ball.position.z += 1.5;
    } else {
      this.hud.toast(f.shot.y > GOAL_H ? 'OVER THE BAR' : 'WIDE', 1000);
      this.audio.bad();
    }
  }

  finish() {
    this.audio[this.goals >= 6 ? 'win' : 'lose']();
    this.end(this.score, `${this.goals} goal${this.goals === 1 ? '' : 's'} from ${KICKS} kicks — ${this.score} points.`);
  }
}
