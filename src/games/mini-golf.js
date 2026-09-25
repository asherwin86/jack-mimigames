import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, PALETTE,
} from '../engine/utils.js';

const R = 0.4;
const MAX_STROKES = 7;
const CUP_R = 0.62;
// Each hole: the green's half-size, tee, cup, and inner walls [x, z, w, d]
const HOLES = [
  { hw: 10, hd: 4.5, par: 2, tee: [-8, 0], cup: [8, 0], walls: [] },
  { hw: 10, hd: 6.5, par: 3, tee: [-8, 4], cup: [8, -4], walls: [[0, -1.5, 1, 9]] },
  { hw: 11, hd: 6, par: 4, tee: [-9.5, 0], cup: [9.5, 0], walls: [[-3.2, -2.6, 1, 6.4], [3.2, 2.6, 1, 6.4]] },
];

export default class MiniGolf extends Game {
  start() {
    sky(this.scene, '#5fb0e8', '#dff3ff', 60, 160);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    this.add(ground(120, 0x3f7a3a));

    this.course = this.add(new THREE.Group());
    this.ball = this.add(ball(R, glow(0xffffff, { emissiveIntensity: 0.3 })));
    this.aimLine = this.add(box(0.12, 0.05, 1, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false, receive: false }));
    this.aimLine.visible = false;
    this.cupMesh = this.add(cyl(CUP_R, CUP_R, 0.06, mat(0x0a0a0a), { cast: false }));
    this.flag = this.add(cyl(0.04, 0.04, 3, mat(0xeeeeee)));
    const cloth = box(1.2, 0.7, 0.05, glow(PALETTE.red, { emissiveIntensity: 0.5 }), { cast: false });
    cloth.position.set(0.6, 1.1, 0);
    this.flag.add(cloth);

    this.burst = new Burst(this.scene, 60, 0.2);
    this.hole = -1;
    this.total = 0;
    this.strokes = 0;
    this.results = [];
    this.vel = new THREE.Vector2();
    this.aiming = false;
    this.heldBefore = false;
    this.sunk = 0;
    this.showCursor = true;
    this.nextHole();

    this.camera.position.set(0, 24, 11);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('Hold the button, pull back from the ball and let go to putt (further = harder) · sink it in as few strokes as you can');
  }

  nextHole() {
    this.hole++;
    if (this.hole >= HOLES.length) return this.finish();
    const h = HOLES[this.hole];
    this.cfg = h;
    this.strokes = 0;
    this.course.clear();
    const felt = box(h.hw * 2, 0.4, h.hd * 2, mat(0x2fa44a, { roughness: 0.95 }), { cast: false });
    felt.position.y = -0.2;
    this.course.add(felt);
    const wallMat = mat(0x7a4a26, { roughness: 0.7 });
    const outer = [[0, -h.hd - 0.4, h.hw * 2 + 1.6, 0.8], [0, h.hd + 0.4, h.hw * 2 + 1.6, 0.8], [-h.hw - 0.4, 0, 0.8, h.hd * 2], [h.hw + 0.4, 0, 0.8, h.hd * 2]];
    this.walls = [];
    for (const [x, z, w, d] of [...outer, ...h.walls]) {
      const m = box(w, 0.9, d, wallMat);
      m.position.set(x, 0.45, z);
      this.course.add(m);
      this.walls.push({ x, z, hw: w / 2, hd: d / 2 });
    }
    this.pos = new THREE.Vector2(h.tee[0], h.tee[1]);
    this.vel.set(0, 0);
    this.cupMesh.position.set(h.cup[0], 0.02, h.cup[1]);
    this.flag.position.set(h.cup[0], 1.5, h.cup[1]);
    this.sunk = 0;
    this.ball.visible = true;
    this.ball.scale.setScalar(1);
    this.hud.toast(`Hole ${this.hole + 1} · par ${h.par}`, 1100);
  }

  moving() { return this.vel.length() > 0.15; }

  update(dt) {
    if (this.sunk > 0) {   // dropping into the cup, then on to the next hole
      this.sunk -= dt;
      this.ball.scale.setScalar(Math.max(0.05, this.sunk / 0.6));
      if (this.sunk <= 0) this.nextHole();
      this.burst.update(dt);
      return;
    }

    // Aiming: hold, drag back, release.
    const held = this.input.down || this.input.gpButton(0);
    const ground = this.groundPoint(0.1);
    if (!this.moving()) {
      if (held && !this.heldBefore) this.aiming = true;
      if (this.aiming && ground) {
        const dx = this.pos.x - ground.x;
        const dz = this.pos.y - ground.z;
        const pull = clamp(Math.hypot(dx, dz), 0, 6);
        this.aimLine.visible = pull > 0.3;
        this.aimLine.scale.z = Math.max(0.01, pull);
        this.aimLine.position.set(this.pos.x + (dx / (pull || 1)) * pull * 0.5, 0.15, this.pos.y + (dz / (pull || 1)) * pull * 0.5);
        this.aimLine.rotation.y = Math.atan2(dx, dz);
        this.aimVec = { x: dx / (pull || 1), z: dz / (pull || 1), power: pull / 6 };
        if (!held && this.heldBefore) this.putt();
      }
      if (!held) this.aiming = false;
      // Too many strokes: the hole is given up so the round always ends.
      if (this.strokes >= MAX_STROKES && !this.moving()) {
        this.results.push(MAX_STROKES);
        this.hud.toast('MAX STROKES · next hole', 900);
        this.nextHole();
        this.heldBefore = held;
        return;
      }
    } else { this.aiming = false; this.aimLine.visible = false; }
    this.heldBefore = held;

    if (this.moving()) this.stepBall(dt);
    this.ball.position.set(this.pos.x, R, this.pos.y);
    this.burst.update(dt);
    this.hud.stat('Hole', `${Math.min(this.hole + 1, HOLES.length)}/${HOLES.length}`);
    this.hud.stat('Strokes', this.strokes);
    this.hud.stat('Par', this.cfg?.par ?? '—');
    this.hud.stat('Total', this.total);
  }

  putt() {
    this.aiming = false;
    this.aimLine.visible = false;
    if (!this.aimVec || this.aimVec.power < 0.06) return;
    this.strokes++;
    this.total++;
    const speed = 4 + this.aimVec.power * 26;
    this.vel.set(this.aimVec.x * speed, this.aimVec.z * speed);
    this.audio.tone([500, 300], 0.07, { type: 'triangle', gain: 0.1 });
  }

  stepBall(dt) {
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * dt / steps;
      this.pos.y += this.vel.y * dt / steps;
      for (const w of this.walls) {
        const cx = clamp(this.pos.x, w.x - w.hw, w.x + w.hw);
        const cz = clamp(this.pos.y, w.z - w.hd, w.z + w.hd);
        const dx = this.pos.x - cx;
        const dz = this.pos.y - cz;
        const d = Math.hypot(dx, dz);
        if (d < R) {
          let nx = dx; let nz = dz;
          if (d < 1e-5) { nx = this.pos.x - w.x; nz = this.pos.y - w.z; }
          const nl = Math.hypot(nx, nz) || 1;
          nx /= nl; nz /= nl;
          this.pos.x = cx + nx * (R + 0.001);
          this.pos.y = cz + nz * (R + 0.001);
          const vn = this.vel.x * nx + this.vel.y * nz;
          if (vn < 0) { this.vel.x -= 1.85 * vn * nx; this.vel.y -= 1.85 * vn * nz; this.audio.tone(260, 0.03, { gain: 0.06 }); }
        }
      }
      // the cup
      const cd = Math.hypot(this.pos.x - this.cfg.cup[0], this.pos.y - this.cfg.cup[1]);
      if (cd < CUP_R && this.vel.length() < 11) { this.holed(); return; }
    }
    this.vel.multiplyScalar(Math.exp(-0.95 * dt));
    if (this.vel.length() < 0.15) this.vel.set(0, 0);
  }

  holed() {
    this.vel.set(0, 0);
    this.pos.set(this.cfg.cup[0], this.cfg.cup[1]);
    this.sunk = 0.6;
    this.burst.burst(new THREE.Vector3(this.cfg.cup[0], 0.5, this.cfg.cup[1]), PALETTE.lime, 18, 7);
    const diff = this.strokes - this.cfg.par;
    this.results.push(this.strokes);
    this.hud.toast(this.strokes === 1 ? 'HOLE IN ONE!' : diff < 0 ? `${-diff} UNDER PAR` : diff === 0 ? 'PAR' : `${diff} OVER`, 1100);
    this.audio.win();
  }

  finish() {
    this.audio.win();
    this.end(this.total, `${this.total} strokes over ${HOLES.length} holes (par ${HOLES.reduce((a, h) => a + h.par, 0)}).`);
  }
}
