import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  ball, cyl, lights, sky, glow, mat, Burst, clamp, rand, chase, PALETTE,
} from '../engine/utils.js';

const R0 = 15;      // starting arena radius
const PUSH = 1.9;   // how hard a collision throws you

export default class SumoArena extends Game {
  start() {
    sky(this.scene, '#4a2438', '#0a0509', 30, 110);
    lights(this.scene, { sky: 0xffc0d8, groundCol: 0x2a1420 });

    this.radius = R0;
    this.disc = this.add(cyl(1, 1, 1, mat(0x2d1a26, { roughness: 0.9 }), { cast: false }));
    this.rim = this.add(cyl(1, 1, 1, glow(PALETTE.pink, { emissiveIntensity: 0.6 }), { cast: false }));
    this.sizeArena();

    this.player = this.add(ball(1, glow(PALETTE.cyan)));
    this.player.position.set(0, 1, 6);
    this.player.userData = { vel: new THREE.Vector3(), mass: 1.15 };

    this.foes = [];
    this.burst = new Burst(this.scene, 90, 0.24);
    this.pushed = 0;
    this.wave = 0;
    this.dashCharge = 1;
    this.nextWave = 0;

    this.camera.position.set(0, 22, 20);
    this.hud.hint('WASD to shove · Space to dash · last one standing wins the round');
  }

  sizeArena() {
    for (const d of [this.disc, this.rim]) d.scale.set(this.radius, 1, this.radius);
    this.disc.scale.y = 1; this.disc.position.y = -0.5;
    this.rim.scale.set(this.radius + 0.4, 1, this.radius + 0.4);
    this.rim.scale.y = 0.3; this.rim.position.y = -0.85;
  }

  spawnWave() {
    this.wave++;
    const n = Math.min(5, 1 + Math.floor(this.wave / 2));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const f = ball(0.95, glow(PALETTE.red, { emissiveIntensity: 0.55 }));
      f.position.set(Math.cos(a) * (this.radius - 2), 1, Math.sin(a) * (this.radius - 2));
      f.userData = { vel: new THREE.Vector3(), mass: 1, speed: 7 + this.wave * 0.7 };
      this.foes.push(this.add(f));
    }
    this.hud.toast(`Wave ${this.wave}`, 800);
    this.audio.tone([160, 320], 0.28, { type: 'sawtooth', gain: 0.1 });
  }

  update(dt) {
    if (!this.foes.length) {
      this.nextWave -= dt;
      if (this.nextWave <= 0) {
        this.spawnWave();
        this.radius = Math.max(7, this.radius - 0.8);
        this.sizeArena();
        this.nextWave = 2.2;
      }
    }

    const p = this.player;
    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq()) dir.normalize();

    this.dashCharge = Math.min(1, this.dashCharge + dt / 2.5);
    if (this.input.hit('Space') && this.dashCharge >= 1 && dir.lengthSq()) {
      this.dashCharge = 0;
      p.userData.vel.addScaledVector(dir, 17);
      this.burst.burst(p.position, PALETTE.cyan, 10, 5);
      this.audio.tone([620, 200], 0.14, { type: 'square', gain: 0.11 });
    }
    p.userData.vel.addScaledVector(dir, 26 * dt);

    // Foes home in on the player and try to shoulder-charge.
    for (const f of this.foes) {
      const to = p.position.clone().sub(f.position).setY(0);
      if (to.lengthSq() > 0.001) to.normalize();
      f.userData.vel.addScaledVector(to, f.userData.speed * dt * 4);
    }

    const all = [p, ...this.foes];
    for (const o of all) {
      o.userData.vel.multiplyScalar(Math.exp(-2.8 * dt));
      o.position.addScaledVector(o.userData.vel, dt);
      o.position.y = 1;
      o.rotation.x += o.userData.vel.z * dt * 0.6;
      o.rotation.z -= o.userData.vel.x * dt * 0.6;
    }

    // Elastic-ish shoves between every pair.
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) this.collide(all[i], all[j]);
    }

    // Anything past the rim falls out.
    for (let i = this.foes.length - 1; i >= 0; i--) {
      const f = this.foes[i];
      if (f.position.length() > this.radius + 0.6) this.eject(f, i);
    }
    if (p.position.length() > this.radius + 0.6) return this.lose();

    this.burst.update(dt);
    chase(this.camera, p, new THREE.Vector3(0, 20, 18), dt, 2.5, new THREE.Vector3(0, 0, 0));

    this.hud.stat('Pushed off', this.pushed);
    this.hud.stat('Wave', this.wave);
    this.hud.stat('Dash', this.dashCharge >= 1 ? 'READY' : `${Math.round(this.dashCharge * 100)}%`, this.dashCharge < 1);
  }

  collide(a, b) {
    const d = a.position.clone().sub(b.position).setY(0);
    const dist = d.length();
    const min = 1.95;
    if (dist >= min || dist < 0.0001) return;

    const n = d.divideScalar(dist);
    const overlap = min - dist;
    a.position.addScaledVector(n, overlap / 2);
    b.position.addScaledVector(n, -overlap / 2);

    const rel = a.userData.vel.clone().sub(b.userData.vel).dot(n);
    if (rel > 0) return;                       // already separating
    const imp = (-(1 + PUSH) * rel) / (1 / a.userData.mass + 1 / b.userData.mass);
    a.userData.vel.addScaledVector(n, imp / a.userData.mass);
    b.userData.vel.addScaledVector(n, -imp / b.userData.mass);
    if (Math.abs(rel) > 4) this.audio.thud();
  }

  eject(f, i) {
    this.pushed++;
    this.burst.burst(f.position, PALETTE.red, 16, 8);
    this.audio.blip(clamp(this.pushed, 0, 20));
    this.scene.remove(f);
    f.geometry.dispose();
    f.material.dispose();
    this.foes.splice(i, 1);
  }

  lose() {
    this.audio.lose();
    this.burst.burst(this.player.position, PALETTE.cyan, 20, 9);
    this.end(this.pushed, `You shoved ${this.pushed} off before going over yourself.`);
  }
}
