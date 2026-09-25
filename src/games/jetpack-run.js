import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const FLOOR = 0;
const CEIL = 14;
const GRAV = 26;
const THRUST = 52;
const MAX_UP = 11;
const MAX_DOWN = -14;
const PX = -8;

export default class JetpackRun extends Game {
  start() {
    sky(this.scene, '#1c1a3a', '#0a0a18', 60, 200);
    lights(this.scene, { sky: 0xc8c8ff, groundCol: 0x14122a });
    const floor = box(200, 1, 8, mat(0x2a2848));
    floor.position.set(0, -0.5, 0);
    const ceil = box(200, 1, 8, mat(0x2a2848));
    ceil.position.set(0, CEIL + 0.5, 0);
    this.add(floor, ceil);
    this.stripes = [];
    for (let i = 0; i < 16; i++) {
      const s = box(2, 0.05, 0.6, glow(PALETTE.blue, { emissiveIntensity: 0.4 }), { cast: false });
      s.position.set(i * 4 - 26, 0.03, 3.4);
      this.stripes.push(this.add(s));
    }
    this.player = new THREE.Group();
    const body = box(1, 1.4, 0.8, glow(PALETTE.amber, { emissiveIntensity: 0.4 }));
    const pack = box(0.5, 1, 0.5, mat(0x8a8fa0));
    pack.position.set(-0.6, 0, 0);
    this.flame = box(0.35, 0.8, 0.35, glow(PALETTE.red, { emissiveIntensity: 1 }), { cast: false });
    this.flame.position.set(-0.6, -1, 0);
    this.player.add(body, pack, this.flame);
    this.player.position.set(PX, 0.7, 0);
    this.add(this.player);

    this.vy = 0;
    this.things = [];
    this.burst = new Burst(this.scene, 80, 0.2);
    this.distance = 0;
    this.coins = 0;
    this.speed = 11;
    this.spawnT = 1.4;
    this.camera.position.set(0, 7, 24);
    this.camera.lookAt(0, 7, 0);
    this.hud.hint('Hold Space, click or press A to fire the jetpack and rise · let go to fall · dodge the zappers and rockets, grab coins for extra distance');
  }

  spawnZapper() {
    const len = rand(3.5, 6.5);
    const angle = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4][Math.floor(Math.random() * 4)];
    const g = new THREE.Group();
    const bar = box(len, 0.35, 0.5, glow(PALETTE.violet, { emissiveIntensity: 1.1 }));
    const e1 = ball(0.5, mat(0xcccccc), { cast: false });
    const e2 = ball(0.5, mat(0xcccccc), { cast: false });
    e1.position.x = -len / 2;
    e2.position.x = len / 2;
    g.add(bar, e1, e2);
    g.rotation.z = angle;
    g.position.set(24, rand(3 + len * 0.3, CEIL - 3 - len * 0.3), 0);
    this.add(g);
    // a hit box that fits the rotated bar closely enough
    const half = len / 2;
    this.things.push({ kind: 'zap', mesh: g, half, angle });
  }

  spawnRocket() {
    const m = box(2, 0.7, 0.7, glow(PALETTE.red, { emissiveIntensity: 0.8 }));
    m.position.set(26, clamp(this.player.position.y + rand(-3, 3), 1.2, CEIL - 1.2), 0);
    this.add(m);
    this.things.push({ kind: 'rocket', mesh: m, warn: 1.0 });
  }

  spawnCoins() {
    const n = 5 + Math.floor(Math.random() * 4);
    const y = rand(2, CEIL - 2);
    const wave = Math.random() < 0.5;
    for (let i = 0; i < n; i++) {
      const c = ball(0.36, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false });
      c.scale.z = 0.4;
      c.position.set(24 + i * 1.3, wave ? y + Math.sin(i * 0.9) * 1.5 : y, 0);
      this.add(c);
      this.things.push({ kind: 'coin', mesh: c });
    }
  }

  /** Distance from a point to the zapper's bar (a segment). */
  static barDistance(px, py, cx, cy, half, angle) {
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    const ax = cx - dx; const ay = cy - dy; const bx = cx + dx; const by = cy + dy;
    const abx = bx - ax; const aby = by - ay;
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1);
    return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
  }

  update(dt) {
    if (this.finished) return;
    this.speed = Math.min(26, 11 + this.distance / 90);
    this.distance += this.speed * dt * 0.5;

    const thrust = this.input.key('Space', 'ArrowUp', 'KeyW') || this.input.down || this.input.gpButton(0);
    this.vy = clamp(this.vy + (thrust ? THRUST - GRAV : -GRAV) * dt, MAX_DOWN, MAX_UP);
    const p = this.player.position;
    p.y += this.vy * dt;
    if (p.y < 0.7) { p.y = 0.7; this.vy = Math.max(0, this.vy); }
    if (p.y > CEIL - 0.7) { p.y = CEIL - 0.7; this.vy = Math.min(0, this.vy); }
    this.player.rotation.z = damp(this.player.rotation.z, clamp(this.vy * 0.03, -0.4, 0.4), 10, dt);
    this.flame.visible = thrust;
    this.flame.scale.y = 0.8 + Math.random() * 0.6;
    if (thrust && Math.random() < 0.6) this.burst.burst(new THREE.Vector3(p.x - 0.6, p.y - 0.9, 0), PALETTE.amber, 1, 3);

    for (const s of this.stripes) { s.position.x -= this.speed * dt; if (s.position.x < -28) s.position.x += 64; }

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const r = Math.random();
      if (r < 0.45) this.spawnZapper(); else if (r < 0.65 && this.distance > 60) this.spawnRocket(); else this.spawnCoins();
      this.spawnT = clamp(1.7 - this.distance / 900, 0.7, 1.7) * rand(0.8, 1.15);
    }

    for (let i = this.things.length - 1; i >= 0; i--) {
      const t = this.things[i];
      const m = t.mesh;
      if (t.kind === 'rocket') {
        if (t.warn > 0) { t.warn -= dt; m.position.x -= this.speed * dt * 0.3; m.visible = Math.floor(this.time * 12) % 2 === 0; }
        else { m.visible = true; m.position.x -= (this.speed + 12) * dt; }
      } else m.position.x -= this.speed * dt;
      if (m.position.x < -26) { this.scene.remove(m); this.things.splice(i, 1); continue; }

      if (t.kind === 'coin') {
        if (Math.hypot(m.position.x - p.x, m.position.y - p.y) < 1.1) {
          this.coins++;
          this.audio.pickup?.();
          this.burst.burst(m.position, PALETTE.amber, 3, 4);
          this.scene.remove(m);
          this.things.splice(i, 1);
        }
        continue;
      }
      let hit = false;
      if (t.kind === 'zap') {
        const cx = m.position.x - p.x; const cy = m.position.y - p.y;
        hit = Math.abs(cx) < 8 && JetpackRun.barDistance(0, 0, cx, cy, t.half, t.angle) < 0.85;
      } else if (t.kind === 'rocket' && t.warn <= 0) {
        hit = Math.abs(m.position.x - p.x) < 1.4 && Math.abs(m.position.y - p.y) < 1.0;
      }
      if (hit) return this.crash();
    }

    this.burst.update(dt);
    this.hud.stat('Distance', `${Math.floor(this.distance + this.coins * 5)} m`);
    this.hud.stat('Coins', this.coins);
  }

  crash() {
    this.burst.burst(this.player.position, PALETTE.amber, 24, 10);
    this.player.visible = false;
    this.audio.boom();
    this.audio.lose();
    const total = Math.floor(this.distance + this.coins * 5);
    this.end(total, `You flew ${total} m and grabbed ${this.coins} coins.`);
  }
}
