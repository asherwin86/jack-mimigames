import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const X_MIN = -17;
const X_MAX = 16;
const Y_LIM = 9;
const LIVES = 3;

const KINDS = {
  drone: { hp: 1, pts: 100, col: PALETTE.pink, size: 1.1 },
  gunner: { hp: 2, pts: 250, col: PALETTE.amber, size: 1.4 },
  tank: { hp: 6, pts: 600, col: PALETTE.violet, size: 2.2 },
};

export default class StarFighter extends Game {
  start() {
    sky(this.scene, '#08051a', '#000000', 60, 200);
    lights(this.scene, { sky: 0xbfc8ff, groundCol: 0x0a0820 });
    this.stars = [];
    const starGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Mesh(starGeo, starMat);
      s.position.set(rand(-24, 24), rand(-13, 13), rand(-10, -2));
      s.userData.v = rand(2, 9);
      this.stars.push(this.add(s));
    }

    this.ship = new THREE.Group();
    const hull = box(2.2, 0.7, 1, glow(PALETTE.cyan, { emissiveIntensity: 0.45 }));
    const nose = cyl(0, 0.5, 1.2, glow(PALETTE.white, { emissiveIntensity: 0.4 }));
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 1.6;
    const wing = box(0.9, 2.2, 0.3, glow(PALETTE.blue, { emissiveIntensity: 0.4 }));
    wing.position.x = -0.5;
    this.ship.add(hull, nose, wing);
    this.ship.position.set(-12, 0, 0);
    this.add(this.ship);

    this.bulletGeo = new THREE.BoxGeometry(0.9, 0.18, 0.18);
    this.bulletMat = new THREE.MeshBasicMaterial({ color: PALETTE.lime });
    this.enemyBulletMat = new THREE.MeshBasicMaterial({ color: PALETTE.red });
    this.shots = [];
    this.enemyShots = [];
    this.enemies = [];
    this.pickups = [];
    this.burst = new Burst(this.scene, 120, 0.22);

    this.lives = LIVES;
    this.score = 0;
    this.kills = 0;
    this.invuln = 0;
    this.fireCd = 0;
    this.spread = 0;
    this.rapid = 0;
    this.spawnT = 1.2;
    this.camera.position.set(0, 0, 22);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('WASD / stick to fly · hold Space, click or A to fire · red bullets hurt · grab S (spread), R (rapid) and + (extra life) drops · 3 lives');
  }

  spawnEnemy() {
    const t = this.time;
    const roll = Math.random();
    const kind = roll < 0.6 - Math.min(0.3, t / 200) ? 'drone' : roll < 0.9 || t < 40 ? 'gunner' : 'tank';
    const k = KINDS[kind];
    const m = box(k.size, k.size, k.size, glow(k.col, { emissiveIntensity: 0.5 }));
    m.position.set(21, rand(-Y_LIM + 1, Y_LIM - 1), 0);
    this.add(m);
    this.enemies.push({
      mesh: m, kind, hp: k.hp, baseY: m.position.y, phase: rand(0, 6), fire: rand(0.8, 1.6), r: k.size * 0.75,
    });
  }

  shoot(dx = 0, dy = 0) {
    const b = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    b.position.copy(this.ship.position).add(new THREE.Vector3(2.2, 0, 0));
    b.userData.v = new THREE.Vector3(30, dy * 30, 0);
    this.add(b);
    this.shots.push(b);
  }

  enemyShoot(e, aim = true, angle = 0) {
    const b = new THREE.Mesh(this.bulletGeo, this.enemyBulletMat);
    b.position.copy(e.mesh.position);
    const dir = new THREE.Vector3(-1, 0, 0);
    if (aim) dir.copy(this.ship.position).sub(e.mesh.position).setZ(0).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    b.userData.v = dir.multiplyScalar(11);
    b.scale.set(0.7, 1.4, 1.4);
    this.add(b);
    this.enemyShots.push(b);
  }

  hurt() {
    if (this.invuln > 0) return;
    this.lives--;
    this.invuln = 1.6;
    this.burst.burst(this.ship.position, PALETTE.cyan, 22, 9);
    this.audio.boom();
    this.spread = Math.max(0, this.spread - 6);
    if (this.lives <= 0) this.finish();
  }

  kill(e) {
    const k = KINDS[e.kind];
    this.score += k.pts;
    this.kills++;
    this.burst.burst(e.mesh.position, k.col, 14, 8);
    this.audio.boom?.();
    this.scene.remove(e.mesh);
    if (Math.random() < 0.13) this.dropPickup(e.mesh.position);
  }

  dropPickup(pos) {
    const type = pick3();
    const col = type === 'S' ? PALETTE.lime : type === 'R' ? PALETTE.amber : PALETTE.pink;
    const m = box(0.9, 0.9, 0.9, glow(col, { emissiveIntensity: 0.9 }));
    m.position.copy(pos);
    this.add(m);
    this.pickups.push({ mesh: m, type });
  }

  update(dt) {
    if (this.finished) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.spread = Math.max(0, this.spread - dt);
    this.rapid = Math.max(0, this.rapid - dt);

    for (const s of this.stars) {
      s.position.x -= s.userData.v * dt;
      if (s.position.x < -25) { s.position.x = 25; s.position.y = rand(-13, 13); }
    }

    // Ship
    const mx = this.input.axisX();
    const my = this.input.axisY();
    this.ship.position.x = clamp(this.ship.position.x + mx * 13 * dt, X_MIN, X_MAX - 4);
    this.ship.position.y = clamp(this.ship.position.y + my * 11 * dt, -Y_LIM, Y_LIM);
    this.ship.rotation.z = damp(this.ship.rotation.z, my * 0.35, 10, dt);
    this.ship.visible = this.invuln <= 0 || Math.floor(this.time * 14) % 2 === 0;

    this.fireCd -= dt;
    const firing = this.input.key('Space') || this.input.down || this.input.gpButton(0) || this.input.gpButton(7);
    if (firing && this.fireCd <= 0) {
      this.fireCd = this.rapid > 0 ? 0.09 : 0.19;
      this.shoot(0, 0);
      if (this.spread > 0) { this.shoot(0, 0.22); this.shoot(0, -0.22); }
      this.audio.tone?.([700, 500], 0.04, { type: 'square', gain: 0.03 });
    }

    // Enemies
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnEnemy();
      this.spawnT = clamp(1.25 - this.time / 90, 0.4, 1.25) * rand(0.7, 1.2);
    }
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const m = e.mesh;
      e.phase += dt;
      if (e.kind === 'drone') { m.position.x -= 6.5 * dt; m.position.y = e.baseY + Math.sin(e.phase * 2.4) * 3; }
      else if (e.kind === 'gunner') {
        m.position.x = Math.max(9, m.position.x - 3.6 * dt);
        m.position.y = e.baseY + Math.sin(e.phase * 1.2) * 2;
        if ((e.fire -= dt) <= 0) { e.fire = rand(1.2, 2.1); this.enemyShoot(e, true); }
      } else {
        m.position.x = Math.max(11, m.position.x - 2.4 * dt);
        m.position.y = e.baseY + Math.sin(e.phase * 0.8) * 3;
        if ((e.fire -= dt) <= 0) { e.fire = rand(1.4, 2); for (const a of [-0.3, 0, 0.3]) this.enemyShoot(e, false, a); }
      }
      m.rotation.x += dt * 1.5;
      if (m.position.x < -22) { this.scene.remove(m); this.enemies.splice(i, 1); continue; }
      if (m.position.distanceTo(this.ship.position) < e.r + 0.9) { this.hurt(); this.kill(e); this.enemies.splice(i, 1); }
    }
    if (this.finished) return;

    // Bullets
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const b = this.shots[i];
      b.position.addScaledVector(b.userData.v, dt);
      let gone = b.position.x > 22;
      for (let j = this.enemies.length - 1; j >= 0 && !gone; j--) {
        const e = this.enemies[j];
        if (Math.abs(b.position.x - e.mesh.position.x) < e.r + 0.4 && Math.abs(b.position.y - e.mesh.position.y) < e.r + 0.2) {
          gone = true;
          e.hp--;
          this.burst.burst(b.position, PALETTE.white, 3, 4);
          if (e.hp <= 0) { this.kill(e); this.enemies.splice(j, 1); }
        }
      }
      if (gone) { this.scene.remove(b); this.shots.splice(i, 1); }
    }
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const b = this.enemyShots[i];
      b.position.addScaledVector(b.userData.v, dt);
      if (b.position.distanceTo(this.ship.position) < 0.9) { this.hurt(); this.scene.remove(b); this.enemyShots.splice(i, 1); continue; }
      if (Math.abs(b.position.x) > 24 || Math.abs(b.position.y) > 14) { this.scene.remove(b); this.enemyShots.splice(i, 1); }
    }
    // Pickups drift left
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.mesh.position.x -= 3 * dt;
      p.mesh.rotation.y += dt * 3;
      if (p.mesh.position.distanceTo(this.ship.position) < 1.6) {
        if (p.type === 'S') this.spread = 14; else if (p.type === 'R') this.rapid = 12; else this.lives = Math.min(5, this.lives + 1);
        this.audio.good?.();
        this.hud.toast(p.type === 'S' ? 'SPREAD SHOT' : p.type === 'R' ? 'RAPID FIRE' : '+1 LIFE', 900);
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      } else if (p.mesh.position.x < -22) { this.scene.remove(p.mesh); this.pickups.splice(i, 1); }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '♥'.repeat(this.lives), this.lives <= 1);
    this.hud.stat('Power', this.spread > 0 ? `spread ${Math.ceil(this.spread)}` : this.rapid > 0 ? `rapid ${Math.ceil(this.rapid)}` : '—');
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `You shot down ${this.kills} ships for ${this.score} points.`);
  }
}

const pick3 = () => { const r = Math.random(); return r < 0.4 ? 'S' : r < 0.85 ? 'R' : 'L'; };
