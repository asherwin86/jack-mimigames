import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const ARENA = 26;
const MAX_ENEMIES = 70;
const UPGRADES = ['MORE DAMAGE', 'FASTER FIRE', 'MORE SHOTS', 'FASTER LEGS', 'BIGGER MAGNET', 'MAX HEALTH'];

export default class HordeSurvivor extends Game {
  start() {
    sky(this.scene, '#2a1a3d', '#08040f', 60, 170);
    lights(this.scene, { sky: 0xe0c8ff, groundCol: 0x1c1030 });
    this.add(ground(ARENA * 2 + 20, 0x181026));
    const ring = box(ARENA * 2, 0.3, ARENA * 2, glow(0x3a2a66, { emissiveIntensity: 0.3 }), { cast: false });
    ring.position.y = -0.1;
    ring.material.wireframe = true;
    this.add(ring);

    this.player = this.add(box(1.1, 1.4, 1.1, glow(PALETTE.cyan)));
    this.player.position.y = 0.7;
    this.vel = new THREE.Vector3();

    this.enemies = [];
    this.shots = [];
    this.gems = [];
    this.burst = new Burst(this.scene, 120, 0.22);
    this.hp = 5; this.maxHp = 5;
    this.damage = 1; this.fireRate = 0.6; this.shotCount = 1;
    this.speed = 8; this.magnet = 4;
    this.kills = 0;
    this.xp = 0; this.level = 1; this.need = 6;
    this.cool = 0; this.invuln = 0; this.spawnT = 0.5;
    this.camera.position.set(0, 26, 12);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('WASD to move · you fire on your own · collect the gems to level up and get stronger');
  }

  spawn() {
    if (this.enemies.length >= MAX_ENEMIES) return;
    const a = rand(0, Math.PI * 2);
    const r = ARENA + 2;
    const tough = Math.random() < clamp(this.time / 240, 0, 0.35);
    const e = box(tough ? 1.6 : 1.0, tough ? 1.6 : 1.0, tough ? 1.6 : 1.0, glow(tough ? PALETTE.red : PALETTE.pink, { emissiveIntensity: 0.5 }));
    e.position.set(this.player.position.x + Math.cos(a) * r, e.geometry.parameters.height / 2, this.player.position.z + Math.sin(a) * r);
    e.userData = { hp: tough ? 4 + Math.floor(this.time / 60) : 1 + Math.floor(this.time / 90), tough, speed: (tough ? 2.6 : 3.4) + Math.min(2.5, this.time / 80) };
    this.enemies.push(this.add(e));
  }

  update(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.cool -= dt;

    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq()) dir.normalize();
    this.vel.x = damp(this.vel.x, dir.x * this.speed, 14, dt);
    this.vel.z = damp(this.vel.z, dir.z * this.speed, 14, dt);
    const p = this.player.position;
    p.x = clamp(p.x + this.vel.x * dt, -ARENA, ARENA);
    p.z = clamp(p.z + this.vel.z * dt, -ARENA, ARENA);

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const n = 1 + Math.floor(this.time / 45);
      for (let i = 0; i < n; i++) this.spawn();
      this.spawnT = clamp(0.9 - this.time * 0.004, 0.22, 0.9);
    }

    // Enemies swarm at you.
    for (const e of this.enemies) {
      const dx = p.x - e.position.x;
      const dz = p.z - e.position.z;
      const d = Math.hypot(dx, dz) || 1;
      e.position.x += (dx / d) * e.userData.speed * dt;
      e.position.z += (dz / d) * e.userData.speed * dt;
      e.rotation.y += dt * 2;
      if (d < 1.15 + (e.userData.tough ? 0.3 : 0) && this.invuln <= 0) { this.hurt(); if (this.finished) return; }
    }

    // Auto-fire at the nearest enemies.
    if (this.cool <= 0 && this.enemies.length) {
      this.cool = this.fireRate;
      const sorted = [...this.enemies].sort((a, b) => (a.position.distanceToSquared(p) - b.position.distanceToSquared(p)));
      for (let i = 0; i < this.shotCount; i++) {
        const t = sorted[Math.min(i, sorted.length - 1)];
        const ang = Math.atan2(t.position.x - p.x, t.position.z - p.z);
        const s = ball(0.28, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false, seg: 8 });
        s.position.set(p.x, 0.8, p.z);
        s.userData = { vx: Math.sin(ang) * 22, vz: Math.cos(ang) * 22, life: 1.4 };
        this.shots.push(this.add(s));
      }
      this.audio.tone(700, 0.03, { type: 'square', gain: 0.05 });
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.position.x += s.userData.vx * dt;
      s.position.z += s.userData.vz * dt;
      s.userData.life -= dt;
      let gone = s.userData.life <= 0;
      for (let k = this.enemies.length - 1; k >= 0 && !gone; k--) {
        const e = this.enemies[k];
        if (Math.hypot(e.position.x - s.position.x, e.position.z - s.position.z) < (e.userData.tough ? 1.1 : 0.85)) {
          e.userData.hp -= this.damage;
          this.burst.burst(e.position, PALETTE.amber, 4, 4);
          gone = true;
          if (e.userData.hp <= 0) this.kill(e, k);
        }
      }
      if (gone) { this.scene.remove(s); this.shots.splice(i, 1); }
    }

    // Gems drift to you when close, and level you up.
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.rotation.y += dt * 3;
      const dx = p.x - g.position.x;
      const dz = p.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < this.magnet) { g.position.x += (dx / d) * 14 * dt; g.position.z += (dz / d) * 14 * dt; }
      if (d < 1.0) {
        this.xp++;
        this.audio.blip(this.xp % 10);
        this.scene.remove(g);
        this.gems.splice(i, 1);
        if (this.xp >= this.need) this.levelUp();
      }
    }

    this.player.visible = this.invuln <= 0 || Math.sin(this.time * 30) > 0;
    this.burst.update(dt);
    this.camera.position.x = damp(this.camera.position.x, p.x * 0.8, 4, dt);
    this.camera.position.z = damp(this.camera.position.z, 12 + p.z * 0.8, 4, dt);
    this.camera.lookAt(p.x * 0.8, 0, p.z * 0.8 + 1);

    this.hud.stat('Kills', this.kills);
    this.hud.stat('Level', this.level);
    this.hud.stat('Health', '▮'.repeat(this.hp) || '—', this.hp <= 1);
    this.hud.stat('Time', `${Math.floor(this.time)}s`);
  }

  kill(e, index) {
    this.kills++;
    this.burst.burst(e.position, PALETTE.pink, 8, 5);
    this.audio.thud();
    const gem = ball(0.28, glow(PALETTE.lime, { emissiveIntensity: 1 }), { cast: false, seg: 6 });
    gem.position.set(e.position.x, 0.4, e.position.z);
    this.gems.push(this.add(gem));
    if (e.userData.tough) { const g2 = ball(0.28, glow(PALETTE.lime, { emissiveIntensity: 1 }), { cast: false, seg: 6 }); g2.position.set(e.position.x + 0.5, 0.4, e.position.z); this.gems.push(this.add(g2)); }
    this.scene.remove(e);
    this.enemies.splice(index, 1);
  }

  levelUp() {
    this.level++;
    this.xp = 0;
    this.need = Math.round(this.need * 1.35 + 2);
    const name = UPGRADES[(this.level - 2) % UPGRADES.length];
    this.applyUpgrade(name);
    this.hud.toast(`LEVEL ${this.level} · ${name}`, 1200);
    this.audio.win();
  }

  applyUpgrade(name) {
    if (name === 'MORE DAMAGE') this.damage += 1;
    else if (name === 'FASTER FIRE') this.fireRate = Math.max(0.12, this.fireRate * 0.8);
    else if (name === 'MORE SHOTS') this.shotCount = Math.min(6, this.shotCount + 1);
    else if (name === 'FASTER LEGS') this.speed += 1.5;
    else if (name === 'BIGGER MAGNET') this.magnet += 2.5;
    else { this.maxHp += 1; this.hp = Math.min(this.maxHp, this.hp + 1); }
  }

  hurt() {
    this.hp--;
    this.invuln = 1.1;
    this.burst.burst(this.player.position, PALETTE.cyan, 14, 7);
    this.audio.boom();
    if (this.hp <= 0) {
      this.audio.lose();
      this.end(this.kills, `${this.kills} kills, level ${this.level}, ${Math.floor(this.time)} seconds.`);
    }
  }
}
