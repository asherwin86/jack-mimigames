import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand,
  PALETTE, COLORS,
} from '../engine/utils.js';

const GRAV = 22;
const SHELLS = 12;

export default class ArtilleryDuel extends Game {
  start() {
    sky(this.scene, '#2c4a6e', '#0a1018', 60, 260);
    lights(this.scene, { sky: 0xcfe4ff, groundCol: 0x24331f });
    this.add(ground(400, 0x2c4526));

    // Cannon: a base plus a barrel that pivots.
    this.mount = this.add(cyl(1.5, 1.9, 1.2, mat(0x3a4152)));
    this.mount.position.y = 0.6;
    this.pivot = this.add(new THREE.Group());
    this.pivot.position.set(0, 1.5, 0);
    this.barrel = cyl(0.35, 0.42, 4.4, glow(0x8d97b5, { emissiveIntensity: 0.12 }));
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.z = -2.2;
    this.pivot.add(this.barrel);

    this.shots = [];
    this.trails = [];
    this.burst = new Burst(this.scene, 140, 0.3);

    this.targets = [];
    for (let i = 0; i < 4; i++) this.spawnTarget();

    this.yaw = 0;
    this.pitch = 0.5;
    this.power = 0;
    this.charging = false;
    this.shellsLeft = SHELLS;
    this.score = 0;
    this.hits = 0;
    this.wind = new THREE.Vector3(rand(-4, 4), 0, rand(-2, 2));

    this.camera.position.set(0, 7, 13);
    this.hud.hint('Mouse aims · hold click to charge, release to fire · mind the wind');
  }

  spawnTarget() {
    const dist = rand(45, 150);
    const a = rand(-0.9, 0.9);
    const h = rand(4, 9);
    const t = box(4.5, h, 4.5, COLORS[this.targets.length % COLORS.length]);
    t.position.set(Math.sin(a) * dist, h / 2, -Math.cos(a) * dist);
    t.userData = { radius: 4.2, points: Math.round(dist / 2) };
    // A ring on the ground makes distant targets findable.
    const marker = cyl(5.6, 5.6, 0.1, glow(PALETTE.amber, { transparent: true, opacity: 0.35 }), { cast: false });
    marker.position.set(t.position.x, 0.06, t.position.z);
    this.add(marker);
    t.userData.marker = marker;
    this.targets.push(this.add(t));
  }

  update(dt) {
    // Aim
    this.yaw = damp(this.yaw, -this.input.pointer.x * 1.15, 9, dt);
    this.pitch = damp(this.pitch, clamp(0.12 + (this.input.pointer.y + 0.5) * 0.85, 0.06, 1.35), 9, dt);
    this.pivot.rotation.set(0, this.yaw, 0);
    this.barrel.parent.rotation.x = 0;
    this.pivot.rotation.x = 0;
    this.barrel.rotation.set(Math.PI / 2 - this.pitch, 0, 0);
    this.barrel.position.set(0, Math.sin(this.pitch) * 2.2, -Math.cos(this.pitch) * 2.2);

    // Charge / fire
    if (this.input.down && this.shellsLeft > 0) {
      if (!this.charging) { this.charging = true; this.power = 0; }
      this.power = clamp(this.power + dt * 0.75, 0, 1);
      if (Math.floor(this.power * 20) !== this._lastTick) {
        this._lastTick = Math.floor(this.power * 20);
        this.audio.tone(300 + this.power * 500, 0.03, { type: 'sine', gain: 0.05 });
      }
    } else if (this.charging) {
      this.charging = false;
      this.fire();
    }

    // Shells
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.userData.vel.y -= GRAV * dt;
      s.userData.vel.addScaledVector(this.wind, dt * 0.25);
      s.position.addScaledVector(s.userData.vel, dt);
      s.userData.trail -= dt;
      if (s.userData.trail <= 0) { s.userData.trail = 0.03; this.puff(s.position); }

      let done = false;
      for (let t = this.targets.length - 1; t >= 0; t--) {
        const tg = this.targets[t];
        const d = Math.hypot(s.position.x - tg.position.x, s.position.z - tg.position.z);
        if (d < tg.userData.radius && s.position.y < tg.position.y * 2 + 1) {
          this.hit(tg, t, d);
          done = true;
          break;
        }
      }
      if (!done && s.position.y <= 0.3) {
        this.burst.burst(s.position, 0x8a7a5a, 12, 6);
        this.audio.boom();
        done = true;
      }
      if (done || s.position.length() > 420) this.removeShot(i);
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const p = this.trails[i];
      p.userData.life -= dt;
      p.material.opacity = clamp(p.userData.life / 0.6, 0, 1) * 0.6;
      p.scale.multiplyScalar(1 + dt * 1.6);
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.trails.splice(i, 1);
      }
    }

    for (const t of this.targets) {
      t.userData.marker.material.opacity = 0.25 + Math.sin(this.time * 3 + t.position.x) * 0.12;
    }

    this.burst.update(dt);

    // Camera looks along the barrel so you can read your aim.
    const look = new THREE.Vector3(Math.sin(this.yaw) * -60, 6, -Math.cos(this.yaw) * 60);
    this.camera.position.x = damp(this.camera.position.x, Math.sin(this.yaw) * 13, 5, dt);
    this.camera.position.z = damp(this.camera.position.z, Math.cos(this.yaw) * 13, 5, dt);
    this.camera.position.y = damp(this.camera.position.y, 7 + this.pitch * 3, 5, dt);
    this.camera.lookAt(look);

    this.hud.stat('Score', this.score);
    this.hud.stat('Shells', this.shellsLeft, this.shellsLeft <= 3);
    this.hud.stat('Power', `${Math.round(this.power * 100)}%`);
    this.hud.stat('Wind', `${this.wind.x > 0 ? '→' : '←'} ${Math.abs(this.wind.x).toFixed(1)}`);

    if (this.shellsLeft <= 0 && !this.shots.length) return this.finish();
  }

  fire() {
    if (this.shellsLeft <= 0 || this.power < 0.05) return;
    this.shellsLeft--;
    const speed = 26 + this.power * 52;
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const s = ball(0.5, glow(PALETTE.white));
    s.position.copy(this.pivot.position).addScaledVector(dir, 4);
    s.userData = { vel: dir.multiplyScalar(speed), trail: 0 };
    this.shots.push(this.add(s));
    this.burst.burst(s.position, PALETTE.amber, 10, 7);
    this.audio.noise(0.35, { gain: 0.2, cutoff: 700, sweep: 0.1 });
    this.power = 0;
  }

  puff(pos) {
    const p = ball(0.28, undefined, { cast: false, receive: false });
    p.material = new THREE.MeshBasicMaterial({ color: 0xd8dcea, transparent: true, opacity: 0.6 });
    p.position.copy(pos);
    p.userData = { life: 0.6 };
    this.trails.push(this.add(p));
  }

  hit(target, index, dist) {
    const bullseye = dist < 1.6;
    const pts = target.userData.points * (bullseye ? 2 : 1);
    this.score += pts;
    this.hits++;
    this.burst.burst(target.position, target.material.color.getHex(), 26, 11);
    this.audio.boom();
    this.audio.good();
    this.hud.toast(bullseye ? `BULLSEYE +${pts}` : `+${pts}`, 900);

    this.scene.remove(target.userData.marker);
    target.userData.marker.geometry.dispose();
    target.userData.marker.material.dispose();
    this.scene.remove(target);
    target.geometry.dispose();
    target.material.dispose();
    this.targets.splice(index, 1);

    this.spawnTarget();
    this.wind.set(rand(-5, 5), 0, rand(-2.5, 2.5));
  }

  removeShot(i) {
    const s = this.shots[i];
    this.scene.remove(s);
    s.geometry.dispose();
    s.material.dispose();
    this.shots.splice(i, 1);
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.hits} of ${SHELLS} shells on target.`);
  }
}
