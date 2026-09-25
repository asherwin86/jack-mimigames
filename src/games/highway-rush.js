import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const LANES = [-6, -3, 0, 3, 6];
const SPAWN_Z = -110;
const CAR_COLS = [0xd94a4a, 0x4a86d9, 0xd9b54a, 0x5ad98a, 0xb04ad9, 0xe8e8e8];

function makeCar(col, len = 4.2) {
  const g = new THREE.Group();
  const body = box(1.9, 0.8, len, mat(col, { roughness: 0.4 }));
  body.position.y = 0.6;
  const cab = box(1.6, 0.6, len * 0.5, mat(0x1a1e28));
  cab.position.set(0, 1.25, 0.1);
  g.add(body, cab);
  return g;
}

export default class HighwayRush extends Game {
  start() {
    sky(this.scene, '#1d2a4a', '#0b1020', 30, 130);
    lights(this.scene, { sky: 0xbfd0ff, groundCol: 0x10162a });
    const road = ground(400, 0x1c1f28);
    road.position.z = -120;
    this.add(road);
    this.marks = [];
    for (const x of [-4.5, -1.5, 1.5, 4.5]) {
      for (let i = 0; i < 14; i++) {
        const m = box(0.18, 0.02, 3, mat(0xdddddd), { cast: false });
        m.position.set(x, 0.02, -i * 10);
        this.marks.push(this.add(m));
      }
    }
    for (const x of [-8, 8]) {
      const e = box(0.3, 0.3, 300, glow(PALETTE.amber, { emissiveIntensity: 0.8 }), { cast: false });
      e.position.set(x, 0.2, -100);
      this.add(e);
    }

    this.player = makeCar(0x2fe0d8, 4.2);
    this.player.position.set(0, 0, 0);
    this.add(this.player);
    this.lane = 2;
    this.laneX = 0;
    this.traffic = [];
    this.burst = new Burst(this.scene, 60, 0.2);
    this.speed = 22;
    this.distance = 0;
    this.bonus = 0;
    this.combo = 0;
    this.spawnT = 0.8;
    this.camera.position.set(0, 5, 10);
    this.camera.lookAt(0, 1.2, -14);
    this.hud.hint('A / D or arrows to change lane · W speeds up, S brakes · squeeze past cars for near-miss bonuses (each chained one is worth more) · don\'t crash');
  }

  spawnCar() {
    // Never fill every lane at the same depth: leave at least one gap.
    const lane = Math.floor(Math.random() * LANES.length);
    const nearby = this.traffic.filter((t) => Math.abs(t.mesh.position.z - SPAWN_Z) < 14);
    if (nearby.length >= LANES.length - 2 || nearby.some((t) => t.lane === lane)) return;
    const truck = Math.random() < 0.18;
    const car = makeCar(CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)], truck ? 7 : 4.2);
    if (truck) car.scale.y = 1.5;
    car.position.set(LANES[lane], 0, SPAWN_Z);
    this.add(car);
    this.traffic.push({ mesh: car, lane, speed: rand(9, 17), len: truck ? 7 : 4.2, passed: false, near: false });
  }

  update(dt) {
    if (this.finished) return;
    const accel = this.input.key('KeyW', 'ArrowUp') || this.input.gpButton(7) ? 1 : this.input.key('KeyS', 'ArrowDown') || this.input.gpButton(6) ? -1 : 0;
    const base = 22 + Math.min(20, this.distance / 250);
    const targetSpeed = accel > 0 ? base + 12 : accel < 0 ? Math.max(12, base - 12) : base;
    this.speed = damp(this.speed, targetSpeed, 1.6, dt);
    this.distance += this.speed * dt * 0.5;

    // Lane changes: taps of the direction keys (or a hard stick push).
    const left = this.input.hit('KeyA', 'ArrowLeft') || this.input.gpHit(14) || this.input.gpHit(4);
    const right = this.input.hit('KeyD', 'ArrowRight') || this.input.gpHit(15) || this.input.gpHit(5);
    if (left) this.lane = Math.max(0, this.lane - 1);
    if (right) this.lane = Math.min(LANES.length - 1, this.lane + 1);
    const stick = this.input.gpAxis(0);
    if (Math.abs(stick) > 0.7 && !this.stickHeld) { this.lane = clamp(this.lane + Math.sign(stick), 0, LANES.length - 1); this.stickHeld = true; }
    if (Math.abs(stick) < 0.3) this.stickHeld = false;
    this.laneX = damp(this.laneX, LANES[this.lane], 12, dt);
    this.player.position.x = this.laneX;
    this.player.rotation.y = clamp((LANES[this.lane] - this.laneX) * -0.08, -0.25, 0.25);

    for (const m of this.marks) { m.position.z += this.speed * dt; if (m.position.z > 12) m.position.z -= 140; }

    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnCar(); this.spawnT = clamp(0.9 - this.distance / 2500, 0.28, 0.9) * rand(0.7, 1.2); }

    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const t = this.traffic[i];
      const rel = this.speed - t.speed;
      t.mesh.position.z += rel * dt;
      const dz = Math.abs(t.mesh.position.z - this.player.position.z);
      const dx = Math.abs(t.mesh.position.x - this.player.position.x);
      if (dz < t.len / 2 + 2.1 && dx < 1.85) return this.crash(t);
      // A near miss: level with the car in the next lane over, at speed.
      if (!t.near && dz < t.len / 2 + 2.1 && dx < 3.6 && rel > 6) {
        t.near = true;
        this.combo++;
        const pts = 10 * this.combo;
        this.bonus += pts;
        this.hud.toast(`NEAR MISS +${pts}`, 600);
        this.audio.blip(Math.min(12, 2 + this.combo));
      }
      if (t.mesh.position.z > 14) {
        if (!t.near && !t.passed) this.combo = 0;   // let a car go by without a scare and the chain resets
        this.scene.remove(t.mesh);
        this.traffic.splice(i, 1);
      }
    }

    this.burst.update(dt);
    this.hud.stat('Score', Math.floor(this.distance + this.bonus));
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
    this.hud.stat('Chain', this.combo);
  }

  crash(t) {
    this.burst.burst(this.player.position.clone().setY(1), PALETTE.amber, 24, 10);
    this.burst.burst(t.mesh.position.clone().setY(1), PALETTE.red, 14, 8);
    this.player.visible = false;
    this.audio.boom();
    this.audio.lose();
    const total = Math.floor(this.distance + this.bonus);
    this.end(total, `You drove ${Math.floor(this.distance)} m with ${this.bonus} bonus points.`);
  }
}
