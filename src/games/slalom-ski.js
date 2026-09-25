import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HALF = 9;             // slope half-width
const SPAWN_Z = -150;
const START_TIME = 40;
const GATE_BONUS = 2.5;
const GATE_HALF = 2.6;

export default class SlalomSki extends Game {
  start() {
    sky(this.scene, '#79b7f0', '#eaf6ff', 40, 170);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x9fb8d0, intensity: 1.1 });
    const snow = this.add(ground(500, 0xf4f8ff));
    snow.position.z = -120;

    this.skier = this.add(new THREE.Group());
    const body = box(0.7, 1.4, 0.5, glow(PALETTE.red, { emissiveIntensity: 0.3 }));
    body.position.y = 0.9;
    const head = box(0.5, 0.5, 0.5, mat(0xffd9b0));
    head.position.y = 1.85;
    const skis = box(0.35, 0.08, 2.0, mat(0x2a2f44));
    skis.position.set(0, 0.06, 0.1);
    this.skier.add(body, head, skis);
    this.skierX = 0;

    this.gates = [];
    this.trees = [];
    this.burst = new Burst(this.scene, 70, 0.2);
    this.speed = 22;
    this.timeLeft = START_TIME;
    this.passed = 0;
    this.missed = 0;
    this.nextGate = 0;
    this.nextTree = 0;
    this.distance = 0;
    this.stun = 0;

    this.camera.position.set(0, 4.5, 9);
    this.camera.lookAt(0, 1.5, -10);
    this.hud.hint('A / D or ← → to carve left and right · ski between the poles for time · trees slow you down');
  }

  spawnGate() {
    const cx = rand(-HALF + GATE_HALF + 1, HALF - GATE_HALF - 1);
    const colour = this.gates.length % 2 === 0 ? PALETTE.red : PALETTE.cyan;
    const poles = [-1, 1].map((s) => {
      const pole = cyl(0.14, 0.14, 3.4, glow(colour, { emissiveIntensity: 0.6 }));
      pole.position.set(cx + s * GATE_HALF, 1.7, SPAWN_Z);
      return this.add(pole);
    });
    this.gates.push({ cx, poles, z: SPAWN_Z, judged: false });
  }

  spawnTree(gateFree) {
    const x = rand(-HALF - 6, HALF + 6);
    if (gateFree && Math.abs(x - gateFree) < GATE_HALF + 1.2) return;
    const g = new THREE.Group();
    const trunk = cyl(0.2, 0.28, 0.9, mat(0x5a3a1c));
    trunk.position.y = 0.45;
    const cone = cyl(0.01, 1.2, 2.6, mat(0x1f6b3a));
    cone.position.y = 2.1;
    g.add(trunk, cone);
    g.position.set(x, 0, SPAWN_Z);
    g.userData = { x, z: SPAWN_Z };
    this.trees.push(this.add(g));
  }

  update(dt) {
    this.timeLeft -= dt;
    this.stun = Math.max(0, this.stun - dt);
    if (this.timeLeft <= 0) return this.finish();

    const dir = this.input.axisX();
    const grip = this.stun > 0 ? 0.35 : 1;
    this.skierX = clamp(this.skierX + dir * 15 * grip * dt, -HALF - 3, HALF + 3);
    this.skier.position.x = damp(this.skier.position.x, this.skierX, 16, dt);
    this.skier.rotation.z = damp(this.skier.rotation.z, -dir * 0.35, 9, dt);
    this.skier.rotation.y = damp(this.skier.rotation.y, -dir * 0.3, 9, dt);

    const target = 22 + Math.min(20, this.distance / 90);
    this.speed = damp(this.speed, this.stun > 0 ? target * 0.45 : target, 3, dt);
    const dz = this.speed * dt;
    this.distance += dz;

    this.nextGate -= dt;
    if (this.nextGate <= 0) {
      this.spawnGate();
      this.nextGate = clamp(32 / this.speed, 0.9, 1.6);
    }
    this.nextTree -= dt;
    if (this.nextTree <= 0) {
      const g = this.gates[this.gates.length - 1];
      this.spawnTree(g && g.z < SPAWN_Z + 8 ? g.cx : null);
      this.spawnTree(g && g.z < SPAWN_Z + 8 ? g.cx : null);
      this.nextTree = 0.3;
    }

    for (let i = this.gates.length - 1; i >= 0; i--) {
      const g = this.gates[i];
      g.z += dz;
      for (const p of g.poles) p.position.z = g.z;
      if (!g.judged && g.z > this.skier.position.z) {
        g.judged = true;
        if (Math.abs(this.skier.position.x - g.cx) < GATE_HALF - 0.2) {
          this.passed++;
          this.timeLeft += GATE_BONUS;
          this.audio.blip(Math.min(18, this.passed));
          for (const p of g.poles) p.material.color.setHex(PALETTE.lime);
          if (this.passed % 10 === 0) { this.hud.toast(`${this.passed} gates!`, 800); this.audio.good(); }
        } else {
          this.missed++;
          this.timeLeft -= 2;
          this.audio.bad();
          this.hud.toast('MISSED · -2 s', 600);
        }
      }
      if (g.z > 14) {
        for (const p of g.poles) this.scene.remove(p);
        this.gates.splice(i, 1);
      }
    }
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const t = this.trees[i];
      t.userData.z += dz;
      t.position.z = t.userData.z;
      if (this.stun <= 0 && Math.abs(t.userData.z - this.skier.position.z) < 1.0 && Math.abs(t.userData.x - this.skier.position.x) < 1.1) {
        this.stun = 1.1;
        this.timeLeft -= 1.5;
        this.burst.burst(this.skier.position, PALETTE.white, 14, 7);
        this.audio.thud();
        this.hud.toast('TREE · -1.5 s', 600);
      }
      if (t.userData.z > 14) { this.scene.remove(t); this.trees.splice(i, 1); }
    }

    this.camera.position.x = damp(this.camera.position.x, this.skier.position.x * 0.5, 5, dt);
    this.camera.lookAt(this.skier.position.x * 0.4, 1.5, -10);
    this.burst.update(dt);
    this.hud.stat('Gates', this.passed);
    this.hud.stat('Time', this.timeLeft.toFixed(1), this.timeLeft < 8);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
  }

  finish() {
    this.audio.lose();
    this.end(this.passed, `${this.passed} gate${this.passed === 1 ? '' : 's'} cleared, ${this.missed} missed.`);
  }
}
