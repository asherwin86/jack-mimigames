import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, TAU, PALETTE,
} from '../engine/utils.js';

const BASE_HP = 100;
const MAG = 24;
const RELOAD = 1.3;

const KINDS = {
  walker: { hp: 2, speed: 2.3, dmg: 8, col: 0x6fa86a, size: 1.0, pts: 10 },
  runner: { hp: 1, speed: 4.6, dmg: 5, col: 0xd8c25a, size: 0.8, pts: 15 },
  brute: { hp: 9, speed: 1.3, dmg: 25, col: 0xa64b4b, size: 1.7, pts: 40 },
};

export default class TurretDefence extends Game {
  start() {
    sky(this.scene, '#1e2a1c', '#070b06', 40, 110);
    lights(this.scene, { sky: 0xd8ffd0, groundCol: 0x101c0e });
    this.add(ground(120, 0x18220f));

    this.turret = new THREE.Group();
    const base = cyl(1.5, 1.8, 0.9, mat(0x50565e));
    base.position.y = 0.45;
    this.gun = new THREE.Group();
    const barrel = box(0.5, 0.5, 2.4, glow(PALETTE.cyan, { emissiveIntensity: 0.3 }));
    barrel.position.z = 1.3;
    const head = box(1.4, 0.9, 1.4, mat(0x7a828c));
    this.gun.add(head, barrel);
    this.gun.position.y = 1.3;
    this.turret.add(base, this.gun);
    this.add(this.turret);

    this.enemies = [];
    this.bullets = [];
    this.burst = new Burst(this.scene, 120, 0.22);
    this.baseHp = BASE_HP;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.left = 0;
    this.spawnT = 1;
    this.between = 1.2;
    this.ammo = MAG;
    this.reloadT = 0;
    this.fireCd = 0;
    this.aim = 0;
    this.showCursor = true;
    this.camera.position.set(0, 24, 12);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('Move the mouse to aim, hold click (or A) to fire · R reloads · zombies gnaw the base — keep them off it · bigger waves each round');
  }

  startWave() {
    this.wave++;
    this.left = 6 + this.wave * 4;
    this.spawnT = 0.5;
    this.hud.toast(`WAVE ${this.wave}`, 1000);
  }

  spawn() {
    const roll = Math.random();
    const kind = this.wave >= 3 && roll < 0.14 ? 'brute' : this.wave >= 2 && roll < 0.42 ? 'runner' : 'walker';
    const k = KINDS[kind];
    const a = rand(0, TAU);
    const m = box(k.size, k.size * 1.6, k.size, mat(k.col, { roughness: 0.8 }));
    m.position.set(Math.sin(a) * 26, k.size * 0.8, Math.cos(a) * 26);
    this.add(m);
    this.enemies.push({ mesh: m, kind, hp: k.hp + Math.floor(this.wave / 4), r: k.size * 0.8 });
  }

  /** Aim direction (radians about Y) from the pointer. */
  aimAngle() {
    const p = this.groundPoint(0);
    return p ? Math.atan2(p.x, p.z) : this.aim;
  }

  fire() {
    if (this.reloadT > 0 || this.ammo <= 0) return false;
    this.ammo--;
    const b = ball(0.2, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false });
    b.position.set(Math.sin(this.aim) * 2.4, 1.3, Math.cos(this.aim) * 2.4);
    b.userData.v = new THREE.Vector3(Math.sin(this.aim), 0, Math.cos(this.aim)).multiplyScalar(40);
    b.userData.life = 1.2;
    this.add(b);
    this.bullets.push(b);
    this.audio.tone?.([600, 300], 0.05, { type: 'square', gain: 0.04 });
    if (this.ammo <= 0) this.reload();
    return true;
  }

  reload() {
    if (this.reloadT > 0 || this.ammo === MAG) return;
    this.reloadT = RELOAD;
    this.audio.blip(2);
  }

  update(dt) {
    if (this.finished) return;
    this.aim = this.aimAngle();
    this.gun.rotation.y = damp(this.gun.rotation.y, this.aim, 30, dt);
    // rotation.y interpolation would spin the long way round at +-PI; snap when the gap is large
    if (Math.abs(this.gun.rotation.y - this.aim) > Math.PI) this.gun.rotation.y = this.aim;

    this.fireCd -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = MAG; }
    if (this.input.hit('KeyR') || this.input.gpHit(2)) this.reload();
    const trigger = this.input.down || this.input.gpButton(0) || this.input.gpButton(7) || this.input.key('Space');
    if (trigger && this.fireCd <= 0 && this.fire()) this.fireCd = 0.13;

    // Waves
    if (this.left > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawn(); this.left--; this.spawnT = rand(0.4, 1.1) / (1 + this.wave * 0.08); }
    } else if (!this.enemies.length) {
      this.between -= dt;
      if (this.between <= 0) { this.between = 2; this.baseHp = Math.min(BASE_HP, this.baseHp + 10); this.startWave(); }
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.position.addScaledVector(b.userData.v, dt);
      b.userData.life -= dt;
      let gone = b.userData.life <= 0;
      for (let j = this.enemies.length - 1; j >= 0 && !gone; j--) {
        const e = this.enemies[j];
        const dx = b.position.x - e.mesh.position.x;
        const dz = b.position.z - e.mesh.position.z;
        if (dx * dx + dz * dz < (e.r + 0.25) ** 2) {
          gone = true;
          e.hp--;
          this.burst.burst(b.position, 0xb02030, 3, 4);
          if (e.hp <= 0) {
            this.score += KINDS[e.kind].pts;
            this.kills++;
            this.burst.burst(e.mesh.position, KINDS[e.kind].col, 8, 6);
            this.audio.thud();
            this.scene.remove(e.mesh);
            this.enemies.splice(j, 1);
          }
        }
      }
      if (gone) { this.scene.remove(b); this.bullets.splice(i, 1); }
    }

    for (const e of this.enemies) {
      const m = e.mesh;
      const d = Math.hypot(m.position.x, m.position.z);
      const k = KINDS[e.kind];
      if (d > 2.4) {
        m.position.x -= (m.position.x / d) * k.speed * dt;
        m.position.z -= (m.position.z / d) * k.speed * dt;
        m.rotation.y = Math.atan2(-m.position.x, -m.position.z);
        m.position.y = k.size * 0.8 + Math.abs(Math.sin(this.time * 6 + e.r * 10)) * 0.15;
      } else {
        e.bite = (e.bite ?? 0) - dt;
        if (e.bite <= 0) {
          e.bite = 0.8;
          this.baseHp -= k.dmg;
          this.audio.bad();
          this.burst.burst(new THREE.Vector3(0, 1.5, 0), PALETTE.red, 6, 5);
        }
      }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Wave', this.wave);
    this.hud.stat('Base', Math.max(0, Math.round(this.baseHp)), this.baseHp < 30);
    this.hud.stat('Ammo', this.reloadT > 0 ? 'reloading' : `${this.ammo}/${MAG}`);
    if (this.baseHp <= 0) this.finish();
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `The base fell on wave ${this.wave} after ${this.kills} kills.`);
  }
}
