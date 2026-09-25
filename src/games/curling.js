import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, PALETTE,
} from '../engine/utils.js';

const STONES = 6;
const R = 0.45;
const START = new THREE.Vector3(0, 0, 8);
const HOUSE_Z = -30;
const HALF_W = 4;
const BACK_Z = -37;
const HOG_Z = -6;   // a stone that stops short of this line is removed
const RINGS = [[0.5, 10], [1.2, 6], [2.1, 3], [3.0, 1]];
const MU = 0.9;
const MU_SWEPT = 0.6;

/** Points for a stone resting at (x, z). */
export function pointsFor(x, z) {
  const d = Math.hypot(x, z - HOUSE_Z);
  for (const [r, p] of RINGS) if (d <= r) return p;
  return 0;
}

/** One physics step for a set of stones {x, z, vx, vz}: friction, curl, then stone-on-stone collisions. Returns nothing. */
export function stepStones(stones, dt, sweeping = null) {
  for (const s of stones) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp < 0.001) { s.vx = s.vz = 0; continue; }
    const swept = sweeping === s;
    const mu = swept ? MU_SWEPT : MU;
    const ns = Math.max(0, sp - mu * dt);
    s.vx *= ns / sp;
    s.vz *= ns / sp;
    // curl grows as the stone slows down, and sweeping straightens the path
    if (s.curl) s.vx += s.curl * (swept ? 0.25 : 1) * (1.1 - Math.min(1, sp / 8)) * 0.14 * dt;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
  }
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i];
      const b = stones[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= R * 2 || d < 1e-6) continue;
      const nx = dx / d;
      const nz = dz / d;
      const overlap = R * 2 - d;
      a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
      b.x += nx * overlap / 2; b.z += nz * overlap / 2;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;   // negative while they are closing
      if (rel < 0) {
        const imp = (-(1 + 0.9) * rel) / 2;
        a.vx -= imp * nx; a.vz -= imp * nz;
        b.vx += imp * nx; b.vz += imp * nz;
      }
      a.curl = b.curl = 0;   // a stone that has been hit no longer curls
    }
  }
}

export default class Curling extends Game {
  start() {
    sky(this.scene, '#a8d0f0', '#e8f4ff', 80, 260);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x8ab0d0, intensity: 1.1 });
    this.add(ground(300, 0xdff0fb));
    const sheet = box(HALF_W * 2 + 1, 0.1, 60, mat(0xf6fcff, { roughness: 0.15 }));
    sheet.position.set(0, 0.02, -16);
    this.add(sheet);
    for (const s of [-1, 1]) {
      const rail = box(0.3, 0.5, 60, mat(0x3a4a70), { cast: false });
      rail.position.set(s * (HALF_W + 0.6), 0.25, -16);
      this.add(rail);
    }
    // The house
    const cols = [0x2a6fe0, 0xffffff, 0xd83a4a, 0xffffff];
    [3.0, 2.1, 1.2, 0.5].forEach((r, i) => {
      const d = cyl(r, r, 0.06, mat(cols[i], { roughness: 0.3 }), { cast: false });
      d.position.set(0, 0.11 + i * 0.01, HOUSE_Z);
      this.add(d);
    });

    this.stones = [];
    this.meshes = [];
    this.burst = new Burst(this.scene, 50, 0.2);
    this.thrown = 0;
    this.active = null;
    this.charge = 0;
    this.charging = false;
    this.curlDir = 1;
    this.aimX = 0;
    this.phase = 'aim';
    this.settle = 0;
    this.showCursor = true;
    this.arrow = this.add(new THREE.Mesh(new THREE.PlaneGeometry(0.3, 12), new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.5 })));
    this.arrow.rotation.x = -Math.PI / 2;
    this.camera.position.set(0, 7, 15);
    this.camera.lookAt(0, 0, -6);
    this.hud.hint('Move the mouse to aim · hold click to build power, release to throw (about 2 thirds power reaches the house) · hold Space or right-click to sweep and keep the stone straight and fast · C flips the curl');
  }

  /** Throws a stone now. `power` 0..1, `aimX` is the lateral point on the ice at the house. */
  throwStone(power, aimX = this.aimX) {
    if (this.phase !== 'aim' || this.thrown >= STONES) return false;
    const angle = Math.atan2(aimX, START.z - HOUSE_Z);
    const v = 4.5 + clamp(power, 0, 1) * 5.5;
    const st = { x: START.x, z: START.z, vx: Math.sin(angle) * v, vz: -Math.cos(angle) * v, curl: this.curlDir * 1.0, out: false };
    const m = cyl(R, R, 0.3, mat(this.thrown % 2 ? 0xd83a4a : 0xe8c02a, { roughness: 0.3 }));
    const cap = cyl(R * 0.5, R * 0.5, 0.12, mat(0x333333), { cast: false });
    cap.position.y = 0.2;
    m.add(cap);
    m.position.set(st.x, 0.25, st.z);
    this.add(m);
    this.stones.push(st);
    this.meshes.push(m);
    this.active = st;
    this.thrown++;
    this.phase = 'slide';
    this.settle = 0;
    this.audio.thud();
    return true;
  }

  score() { return this.stones.reduce((a, s) => a + (s.out ? 0 : pointsFor(s.x, s.z)), 0); }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    if (this.input.hit('KeyC') || this.input.gpHit(2)) { this.curlDir *= -1; this.hud.toast(this.curlDir > 0 ? 'CURL → right' : 'CURL ← left', 600); }

    if (this.phase === 'aim') {
      const g = this.groundPoint(0);
      if (g && Math.abs(g.z - START.z) > 0.5) this.aimX = clamp(g.x * ((HOUSE_Z - START.z) / (g.z - START.z)), -3.5, 3.5);
      const kx = this.input.axisX();
      if (kx) this.aimX = clamp(this.aimX + kx * 5 * dt, -3.5, 3.5);
      const angle = Math.atan2(this.aimX, START.z - HOUSE_Z);
      this.arrow.position.set(Math.sin(angle) * 6, 0.16, START.z - Math.cos(angle) * 6);
      this.arrow.rotation.z = angle;
      this.arrow.visible = true;
      const down = this.input.down || this.input.gpButton(0);
      if (down) { this.charging = true; this.charge = Math.min(1, this.charge + dt / 1.6); }
      else if (this.charging) { this.throwStone(this.charge); this.charge = 0; this.charging = false; }
      this.camera.position.x = damp(this.camera.position.x, 0, 4, dt);
      this.camera.position.z = damp(this.camera.position.z, 15, 4, dt);
      this.camera.lookAt(0, 0, -6);
    } else {
      this.arrow.visible = false;
      const sweeping = this.input.key('Space') || this.input.button(2) || this.input.gpButton(1) ? this.active : null;
      stepStones(this.stones, dt, sweeping);
      this.stones.forEach((s, i) => {
        this.meshes[i].position.set(s.x, 0.25, s.z);
        if (!s.out && (Math.abs(s.x) > HALF_W || s.z < BACK_Z)) { s.out = true; this.meshes[i].visible = false; s.vx = s.vz = 0; }
      });
      const moving = this.stones.some((s) => !s.out && Math.hypot(s.vx, s.vz) > 0.08);
      // Camera follows the stone down the sheet.
      const zf = this.active ? this.active.z : -6;
      this.camera.position.z = damp(this.camera.position.z, clamp(zf + 12, -18, 15), 3, dt);
      this.camera.position.x = damp(this.camera.position.x, 0, 3, dt);
      this.camera.lookAt(0, 0, clamp(zf - 14, -32, -6));
      if (!moving) {
        this.settle += dt;
        if (this.settle > 0.6) {
          // a stone that never crossed the hog line is removed
          const st = this.active;
          if (st && !st.out && st.z > HOG_Z) { st.out = true; this.meshes[this.stones.indexOf(st)].visible = false; this.hud.toast('HOGGED — too short', 900); }
          this.phase = 'aim';
          if (this.thrown >= STONES) return this.finish();
        }
      } else this.settle = 0;
    }
    this.hud.stat('Stones', `${STONES - this.thrown} left`);
    this.hud.stat('Score', this.score());
    this.hud.stat('Power', this.charging ? '▮'.repeat(Math.round(this.charge * 12)) : '—');
    this.hud.stat('Curl', this.curlDir > 0 ? '↻ right' : '↺ left');
  }

  finish() {
    const score = this.score();
    this.audio[score >= 20 ? 'win' : 'lose']();
    this.end(score, `${this.stones.filter((s) => !s.out && pointsFor(s.x, s.z) > 0).length} stone(s) in the house for ${score} points.`);
  }
}
