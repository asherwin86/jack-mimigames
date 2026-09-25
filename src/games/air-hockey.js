import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HW = 6;              // table half-width (x)
const HL = 10;             // table half-length (z)
const GOAL_HALF = 2.6;
const PUCK_R = 0.6;
const MALLET_R = 0.95;
const MAX_SPEED = 30;
const AI_LIMIT = 5;

export default class AirHockey extends Game {
  start() {
    sky(this.scene, '#132a44', '#050a12', 50, 140);
    lights(this.scene, { sky: 0xbfe0ff, groundCol: 0x0e1c2c });

    const table = box(HW * 2 + 1, 0.6, HL * 2 + 1, mat(0x1a3a5c, { roughness: 0.3 }), { cast: false });
    table.position.y = -0.3;
    this.add(table);
    // Centre line, and the rails (with a gap at each goal).
    const line = box(HW * 2, 0.02, 0.15, glow(PALETTE.cyan, { emissiveIntensity: 0.5 }), { cast: false });
    line.position.y = 0.01;
    this.add(line);
    const rail = (w, d, x, z) => { const r = box(w, 0.9, d, mat(0x2d5f92)); r.position.set(x, 0.3, z); this.add(r); };
    rail(0.5, HL * 2 + 1, -HW - 0.25, 0);
    rail(0.5, HL * 2 + 1, HW + 0.25, 0);
    for (const z of [-HL - 0.25, HL + 0.25]) {
      const side = (HW - GOAL_HALF);
      rail(side, 0.5, -GOAL_HALF - side / 2, z);
      rail(side, 0.5, GOAL_HALF + side / 2, z);
      const goal = box(GOAL_HALF * 2, 0.05, 0.4, glow(z < 0 ? PALETTE.red : PALETTE.lime, { emissiveIntensity: 0.9 }), { cast: false });
      goal.position.set(0, 0.03, z);
      this.add(goal);
    }

    this.puck = this.add(cyl(PUCK_R, PUCK_R, 0.3, glow(PALETTE.white, { emissiveIntensity: 0.5 })));
    this.puck.position.y = 0.15;
    this.pv = new THREE.Vector3();
    this.me = this.add(cyl(MALLET_R, MALLET_R * 0.9, 0.7, glow(PALETTE.lime, { emissiveIntensity: 0.4 })));
    this.me.position.set(0, 0.35, HL - 3);
    this.meV = new THREE.Vector3();
    this.ai = this.add(cyl(MALLET_R, MALLET_R * 0.9, 0.7, glow(PALETTE.red, { emissiveIntensity: 0.4 })));
    this.ai.position.set(0, 0.35, -HL + 3);
    this.aiV = new THREE.Vector3();

    this.burst = new Burst(this.scene, 70, 0.2);
    this.goals = 0;
    this.conceded = 0;
    this.wait = 0.9;
    this.showCursor = true;
    this.serve(1);

    this.camera.position.set(0, 21, 15);
    this.camera.lookAt(0, 0, 1.5);
    this.hud.hint('Move the mouse (or the stick) to slide your mallet · hit the puck into the red goal · 5 conceded and you are out');
  }

  serve(towards) {
    this.puck.position.set(0, 0.15, 0);
    this.pv.set(0, 0, 0);
    this.wait = 0.9;
    this.serveDir = towards;
  }

  update(dt) {
    // The player's mallet goes where the pointer does, kept to its own half.
    const prev = this.me.position.clone();
    const g = this.groundPoint(0);
    if (g) {
      const tx = clamp(g.x, -HW + MALLET_R, HW - MALLET_R);
      const tz = clamp(g.z, 0.6 + MALLET_R, HL - MALLET_R);
      this.me.position.x = damp(this.me.position.x, tx, 28, dt);
      this.me.position.z = damp(this.me.position.z, tz, 28, dt);
    }
    // Stick / keys also work, for a controller with no cursor moving.
    const kx = this.input.axisX();
    const kz = -this.input.axisY();
    if (kx || kz) {
      this.me.position.x = clamp(this.me.position.x + kx * 14 * dt, -HW + MALLET_R, HW - MALLET_R);
      this.me.position.z = clamp(this.me.position.z + kz * 14 * dt, 0.6 + MALLET_R, HL - MALLET_R);
    }
    this.meV.set((this.me.position.x - prev.x) / dt, 0, (this.me.position.z - prev.z) / dt);

    this.moveAi(dt);

    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.pv.set(rand(-2, 2), 0, this.serveDir * 8);
    } else {
      this.stepPuck(dt);
    }

    this.burst.update(dt);
    this.hud.stat('Goals', this.goals);
    this.hud.stat('Conceded', `${this.conceded}/${AI_LIMIT}`, this.conceded >= AI_LIMIT - 1);
    this.hud.stat('Puck', `${this.pv.length().toFixed(0)}`);
  }

  moveAi(dt) {
    const prev = this.ai.position.clone();
    const skill = clamp(0.55 + this.goals * 0.06, 0.55, 1);
    const puck = this.puck.position;
    let tx = 0;
    let tz = -HL + 2.6;
    if (puck.z < 1.5 && this.pv.z < 3) { tx = puck.x; tz = puck.z - 1.1; }          // go and hit it
    else if (this.pv.z < 0) { tx = puck.x; tz = -HL + 2.4; }                          // guard the goal
    else { tx = puck.x * 0.5; }
    tx = clamp(tx, -HW + MALLET_R, HW - MALLET_R);
    tz = clamp(tz, -HL + MALLET_R, -0.6 - MALLET_R);
    const speed = 9 + 12 * skill;
    const dx = tx - this.ai.position.x;
    const dz = tz - this.ai.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const step = Math.min(d, speed * dt);
    this.ai.position.x += (dx / d) * step;
    this.ai.position.z += (dz / d) * step;
    this.aiV.set((this.ai.position.x - prev.x) / dt, 0, (this.ai.position.z - prev.z) / dt);
  }

  stepPuck(dt) {
    const p = this.puck.position;
    // sub-steps so a fast puck doesn't tunnel through a mallet
    const n = Math.max(1, Math.ceil(this.pv.length() * dt / 0.4));
    for (let i = 0; i < n; i++) {
      p.x += this.pv.x * dt / n;
      p.z += this.pv.z * dt / n;
      this.hitMallet(this.me, this.meV);
      this.hitMallet(this.ai, this.aiV);
      // Side walls
      if (p.x < -HW + PUCK_R) { p.x = -HW + PUCK_R; this.pv.x = Math.abs(this.pv.x); this.audio.tone(300, 0.03, { gain: 0.05 }); }
      if (p.x > HW - PUCK_R) { p.x = HW - PUCK_R; this.pv.x = -Math.abs(this.pv.x); this.audio.tone(300, 0.03, { gain: 0.05 }); }
      // Ends: a goal in the gap, otherwise a bounce
      for (const end of [-1, 1]) {
        const wall = end * HL;
        if ((end < 0 && p.z < wall + PUCK_R) || (end > 0 && p.z > wall - PUCK_R)) {
          if (Math.abs(p.x) < GOAL_HALF - PUCK_R * 0.3) {
            if ((end < 0 && p.z < wall - 0.2) || (end > 0 && p.z > wall + 0.2)) { this.scoreGoal(end < 0); return; }
          } else {
            p.z = wall - end * PUCK_R;
            this.pv.z = -end * Math.abs(this.pv.z);
            this.audio.tone(300, 0.03, { gain: 0.05 });
          }
        }
      }
    }
    const speed = this.pv.length();
    if (speed > MAX_SPEED) this.pv.multiplyScalar(MAX_SPEED / speed);
    this.pv.multiplyScalar(Math.exp(-0.25 * dt));
  }

  hitMallet(mallet, mv) {
    const p = this.puck.position;
    const dx = p.x - mallet.position.x;
    const dz = p.z - mallet.position.z;
    const d = Math.hypot(dx, dz);
    const min = PUCK_R + MALLET_R;
    if (d >= min || d < 1e-6) return;
    const nx = dx / d;
    const nz = dz / d;
    p.x = mallet.position.x + nx * min;
    p.z = mallet.position.z + nz * min;
    // reflect the puck off the mallet, then add the mallet's own push
    const vn = this.pv.x * nx + this.pv.z * nz;
    if (vn < 0) { this.pv.x -= 2 * vn * nx; this.pv.z -= 2 * vn * nz; }
    this.pv.x += mv.x * 0.9;
    this.pv.z += mv.z * 0.9;
    const sp = this.pv.length();
    if (sp < 6) this.pv.multiplyScalar(6 / Math.max(sp, 0.1));
    this.burst.burst(p, PALETTE.white, 5, 5);
    this.audio.thud();
  }

  scoreGoal(byPlayer) {
    if (byPlayer) {
      this.goals++;
      this.audio.win();
      this.hud.toast(`GOAL! ${this.goals}`, 900);
      this.burst.burst({ x: this.puck.position.x, y: 0.5, z: -HL }, PALETTE.lime, 24, 9);
    } else {
      this.conceded++;
      this.audio.bad();
      this.hud.toast('THEY SCORED', 900);
      this.burst.burst({ x: this.puck.position.x, y: 0.5, z: HL }, PALETTE.red, 24, 9);
    }
    if (this.conceded >= AI_LIMIT) {
      this.audio.lose();
      this.end(this.goals, `${this.goals} goal${this.goals === 1 ? '' : 's'} before conceding ${AI_LIMIT}.`);
      return;
    }
    this.serve(byPlayer ? 1 : -1);
  }
}
