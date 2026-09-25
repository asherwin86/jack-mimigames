import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, lights, sky, glow, mat, Burst, clamp, damp, lerp, PALETTE,
} from '../engine/utils.js';

const G = 9.8;
const K = 0.009;
const JUMPS = 3;
const RAMP_X = -40;             // where the in-run starts
const RAMP_SLOPE = 0.7;
const RAMP_LEN = Math.hypot(40, 40 * RAMP_SLOPE);
const ACCEL = 6.0;
const TAKEOFF_VX = 23.5;
const HILL_A = 0.62;
const HILL_B = 0.0024;
const XM = HILL_A / (2 * HILL_B);

/** Height of the landing hill below the take-off edge at horizontal distance x (steep at first, levelling into the outrun). */
export const hillY = (x) => (x < XM ? -(HILL_A * x - HILL_B * x * x) : -(HILL_A * XM - HILL_B * XM * XM));
/** Lift and drag coefficients for a body angle (0.3 is the sweet spot). */
export const liftCoef = (p) => clamp(1.05 - 3.2 * (p - 0.3) ** 2, -0.3, 1.05);
export const dragCoef = (p) => 0.3 + 0.9 * (p - 0.3) ** 2;

/** Advances a flight state {x, y, vx, vy} one step; returns nothing. */
export function flightStep(s, pitch, dt) {
  const v = Math.hypot(s.vx, s.vy) || 1;
  const q = K * v * v;
  const lift = q * liftCoef(pitch);
  const drag = q * dragCoef(pitch);
  s.vx += ((-drag * s.vx - lift * s.vy) / v) * dt;
  s.vy += ((-drag * s.vy + lift * s.vx) / v - G) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

/** Flies a whole jump with a pitch policy (t) => pitch. Returns { dist, time, pitch (at landing) }. */
export function simulateJump(boost, policy = () => 0.3, dt = 1 / 120) {
  const s = { x: 0, y: 0, vx: TAKEOFF_VX, vy: 1 + boost };
  let t = 0;
  let p = 0.3;
  while (t < 20) {
    p = policy(t, s);
    flightStep(s, p, dt);
    t += dt;
    if (s.y <= hillY(s.x)) break;
  }
  return { dist: Math.hypot(s.x, s.y), time: t, pitch: p };
}

/** Points for a jump: distance beyond 40 m, plus style for take-off timing and flaring at the landing. */
export const jumpPoints = (dist, boost, flared) => Math.round(Math.max(0, (dist - 40) * 2.4) + (boost / 4.5) * 20 + (flared ? 15 : 0));

export default class SkiJump extends Game {
  start() {
    sky(this.scene, '#8ec6f0', '#f2faff', 120, 420);
    lights(this.scene, { sky: 0xffffff, groundCol: 0xb8d0e0, intensity: 1.15 });
    // Hill profile as an extruded polygon.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (let x = 0; x <= 220; x += 4) shape.lineTo(x, hillY(x));
    shape.lineTo(220, -80);
    shape.lineTo(0, -80);
    const hill = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 14, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.9 }));
    hill.position.z = -7;
    hill.receiveShadow = true;
    this.add(hill);
    // The in-run.
    const ramp = new THREE.Shape();
    ramp.moveTo(RAMP_X, -RAMP_X * RAMP_SLOPE);
    ramp.lineTo(0, 0);
    ramp.lineTo(0, -80);
    ramp.lineTo(RAMP_X, -80);
    const rampMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(ramp, { depth: 14, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xdfeaf2, roughness: 0.6 }));
    rampMesh.position.z = -7;
    this.add(rampMesh);
    // K-point markers every 20 m
    for (let d = 40; d <= 160; d += 20) {
      const x = d * 0.86;
      const m = box(0.4, 1.6, 14.4, mat(d === 100 ? PALETTE.red : PALETTE.blue), { cast: false });
      m.position.set(x, hillY(x) + 0.8, 0);
      this.add(m);
    }

    this.skier = new THREE.Group();
    const body = box(1.6, 0.35, 0.5, glow(PALETTE.amber, { emissiveIntensity: 0.4 }));
    const head = ball(0.22, mat(0xf2c9a0));
    head.position.set(0.7, 0.3, 0);
    const skis = box(3, 0.08, 0.3, mat(0x2a2a30));
    skis.position.y = -0.3;
    this.skier.add(body, head, skis);
    this.add(this.skier);
    this.burst = new Burst(this.scene, 50, 0.25);

    this.jump = 0;
    this.score = 0;
    this.best = 0;
    this.results = [];
    this.pitch = 0;
    this.newJump();
    this.showCursor = false;
    this.hud.hint('Watch the ramp: press Space (or click) just as you reach the edge to jump — early or late loses power · in the air, W / S (or ↑ / ↓, or the mouse) change your body angle: find the sweet spot for the longest glide · tap Space just before touchdown to flare and land in style · 3 jumps');
  }

  newJump() {
    this.phase = 'inrun';
    this.s = 0;                     // distance along the ramp
    this.v = 0;
    this.edgeT = Math.sqrt((2 * RAMP_LEN) / ACCEL);
    this.t = 0;
    this.boost = 0;
    this.flared = false;
    this.flying = null;
    this.pitch = 0;
    this.wait = 0;
    this.pressed = false;
  }

  /** The take-off press, `err` seconds after the moment the skier reaches the edge (negative = early). */
  takeOff(err) {
    if (this.phase !== 'inrun' || this.pressed) return null;
    this.pressed = true;
    this.boost = 4.5 * Math.max(0, 1 - Math.abs(err) / 0.3);
    this.audio.blip(this.boost > 3 ? 9 : 4);
    if (this.boost > 3.6) this.hud.toast('PERFECT TAKE-OFF', 800);
    return this.boost;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    if (this.phase === 'inrun') {
      this.t += dt;
      this.s = 0.5 * ACCEL * this.t * this.t;
      const frac = Math.min(1, this.s / RAMP_LEN);
      const x = RAMP_X * (1 - frac);
      this.skier.position.set(x, -x * RAMP_SLOPE + 0.45, 0);
      this.skier.rotation.z = -Math.atan(RAMP_SLOPE);
      if (this.clickedNow() || this.input.hit('Space')) this.takeOff(this.t - this.edgeT);
      if (this.t >= this.edgeT) {
        if (!this.pressed) this.boost = 0;
        this.phase = 'flight';
        this.flying = { x: 0, y: 0, vx: TAKEOFF_VX, vy: 1 + this.boost };
        this.ft = 0;
      }
      this.camera.position.set(this.skier.position.x + 10, this.skier.position.y + 3, 38);
      this.camera.lookAt(this.skier.position.x + 12, this.skier.position.y - 2, 0);
    } else if (this.phase === 'flight') {
      // Body angle: keys, stick, or the mouse height.
      const ky = this.input.axisY();
      if (ky) { this.pitch = clamp(this.pitch + ky * 1.2 * dt, -0.4, 1.0); this.mousePitch = false; }
      else if (this.input.delta.x || this.input.delta.y) this.mousePitch = true;
      if (!ky && this.mousePitch) this.pitch = damp(this.pitch, clamp(0.3 + this.input.pointer.y * 0.7, -0.4, 1.0), 10, dt);
      const f = this.flying;
      this.ft += dt;
      flightStep(f, this.pitch, dt);
      const alt = f.y - hillY(f.x);
      if ((this.input.hit('Space') || this.input.clicked) && alt < 6 && alt > 0.3) this.flared = true;
      this.skier.position.set(f.x, f.y + 0.4, 0);
      this.skier.rotation.z = damp(this.skier.rotation.z, Math.atan2(f.vy, f.vx) + (this.pitch - 0.3) * 0.5, 8, dt);
      if (f.y <= hillY(f.x)) this.land(f);
      this.camera.position.set(f.x + 8, f.y + 5, 42);
      this.camera.lookAt(f.x + 10, f.y - 3, 0);
      this.hud.stat('Distance', `${Math.hypot(f.x, f.y).toFixed(0)} m`);
      this.hud.stat('Glide', `${Math.round(Math.max(0, liftCoef(this.pitch)) / 1.05 * 100)}%`);
    } else if (this.phase === 'landed') {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.jump++;
        if (this.jump >= JUMPS) return this.finish();
        this.newJump();
      }
    }
    this.hud.stat('Jump', `${Math.min(this.jump + 1, JUMPS)}/${JUMPS}`);
    this.hud.stat('Score', this.score);
  }

  land(f) {
    const dist = Math.hypot(f.x, f.y);
    const pts = jumpPoints(dist, this.boost, this.flared);
    this.score += pts;
    this.best = Math.max(this.best, dist);
    this.results.push({ dist, pts });
    this.phase = 'landed';
    this.wait = 2;
    this.skier.position.set(f.x, hillY(f.x) + 0.4, 0);
    this.audio[dist > 100 ? 'win' : 'good']();
    this.burst.burst(this.skier.position, 0xffffff, 16, 7);
    this.hud.toast(`${dist.toFixed(1)} m · +${pts}${this.flared ? ' · FLARE +15' : ''}`, 1600);
  }

  finish() {
    this.audio.win();
    this.end(this.score, `Three jumps, best ${this.best.toFixed(1)} m — ${this.score} points.`);
  }
}
