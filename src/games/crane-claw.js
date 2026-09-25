import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const HW = 7;               // bin half-width (x)
const HD = 4.5;             // bin half-depth (z)
const TOP = 9;              // claw rail height
const FLOOR = 0.6;          // where the claw reaches down to
const CHUTE = { x: -HW + 1.4, z: HD - 1.4 };
const ATTEMPTS = 8;
const KINDS = [
  { r: 0.55, value: 10, colour: PALETTE.cyan },
  { r: 0.8, value: 25, colour: PALETTE.pink },
  { r: 1.05, value: 60, colour: PALETTE.amber },
];

export default class CraneClaw extends Game {
  start() {
    sky(this.scene, '#3a1f5c', '#0b0614', 40, 120);
    lights(this.scene, { sky: 0xe0c8ff, groundCol: 0x1e1030 });
    this.add(ground(70, 0x150c24));

    // The cabinet: floor, glass corners and a chute
    const base = box(HW * 2 + 1.5, 0.6, HD * 2 + 1.5, mat(0x3a2a66, { roughness: 0.5 }));
    base.position.y = -0.1;
    this.add(base);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = box(0.4, TOP + 2, 0.4, mat(0x6a55b0));
      post.position.set(x * (HW + 0.6), (TOP + 2) / 2, z * (HD + 0.6));
      this.add(post);
    }
    const rail = box(HW * 2 + 1.6, 0.4, HD * 2 + 1.6, mat(0x6a55b0), { cast: false });
    rail.position.y = TOP + 1.9;
    this.add(rail);
    const chute = box(2.6, 0.2, 2.6, glow(PALETTE.lime, { emissiveIntensity: 0.6 }), { cast: false });
    chute.position.set(CHUTE.x, 0.25, CHUTE.z);
    this.add(chute);

    // Prizes piled in the bin
    this.prizes = [];
    for (let i = 0; i < 24; i++) {
      const kind = KINDS[Math.random() < 0.55 ? 0 : Math.random() < 0.7 ? 1 : 2];
      const p = ball(kind.r, glow(kind.colour, { emissiveIntensity: 0.3 }), { seg: 12 });
      let x; let z;
      do { x = rand(-HW + 1, HW - 1); z = rand(-HD + 1, HD - 1); } while (Math.hypot(x - CHUTE.x, z - CHUTE.z) < 2.4);
      p.position.set(x, kind.r + rand(0, 0.5), z);
      p.userData = { kind, held: false, won: false };
      this.prizes.push(this.add(p));
    }

    this.claw = this.add(new THREE.Group());
    this.cable = box(0.08, 1, 0.08, mat(0xcfcfe0), { cast: false });
    this.hand = this.add(new THREE.Group());
    const palm = cyl(0.5, 0.5, 0.35, mat(0xdfe3f5));
    this.hand.add(palm);
    this.fingers = [0, 1, 2].map((i) => {
      const f = box(0.14, 0.9, 0.14, mat(0xdfe3f5));
      f.userData.angle = (i / 3) * Math.PI * 2;
      this.hand.add(f);
      return f;
    });
    this.add(this.cable);
    this.cx = 0; this.cz = 0; this.cy = TOP;
    this.state = 'move';
    this.stateT = 0;
    this.grip = 0;           // 0 = open, 1 = closed
    this.held = null;
    this.attempts = ATTEMPTS;
    this.score = 0;
    this.won = 0;
    this.burst = new Burst(this.scene, 60, 0.2);

    this.camera.position.set(0, 12, 17);
    this.camera.lookAt(0, 3.5, 0);
    this.hud.hint('WASD / stick to move the claw · Space or click to drop it · bring prizes to the green chute · 8 tries');
  }

  /** The prize the open claw would close on, and how far off-centre it is. */
  nearest() {
    let best = null; let bd = Infinity;
    for (const p of this.prizes) {
      if (p.userData.held || p.userData.won) continue;
      const d = Math.hypot(p.position.x - this.cx, p.position.z - this.cz);
      if (d < bd) { bd = d; best = p; }
    }
    return { prize: best, dist: bd };
  }

  update(dt) {
    if (this.state === 'move') {
      const dx = this.input.axisX();
      const dz = -this.input.axisY();
      this.cx = clamp(this.cx + dx * 6 * dt, -HW + 0.8, HW - 0.8);
      this.cz = clamp(this.cz + dz * 6 * dt, -HD + 0.8, HD - 0.8);
      if ((this.input.hit('Space', 'Enter') || this.input.clicked || this.input.gpHit(0)) && this.attempts > 0) {
        this.attempts--;
        this.state = 'down';
        this.audio.tone([500, 200], 0.15, { type: 'sawtooth', gain: 0.08 });
      }
    } else if (this.state === 'down') {
      this.cy = Math.max(FLOOR + 1.1, this.cy - 7 * dt);
      this.grip = Math.max(0, this.grip - dt * 3);
      if (this.cy <= FLOOR + 1.1) { this.state = 'grab'; this.stateT = 0.55; }
    } else if (this.state === 'grab') {
      this.stateT -= dt;
      this.grip = Math.min(1, this.grip + dt * 2.2);
      if (this.stateT <= 0) {
        const { prize, dist } = this.nearest();
        // Grip strength falls off with how far off-centre the claw is, and with how big the prize is.
        const reach = 0.5 + prize?.userData.kind.r * 0.55;
        if (prize && dist < reach + 0.3) {
          const chance = clamp(0.95 - (dist / (reach + 0.3)) * 0.55 - (prize.userData.kind.r - 0.55) * 0.2, 0.2, 0.95);
          if (Math.random() < chance) { this.held = prize; prize.userData.held = true; this.audio.good(); }
        }
        if (!this.held) this.audio.bad();
        this.state = 'up';
      }
    } else if (this.state === 'up') {
      this.cy = Math.min(TOP, this.cy + 6 * dt);
      if (this.cy >= TOP) this.state = 'carry';
    } else if (this.state === 'carry') {
      const dx = CHUTE.x - this.cx;
      const dz = CHUTE.z - this.cz;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 7 * dt);
      if (d > 0.05) { this.cx += (dx / d) * step; this.cz += (dz / d) * step; }
      // a weak grip can slip on the way
      if (this.held && Math.random() < 0.09 * dt * 6 * (this.held.userData.kind.r > 0.9 ? 1.6 : 1)) this.drop(false);
      if (d <= 0.05) { this.drop(true); }
    } else if (this.state === 'release') {
      this.stateT -= dt;
      this.grip = Math.max(0, this.grip - dt * 4);
      if (this.stateT <= 0) {
        if (this.attempts <= 0 && !this.held) return this.finish();
        this.state = 'move';
      }
    }

    // Pieces
    this.hand.position.set(this.cx, this.cy - 0.6, this.cz);
    this.cable.scale.y = TOP + 1.9 - this.cy;
    this.cable.position.set(this.cx, (TOP + 1.9 + this.cy) / 2, this.cz);
    for (const f of this.fingers) {
      const a = f.userData.angle;
      const r = 0.55 - this.grip * 0.32;
      f.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r);
      f.rotation.set(Math.sin(a) * this.grip * 0.4, 0, -Math.cos(a) * this.grip * 0.4);
    }
    if (this.held) this.held.position.set(this.cx, this.cy - 1.3 - this.held.userData.kind.r * 0.4, this.cz);

    // Prizes that were dropped fall back into the bin
    for (const p of this.prizes) {
      if (p.userData.held || p.userData.won) continue;
      const floorY = p.userData.kind.r;
      p.position.y = damp(p.position.y, Math.max(floorY, p.position.y > floorY + 0.05 ? p.position.y - 12 * dt : floorY), 30, dt);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Tries left', this.attempts);
    this.hud.stat('Prizes', this.won);
  }

  drop(atChute) {
    const p = this.held;
    this.held = null;
    this.state = 'release';
    this.stateT = 0.5;
    if (!p) return;
    p.userData.held = false;
    if (atChute) {
      p.userData.won = true;
      this.score += p.userData.kind.value;
      this.won++;
      this.burst.burst(p.position, p.userData.kind.colour, 20, 8);
      this.hud.toast(`WON +${p.userData.kind.value}`, 900);
      this.audio.win();
      p.visible = false;
    } else {
      this.hud.toast('DROPPED', 600);
      this.audio.bad();
    }
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.won} prize${this.won === 1 ? '' : 's'} won.`);
  }
}
