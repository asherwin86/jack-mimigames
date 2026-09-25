import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, clamp, COLORS, PALETTE,
} from '../engine/utils.js';

const L = 10;            // half table length (x)
const W = 5;             // half table width (z)
const R = 0.45;
const SHOTS = 14;
const POCKETS = [[-L, -W, 0.95], [L, -W, 0.95], [-L, W, 0.95], [L, W, 0.95], [0, -W, 0.8], [0, W, 0.8]];
const FRICTION = 0.55;   // constant deceleration, units/s²
const DAMP = 0.35;       // and a little rolling drag

/** Advances balls [{x, z, vx, vz, alive}] by dt (substepped). Returns the list of balls potted this step. */
export function stepBalls(balls, dt) {
  const potted = [];
  const sub = 6;
  const h = dt / sub;
  for (let it = 0; it < sub; it++) {
    for (const b of balls) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0) {
        const ns = Math.max(0, sp - FRICTION * h) * Math.exp(-DAMP * h);
        b.vx *= ns / sp; b.vz *= ns / sp;
        if (ns < 0.04) { b.vx = 0; b.vz = 0; }
      }
      b.x += b.vx * h;
      b.z += b.vz * h;
      // pockets first
      for (const [px, pz, pr] of POCKETS) {
        if (Math.hypot(b.x - px, b.z - pz) < pr) { b.alive = false; b.vx = b.vz = 0; potted.push(b); break; }
      }
      if (!b.alive) continue;
      // cushions
      if (b.x < -L + R) { b.x = -L + R; b.vx = Math.abs(b.vx) * 0.78; }
      if (b.x > L - R) { b.x = L - R; b.vx = -Math.abs(b.vx) * 0.78; }
      if (b.z < -W + R) { b.z = -W + R; b.vz = Math.abs(b.vz) * 0.78; }
      if (b.z > W - R) { b.z = W - R; b.vz = -Math.abs(b.vz) * 0.78; }
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= R * 2 || d < 1e-6) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = (R * 2 - d) / 2;
        a.x -= nx * overlap; a.z -= nz * overlap;
        b.x += nx * overlap; b.z += nz * overlap;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const imp = -(1 + 0.96) * rel / 2;
          a.vx -= imp * nx; a.vz -= imp * nz;
          b.vx += imp * nx; b.vz += imp * nz;
        }
      }
    }
  }
  return potted;
}

export const anyMoving = (balls) => balls.some((b) => b.alive && Math.hypot(b.vx, b.vz) > 0.04);

/** The rack: a triangle of ten balls pointing at the cue ball. */
export function rack() {
  const out = [];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      out.push({ x: 4 + row * (R * 2 + 0.02) * 0.87, z: (i - row / 2) * (R * 2 + 0.02), vx: 0, vz: 0, alive: true });
    }
  }
  return out;
}

export default class PoolBreak extends Game {
  start() {
    sky(this.scene, '#241a14', '#0a0705', 60, 160);
    lights(this.scene, { sky: 0xffe8c8, groundCol: 0x1c120c });
    this.add(ground(80, 0x1a120c));
    const cloth = box(L * 2 + 1, 0.5, W * 2 + 1, mat(0x0f7a45, { roughness: 0.9 }));
    cloth.position.y = -0.25;
    this.add(cloth);
    for (const [x, z, w, d] of [[0, -W - 0.6, L * 2 + 2.4, 1], [0, W + 0.6, L * 2 + 2.4, 1], [-L - 0.6, 0, 1, W * 2], [L + 0.6, 0, 1, W * 2]]) {
      const rail = box(w, 0.7, d, mat(0x5a3418, { roughness: 0.6 }));
      rail.position.set(x, 0.25, z);
      this.add(rail);
    }
    for (const [x, z, r] of POCKETS) {
      const p = cyl(r, r, 0.05, mat(0x050505), { cast: false });
      p.position.set(x, 0.03, z);
      this.add(p);
    }

    this.balls = [{ x: -6, z: 0, vx: 0, vz: 0, alive: true }, ...rack()];
    this.meshes = this.balls.map((b, i) => {
      const m = ball(R, mat(i === 0 ? 0xffffff : COLORS[i % COLORS.length], { roughness: 0.2 }));
      m.position.set(b.x, R, b.z);
      return this.add(m);
    });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.line.frustumCulled = false;
    this.add(this.line);
    this.ghost = this.add(ball(R, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }), { cast: false }));
    this.burst = new Burst(this.scene, 60, 0.2);

    this.shots = SHOTS;
    this.potted = 0;
    this.score = 0;
    this.scratches = 0;
    this.charge = 0;
    this.charging = false;
    this.aim = new THREE.Vector2(1, 0);
    this.phase = 'aim';
    this.settle = 0;
    this.showCursor = true;
    this.camera.position.set(0, 17, 6);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Move the mouse to aim the white ball · hold click to pull the cue back, release to shoot · pot as many balls as you can in 14 shots · a scratch (potting the white) costs 10 points and a shot');
  }

  cue() { return this.balls[0]; }

  /** Takes a shot at `angle` (radians from +x toward +z) with power 0..1. */
  shoot(angle, power) {
    if (this.phase !== 'aim' || this.shots <= 0) return false;
    const v = 3 + clamp(power, 0, 1) * 17;
    const c = this.cue();
    c.vx = Math.cos(angle) * v;
    c.vz = Math.sin(angle) * v;
    this.shots--;
    this.phase = 'roll';
    this.settle = 0;
    this.audio.thud();
    return true;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    if (this.phase === 'aim') {
      const c = this.cue();
      const g = this.groundPoint(0);
      if (g) this.aim.set(g.x - c.x, g.z - c.z);
      const kx = this.input.axisX();
      const ky = this.input.axisY();
      if (kx || ky) this.aim.rotateAround(new THREE.Vector2(), -kx * 1.6 * dt);
      const angle = Math.atan2(this.aim.y, this.aim.x);
      const lp = this.line.geometry.attributes.position;
      lp.setXYZ(0, c.x, 0.5, c.z);
      lp.setXYZ(1, c.x + Math.cos(angle) * 12, 0.5, c.z + Math.sin(angle) * 12);
      lp.needsUpdate = true;
      this.line.visible = true;
      // ghost ball where the cue ball would first touch another ball
      const hit = this.firstContact(c, angle);
      this.ghost.visible = !!hit;
      if (hit) this.ghost.position.set(hit.x, R, hit.z);
      const down = this.input.down || this.input.gpButton(0) || this.input.key('Space');
      if (down) { this.charging = true; this.charge = Math.min(1, this.charge + dt / 1.5); }
      else if (this.charging) { this.shoot(angle, this.charge); this.charge = 0; this.charging = false; }
    } else {
      this.line.visible = false;
      this.ghost.visible = false;
      const potted = stepBalls(this.balls, dt);
      for (const b of potted) this.onPot(b);
      this.balls.forEach((b, i) => { this.meshes[i].visible = b.alive; this.meshes[i].position.set(b.x, R, b.z); });
      if (!anyMoving(this.balls)) {
        this.settle += dt;
        if (this.settle > 0.5) {
          if (!this.cue().alive) this.respotCue();
          const left = this.balls.slice(1).filter((b) => b.alive).length;
          if (!left) return this.finish(true);
          if (this.shots <= 0) return this.finish(false);
          this.phase = 'aim';
        }
      } else this.settle = 0;
    }
    this.hud.stat('Shots left', this.shots);
    this.hud.stat('Potted', `${this.potted}/10`);
    this.hud.stat('Score', this.score);
    this.hud.stat('Power', this.charging ? '▮'.repeat(Math.round(this.charge * 12)) : '—');
  }

  /** Where the cue ball would stop on first touching another ball along `angle` (or null). */
  firstContact(c, angle) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let best = null;
    let bestT = Infinity;
    for (const b of this.balls.slice(1)) {
      if (!b.alive) continue;
      const ox = b.x - c.x;
      const oz = b.z - c.z;
      const along = ox * dx + oz * dz;
      if (along <= 0) continue;
      const perp2 = ox * ox + oz * oz - along * along;
      if (perp2 > (2 * R) ** 2) continue;
      const t = along - Math.sqrt((2 * R) ** 2 - perp2);
      if (t < bestT) { bestT = t; best = { x: c.x + dx * t, z: c.z + dz * t }; }
    }
    return best;
  }

  onPot(b) {
    const idx = this.balls.indexOf(b);
    this.burst.burst(new THREE.Vector3(b.x, 0.5, b.z), PALETTE.amber, 8, 5);
    if (idx === 0) {
      this.scratches++;
      this.score = Math.max(0, this.score - 10);
      this.hud.toast('SCRATCH −10', 900);
      this.audio.bad();
    } else {
      this.potted++;
      this.score += 20;
      this.hud.toast('POTTED +20', 700);
      this.audio.good();
    }
  }

  respotCue() {
    const c = this.cue();
    let x = -6;
    while (this.balls.slice(1).some((b) => b.alive && Math.hypot(b.x - x, b.z) < R * 2.2)) x -= 0.6;
    Object.assign(c, { x, z: 0, vx: 0, vz: 0, alive: true });
    this.meshes[0].visible = true;
    this.meshes[0].position.set(c.x, R, c.z);
  }

  finish(cleared) {
    const bonus = cleared ? this.shots * 10 : 0;
    this.score += bonus;
    this.audio[cleared ? 'win' : 'lose']();
    this.end(this.score, cleared ? `Table cleared with ${this.shots} shot${this.shots === 1 ? '' : 's'} to spare — ${this.score} points!` : `${this.potted} of 10 balls potted — ${this.score} points.`);
  }
}
