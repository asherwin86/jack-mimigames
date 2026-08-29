import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  torus, box, lights, sky, glow, starfield, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const SPAWN_Z = -190;

export default class SkyHoops extends Game {
  start() {
    sky(this.scene, '#122f5e', '#04070f', 60, 220);
    lights(this.scene, { sky: 0x8fd0ff, groundCol: 0x0d1c34 });
    starfield(this.scene, 500, 300);

    // Glider: a simple swept wing built from boxes.
    this.ship = new THREE.Group();
    const body = box(0.5, 0.35, 2.4, glow(PALETTE.white, { emissiveIntensity: 0.25 }));
    const wing = box(4.2, 0.12, 0.9, glow(PALETTE.cyan, { emissiveIntensity: 0.5 }));
    wing.position.z = 0.15;
    const fin = box(0.12, 0.8, 0.7, glow(PALETTE.pink));
    fin.position.set(0, 0.45, 0.9);
    this.ship.add(body, wing, fin);
    this.ship.position.set(0, 8, 0);
    this.add(this.ship);

    // Ring pool
    this.rings = [];
    for (let i = 0; i < 14; i++) {
      const r = torus(3.2, 0.28, PALETTE.amber, { cast: false, receive: false });
      r.material = glow(PALETTE.amber, { emissiveIntensity: 0.9 });
      r.visible = false;
      r.position.z = 999;
      this.rings.push(this.add(r));
    }
    this.pool = [...this.rings];
    this.live = [];

    // Drifting scenery pylons for depth cues.
    this.pylons = [];
    for (let i = 0; i < 26; i++) {
      const p = box(rand(1, 2.5), rand(14, 42), rand(1, 2.5), 0x1b2647, { cast: false });
      p.position.set(rand(-70, 70), rand(-16, -4), -rand(0, 220));
      this.pylons.push(this.add(p));
    }

    this.burst = new Burst(this.scene, 70, 0.22);

    this.vel = new THREE.Vector2(0, 0);
    this.speed = 46;
    this.timeLeft = 20;
    this.rings_hit = 0;
    this.nextSpawn = 0;
    this.lastRingX = 0;
    this.lastRingY = 8;

    this.camera.position.set(0, 9, 12);
    this.hud.hint('Move the mouse to steer · every ring buys you 2 more seconds');
  }

  spawnRing() {
    const r = this.pool.pop();
    if (!r) return;
    // Keep consecutive rings reachable at the current speed.
    const spread = clamp(6 + this.rings_hit * 0.55, 6, 22);
    r.position.set(
      clamp(this.lastRingX + rand(-spread, spread), -34, 34),
      clamp(this.lastRingY + rand(-spread * 0.6, spread * 0.6), 3.5, 26),
      SPAWN_Z,
    );
    this.lastRingX = r.position.x;
    this.lastRingY = r.position.y;
    r.rotation.z = rand(0, Math.PI);
    r.material.color.set(PALETTE.amber);
    r.material.emissive.set(PALETTE.amber);
    r.visible = true;
    r.userData.passed = false;
    this.live.push(r);
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();

    this.speed = 46 + Math.min(34, this.rings_hit * 0.9);

    // Mouse position drives a target point; the ship eases toward it.
    const tx = this.input.pointer.x * 34;
    const ty = clamp(10 + this.input.pointer.y * 12, 2.5, 27);
    const px = this.ship.position.x;
    const py = this.ship.position.y;
    this.ship.position.x = damp(px, tx, 4.5, dt);
    this.ship.position.y = damp(py, ty, 4.5, dt);
    this.vel.set((this.ship.position.x - px) / Math.max(dt, 1e-4), (this.ship.position.y - py) / Math.max(dt, 1e-4));
    this.ship.rotation.z = damp(this.ship.rotation.z, clamp(-this.vel.x * 0.035, -1.1, 1.1), 8, dt);
    this.ship.rotation.x = damp(this.ship.rotation.x, clamp(-this.vel.y * 0.02, -0.5, 0.5), 8, dt);

    const dz = this.speed * dt;

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawnRing();
      this.nextSpawn = clamp(58 / this.speed, 0.5, 1.4);
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const r = this.live[i];
      r.position.z += dz;
      r.rotation.z += dt * 0.5;

      if (!r.userData.passed && r.position.z > this.ship.position.z - 0.6) {
        r.userData.passed = true;
        const dx = r.position.x - this.ship.position.x;
        const dy = r.position.y - this.ship.position.y;
        if (Math.hypot(dx, dy) < 3.1) this.scoreRing(r);
        else {
          r.material.color.set(PALETTE.red);
          r.material.emissive.set(PALETTE.red);
          this.audio.tone([160, 90], 0.18, { type: 'sawtooth', gain: 0.1 });
        }
      }

      if (r.position.z > 16) {
        r.visible = false;
        this.live.splice(i, 1);
        this.pool.push(r);
      }
    }

    for (const p of this.pylons) {
      p.position.z += dz;
      if (p.position.z > 20) {
        p.position.z -= 240;
        p.position.x = rand(-70, 70);
      }
    }

    this.burst.update(dt);

    this.camera.position.x = damp(this.camera.position.x, this.ship.position.x * 0.75, 4, dt);
    this.camera.position.y = damp(this.camera.position.y, this.ship.position.y + 1.6, 4, dt);
    this.camera.position.z = damp(this.camera.position.z, 11, 3, dt);
    this.camera.lookAt(this.ship.position.x, this.ship.position.y, this.ship.position.z - 22);

    this.hud.stat('Rings', this.rings_hit);
    this.hud.stat('Time', this.timeLeft.toFixed(1), this.timeLeft < 5);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
  }

  scoreRing(r) {
    this.rings_hit++;
    this.timeLeft = Math.min(this.timeLeft + 2, 30);
    r.material.color.set(PALETTE.lime);
    r.material.emissive.set(PALETTE.lime);
    this.burst.burst(r.position, PALETTE.lime, 12, 6);
    this.audio.pickup();
    if (this.rings_hit % 10 === 0) {
      this.hud.toast(`${this.rings_hit} rings!`);
      this.audio.good();
    }
  }

  finish() {
    this.audio.lose();
    this.end(this.rings_hit, `You threaded ${this.rings_hit} ring${this.rings_hit === 1 ? '' : 's'}.`);
  }
}
