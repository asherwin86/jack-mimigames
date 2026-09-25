import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, lights, sky, glow, mat, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const CITY_X = [-14, -9, -4, 4, 9, 14];
const BATTERY_X = [-18, 0, 18];
const GROUND_Y = 0;
const BLAST_R = 3.2;
const AMMO = 8;

function lineBetween(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
  l.frustumCulled = false;
  return l;
}

export default class MissileDefence extends Game {
  start() {
    sky(this.scene, '#0a1030', '#1a2a4a', 80, 200);
    lights(this.scene, { sky: 0xbfd0ff, groundCol: 0x101830 });
    const floor = box(60, 1, 6, mat(0x1a2440));
    floor.position.set(0, -0.5, 0);
    this.add(floor);

    this.cities = CITY_X.map((x) => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const b = box(1.1, 1 + i * 0.7, 1.1, glow(PALETTE.cyan, { emissiveIntensity: 0.35 }));
        b.position.set((i - 1) * 1.2, (1 + i * 0.7) / 2, 0);
        g.add(b);
      }
      g.position.set(x, 0, 0);
      this.add(g);
      return { x, alive: true, group: g };
    });
    this.batteries = BATTERY_X.map((x) => {
      const m = cyl(0.3, 1.4, 1.6, glow(PALETTE.lime, { emissiveIntensity: 0.4 }));
      m.position.set(x, 0.8, 0);
      this.add(m);
      return { x, ammo: AMMO, mesh: m };
    });

    this.incoming = [];
    this.outgoing = [];
    this.blasts = [];
    this.burst = new Burst(this.scene, 100, 0.22);
    this.cross = this.add(new THREE.Mesh(new THREE.RingGeometry(0.4, 0.6, 20), new THREE.MeshBasicMaterial({ color: PALETTE.amber, depthTest: false, transparent: true })));
    this.cross.renderOrder = 10;
    this.wave = 0;
    this.score = 0;
    this.toSpawn = 0;
    this.spawnT = 0;
    this.waveDelay = 1;
    this.waveMissiles = 0;
    this.showCursor = true;
    this.camera.position.set(0, 9, 28);
    this.camera.lookAt(0, 8, 0);
    this.startWave();
    this.hud.hint('Click in the sky to launch a counter-missile from the nearest battery — its blast destroys anything inside it · protect the cities · ammo refills every wave');
  }

  aliveCities() { return this.cities.filter((c) => c.alive); }

  startWave() {
    this.wave++;
    this.toSpawn = 8 + this.wave * 3;
    this.waveMissiles = this.toSpawn;
    this.spawnT = 0.5;
    for (const b of this.batteries) b.ammo = AMMO;
    this.hud.toast(`WAVE ${this.wave}`, 1000);
  }

  spawnIncoming() {
    const targets = [...this.aliveCities().map((c) => c.x), ...this.batteries.map((b) => b.x)];
    const tx = targets[Math.floor(Math.random() * targets.length)];
    const start = new THREE.Vector3(rand(-20, 20), 24, 0);
    const end = new THREE.Vector3(tx, 0.5, 0);
    const speed = 2.6 + this.wave * 0.35 + rand(0, 1.2);
    const line = lineBetween(PALETTE.red);
    this.add(line);
    const head = ball(0.28, glow(PALETTE.red, { emissiveIntensity: 1 }), { cast: false });
    head.position.copy(start);
    this.add(head);
    this.incoming.push({ start, end, pos: start.clone(), dir: end.clone().sub(start).normalize(), speed, line, head, len: end.distanceTo(start) });
  }

  /** Fires the nearest loaded battery at (x, y). Returns true if a missile flew. */
  fireAt(x, y) {
    if (y < 2) return false;
    let best = null;
    for (const b of this.batteries) if (b.ammo > 0 && (!best || Math.abs(b.x - x) < Math.abs(best.x - x))) best = b;
    if (!best) { this.audio.bad(); return false; }
    best.ammo--;
    const start = new THREE.Vector3(best.x, 1.6, 0);
    const end = new THREE.Vector3(x, y, 0);
    const line = lineBetween(PALETTE.lime);
    this.add(line);
    const head = ball(0.24, glow(PALETTE.lime, { emissiveIntensity: 1 }), { cast: false });
    head.position.copy(start);
    this.add(head);
    this.outgoing.push({ start, end, pos: start.clone(), dir: end.clone().sub(start).normalize(), speed: 22, line, head, len: end.distanceTo(start) });
    this.audio.blip(7);
    return true;
  }

  explode(pos, col = PALETTE.amber) {
    const m = ball(1, glow(col, { emissiveIntensity: 1 }), { cast: false });
    m.material.transparent = true;
    m.material.opacity = 0.75;
    m.position.copy(pos);
    m.scale.setScalar(0.1);
    this.add(m);
    this.blasts.push({ mesh: m, t: 0 });
  }

  setLine(line, a, b) {
    const arr = line.geometry.attributes.position.array;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
    line.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    if (this.finished) return;
    const p = this.planePoint(0);
    if (p) this.cross.position.set(clamp(p.x, -22, 22), clamp(p.y, 0, 22), 0.5);

    if (this.clickedNow() && p) this.fireAt(p.x, p.y);

    // Spawning
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnIncoming(); this.toSpawn--; this.spawnT = rand(0.35, 1.3) / (1 + this.wave * 0.1); }
    } else if (!this.incoming.length && !this.outgoing.length && !this.blasts.length) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        const bonus = this.aliveCities().length * 100;
        this.score += bonus;
        this.hud.toast(`WAVE CLEARED · +${bonus}`, 1200);
        this.audio.good();
        this.waveDelay = 1.6;
        this.startWave();
      }
    }

    // Our missiles
    for (let i = this.outgoing.length - 1; i >= 0; i--) {
      const m = this.outgoing[i];
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.head.position.copy(m.pos);
      this.setLine(m.line, m.start, m.pos);
      if (m.pos.distanceTo(m.start) >= m.len) {
        this.explode(m.end, PALETTE.amber);
        this.scene.remove(m.line); this.scene.remove(m.head);
        this.outgoing.splice(i, 1);
      }
    }
    // Blasts grow, hold, fade — and destroy enemy missiles inside them.
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t += dt;
      const r = b.t < 0.5 ? (b.t / 0.5) * BLAST_R : b.t < 1.1 ? BLAST_R : BLAST_R * (1 - (b.t - 1.1) / 0.4);
      b.mesh.scale.setScalar(Math.max(0.05, r));
      b.mesh.material.opacity = b.t > 1.1 ? 0.75 * (1 - (b.t - 1.1) / 0.4) : 0.75;
      for (let j = this.incoming.length - 1; j >= 0; j--) {
        const e = this.incoming[j];
        if (e.pos.distanceTo(b.mesh.position) < r) {
          this.score += 25;
          this.burst.burst(e.pos, PALETTE.amber, 8, 6);
          this.audio.thud();
          this.explode(e.pos, PALETTE.amber);
          this.scene.remove(e.line); this.scene.remove(e.head);
          this.incoming.splice(j, 1);
        }
      }
      if (b.t >= 1.5) { this.scene.remove(b.mesh); this.blasts.splice(i, 1); }
    }
    // Enemy missiles fall.
    for (let i = this.incoming.length - 1; i >= 0; i--) {
      const e = this.incoming[i];
      e.pos.addScaledVector(e.dir, e.speed * dt);
      e.head.position.copy(e.pos);
      this.setLine(e.line, e.start, e.pos);
      if (e.pos.y <= e.end.y + 0.1) {
        this.hitGround(e.end.x);
        this.scene.remove(e.line); this.scene.remove(e.head);
        this.incoming.splice(i, 1);
      }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Wave', this.wave);
    this.hud.stat('Cities', this.aliveCities().length, this.aliveCities().length <= 2);
    this.hud.stat('Ammo', this.batteries.reduce((a, b) => a + b.ammo, 0));
    if (!this.aliveCities().length && !this.finished) this.finish();
  }

  hitGround(x) {
    this.explode(new THREE.Vector3(x, 0.8, 0), PALETTE.red);
    this.audio.boom();
    for (const c of this.cities) {
      if (c.alive && Math.abs(c.x - x) < 2) { c.alive = false; c.group.visible = false; this.burst.burst(new THREE.Vector3(c.x, 1, 0), PALETTE.cyan, 16, 8); }
    }
    for (const b of this.batteries) if (b.ammo > 0 && Math.abs(b.x - x) < 1.6) { b.ammo = 0; this.burst.burst(new THREE.Vector3(b.x, 1, 0), PALETTE.lime, 10, 6); }
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `Your cities fell on wave ${this.wave} with ${this.score} points.`);
  }
}
