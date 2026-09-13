import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, chase, PALETTE,
} from '../engine/utils.js';

const COLW = 2;
const COLS = 5;               // columns -2..2
const ROWH = 2.4;
const PATTERN = ['safe', 'road', 'road', 'safe', 'river', 'river', 'safe', 'bank'];
const LIVES = 3;

export default class FrogHopper extends Game {
  start() {
    sky(this.scene, '#173a2a', '#060c09', 30, 110);
    lights(this.scene, { sky: 0xbfe8c8, groundCol: 0x0e2016 });

    this.lanes = [];
    for (let i = 0; i < PATTERN.length; i++) this.buildLane(i);

    this.player = this.add(box(1.0, 0.7, 1.0, glow(PALETTE.lime)));
    this.col = 0;
    this.row = 0;
    this.hopT = 0;
    this.lives = LIVES;
    this.crossings = 0;
    this.speedMul = 1;
    this.placePlayer(true);

    this.burst = new Burst(this.scene, 70, 0.2);
    this.camera.position.set(0, 9, 8);
    this.hud.hint('WASD or arrows to hop one square at a time · ride the logs, dodge the cars');
  }

  buildLane(row) {
    const type = PATTERN[row % PATTERN.length];
    const z = -row * ROWH;
    const width = COLS * COLW + 4;
    if (type !== 'river') {
      const g = this.add(ground(width, type === 'bank' ? 0x2a5f3a : type === 'road' ? 0x24242c : 0x1c3a26));
      g.position.set(0, -0.02, z);
    } else {
      const w = this.add(box(width, 0.3, ROWH * 0.92, mat(0x1a3f6e, { roughness: 0.3 })));
      w.position.set(0, -0.1, z);
    }

    const items = [];
    if (type === 'road' || type === 'river') {
      const dir = row % 2 === 0 ? 1 : -1;
      const n = type === 'road' ? 3 : 3;
      for (let i = 0; i < n; i++) {
        const item = type === 'road'
          ? box(1.6, 0.6, 1.1, PALETTE.red)
          : cyl(0.45, 0.45, 1.8, mat(0x6b4a2c), { });
        if (type === 'river') item.rotation.z = Math.PI / 2;
        item.position.set(-width / 2 + i * (width / n) + rand(-0.5, 0.5), type === 'road' ? 0.3 : 0.05, z);
        item.userData = { dir, speed: rand(2.4, 3.6), width };
        items.push(this.add(item));
      }
    }
    this.lanes.push({ row, type, z, width, items });
  }

  laneAt(row) { return this.lanes[((row % this.lanes.length) + this.lanes.length) % this.lanes.length]; }

  placePlayer(reset) {
    if (reset) { this.col = 0; this.row = 0; }
    this.player.userData.targetX = (this.col - (COLS - 1) / 2) * COLW;
    this.player.userData.targetZ = -this.row * ROWH;
    if (reset) {
      this.player.position.set(this.player.userData.targetX, 0.45, this.player.userData.targetZ);
    }
  }

  hop(dcol, drow) {
    const nc = clamp(this.col + dcol, 0, COLS - 1);
    const nr = Math.max(0, this.row + drow);
    if (nc === this.col && nr === this.row) return;
    this.col = nc;
    this.row = nr;
    this.hopT = 1;
    this.audio.blip(2);
    this.player.userData.targetX = (this.col - (COLS - 1) / 2) * COLW;
    this.player.userData.targetZ = -this.row * ROWH;
  }

  update(dt) {
    if (this.input.hit('KeyW', 'ArrowUp')) this.hop(0, 1);
    else if (this.input.hit('KeyS', 'ArrowDown')) this.hop(0, -1);
    else if (this.input.hit('KeyA', 'ArrowLeft')) this.hop(-1, 0);
    else if (this.input.hit('KeyD', 'ArrowRight')) this.hop(1, 0);

    this.hopT = Math.max(0, this.hopT - dt * 6);
    const p = this.player;
    p.position.x = damp(p.position.x, p.userData.targetX, 14, dt);
    p.position.z = damp(p.position.z, p.userData.targetZ, 14, dt);
    p.position.y = 0.45 + Math.sin(this.hopT * Math.PI) * 0.7;

    const lane = this.laneAt(this.row);
    for (const l of this.lanes) {
      for (const it of l.items) {
        it.position.x += it.userData.dir * it.userData.speed * this.speedMul * dt;
        const half = it.userData.width / 2 + 1;
        if (it.position.x > half) it.position.x = -half;
        if (it.position.x < -half) it.position.x = half;
      }
    }

    if (lane.type === 'road') {
      for (const it of lane.items) {
        if (Math.abs(it.position.x - p.position.x) < 1.05 && this.hopT < 0.3) return this.hit();
      }
    } else if (lane.type === 'river') {
      let onLog = null;
      for (const it of lane.items) {
        if (Math.abs(it.position.x - p.position.x) < 1.1) onLog = it;
      }
      if (onLog) {
        p.userData.targetX += onLog.userData.dir * onLog.userData.speed * this.speedMul * dt;
        // Ride a log off the edge of the river and you go in with it.
        if (Math.abs(p.userData.targetX) > lane.width / 2) return this.hit();
      } else if (this.hopT < 0.3) {
        return this.hit();
      }
    }

    if (lane.type === 'bank' && this.hopT === 0 && this.row > 0) {
      this.crossings++;
      this.speedMul = 1 + this.crossings * 0.12;
      this.audio.good();
      this.hud.toast(`CROSSED (${this.crossings})`, 800);
      this.placePlayer(true);
    }

    this.burst.update(dt);
    chase(this.camera, p, new THREE.Vector3(0, 8.5, 8), dt, 4,
      new THREE.Vector3(0, 0.5, p.position.z - 4));

    this.hud.stat('Crossings', this.crossings);
    this.hud.stat('Lives', '●'.repeat(Math.max(0, this.lives)) || '—', this.lives === 1);
  }

  hit() {
    this.lives--;
    this.burst.burst(this.player.position, PALETTE.red, 18, 7);
    this.audio.bad();
    if (this.lives <= 0) {
      this.audio.lose();
      return this.end(this.crossings, `You made it across ${this.crossings} times.`);
    }
    this.placePlayer(true);
  }
}
