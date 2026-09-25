import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, randInt, PALETTE, COLORS,
} from '../engine/utils.js';

const LOT_W = 42;           // x extent
const LOT_D = 26;           // z extent
const BAY_W = 3.4;
const BAY_D = 6;
const BAYS = 9;             // per row
const ROW_Z = [-(LOT_D / 2) + BAY_D / 2 + 0.5, (LOT_D / 2) - BAY_D / 2 - 0.5];
const START_TIME = 50;
const PARK_BONUS = 18;
const CAR_LEN = 4.0;
const CAR_WID = 1.9;

const bayCentre = (row, i) => ({ x: (i - (BAYS - 1) / 2) * BAY_W, z: ROW_Z[row] });

export default class ParkingPanic extends Game {
  start() {
    sky(this.scene, '#5a7aa8', '#c8d8ee', 60, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x6a7a90, intensity: 1.05 });
    const asphalt = this.add(ground(LOT_W + 30, 0x2f333c));
    asphalt.position.y = -0.02;

    // Bay lines
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i <= BAYS; i++) {
        const line = box(0.12, 0.03, BAY_D, mat(0xdde3ee), { cast: false, receive: false });
        line.position.set((i - BAYS / 2) * BAY_W, 0.01, ROW_Z[row]);
        this.add(line);
      }
    }
    // Kerbs round the lot
    for (const [w, d, x, z] of [[LOT_W + 2, 1, 0, -LOT_D / 2 - 0.5], [LOT_W + 2, 1, 0, LOT_D / 2 + 0.5], [1, LOT_D, -LOT_W / 2 - 0.5, 0], [1, LOT_D, LOT_W / 2 + 0.5, 0]]) {
      const k = box(w, 0.9, d, mat(0x8a93a6));
      k.position.set(x, 0.45, z);
      this.add(k);
    }

    this.car = this.add(this.makeCar(PALETTE.lime));
    this.marker = this.add(box(BAY_W - 0.3, 0.05, BAY_D - 0.4, glow(PALETTE.lime, { emissiveIntensity: 0.9, transparent: true, opacity: 0.45 }), { cast: false }));
    this.parked = [];
    this.obstacles = [];      // { x, z, hw, hd } — static parked cars
    this.burst = new Burst(this.scene, 60, 0.2);
    this.score = 0;
    this.timeLeft = START_TIME;
    this.bumpCool = 0;
    this.newLot();

    this.camera.position.set(0, 34, 14);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('W / S throttle and reverse · A / D steer · pull into the green bay, straight, and stop · bumps cost time');
  }

  makeCar(color) {
    const g = new THREE.Group();
    const body = box(CAR_WID, 0.8, CAR_LEN, mat(color, { roughness: 0.4 }));
    body.position.y = 0.6;
    const cab = box(CAR_WID * 0.8, 0.6, CAR_LEN * 0.45, mat(0x1e2532, { roughness: 0.3 }));
    cab.position.set(0, 1.2, -0.2);
    g.add(body, cab);
    return g;
  }

  newLot() {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    this.obstacles = [];
    // pick the free bay, fill most of the others with parked cars
    this.targetRow = randInt(0, 1);
    this.targetIdx = randInt(1, BAYS - 2);
    this.target = bayCentre(this.targetRow, this.targetIdx);
    this.marker.position.set(this.target.x, 0.03, this.target.z);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < BAYS; i++) {
        if (row === this.targetRow && i === this.targetIdx) continue;
        const beside = row === this.targetRow && Math.abs(i - this.targetIdx) === 1;
        if (!beside && Math.random() > 0.55) continue;      // (the two bays next to the target are always taken)
        const c = bayCentre(row, i);
        const car = this.makeCar(COLORS[randInt(0, COLORS.length - 1)]);
        car.position.set(c.x + rand(-0.1, 0.1), 0, c.z);
        car.rotation.y = (row === 0 ? 0 : Math.PI) + rand(-0.04, 0.04);
        this.add(car);
        this.obstacles.push({ x: c.x, z: c.z, hw: CAR_WID / 2 + 0.05, hd: CAR_LEN / 2, mesh: car });
      }
    }
    // The player's car begins in the aisle, pointing along it.
    this.pos = new THREE.Vector2(rand(-8, 8), 0);
    this.heading = Math.PI / 2;        // 0 = facing +Z; the car starts pointing along +X
    this.speed = 0;
    this.stillFor = 0;
    this.placeCar();
  }

  placeCar() {
    this.car.position.set(this.pos.x, 0, this.pos.y);
    this.car.rotation.y = this.heading;
  }

  /** Three circles down the car's length, tested against every parked car and the lot's edge. */
  collide() {
    let hit = false;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    for (const off of [-1.3, 0, 1.3]) {
      const cx = this.pos.x + fx * off;
      const cz = this.pos.y + fz * off;
      const r = CAR_WID / 2;
      const push = (nx, nz, depth) => { this.pos.x += nx * depth; this.pos.y += nz * depth; hit = true; };
      for (const o of this.obstacles) {
        // circle vs the parked car's box (they are parked roughly along Z, so an axis-aligned box is close enough)
        const dx = clamp(cx, o.x - o.hw, o.x + o.hw) - cx;
        const dz = clamp(cz, o.z - o.hd, o.z + o.hd) - cz;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          if (d > 1e-4) push(-dx / d, -dz / d, r - d);
          else push(0, cz < o.z ? -1 : 1, r);
        }
      }
      if (cx < -LOT_W / 2 + r) push(1, 0, -LOT_W / 2 + r - cx);
      if (cx > LOT_W / 2 - r) push(-1, 0, cx - (LOT_W / 2 - r));
      if (cz < -LOT_D / 2 + r) push(0, 1, -LOT_D / 2 + r - cz);
      if (cz > LOT_D / 2 - r) push(0, -1, cz - (LOT_D / 2 - r));
    }
    return hit;
  }

  update(dt) {
    this.timeLeft -= dt;
    this.bumpCool = Math.max(0, this.bumpCool - dt);
    if (this.timeLeft <= 0) return this.finish();

    const throttle = this.input.axisY();
    const steer = this.input.axisX();
    if (throttle > 0) this.speed += 14 * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0.4 ? 22 : 9) * dt;
    else this.speed = damp(this.speed, 0, 3.2, dt);
    this.speed = clamp(this.speed, -6, 11);

    // Steering only turns you while you move (like a real car); reversing flips it.
    const turnRate = clamp(Math.abs(this.speed) / 4, 0, 1) * 1.7;
    this.heading -= steer * turnRate * Math.sign(this.speed || 1) * dt;
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.y += Math.cos(this.heading) * this.speed * dt;

    if (this.collide()) {
      if (Math.abs(this.speed) > 2 && this.bumpCool <= 0) {
        this.timeLeft -= 2;
        this.bumpCool = 0.9;
        this.burst.burst({ x: this.pos.x, y: 0.8, z: this.pos.y }, PALETTE.amber, 10, 6);
        this.audio.thud();
        this.hud.toast('BUMP · -2 s', 500);
      }
      this.speed *= 0.4;
    }
    this.placeCar();

    // Parked? Inside the bay, lined up with it, and stopped for a moment.
    const dx = this.pos.x - this.target.x;
    const dz = this.pos.y - this.target.z;
    const axis = this.targetRow === 0 ? 0 : Math.PI;
    let da = ((this.heading - axis) % Math.PI + Math.PI) % Math.PI;       // pointing either way along the bay is fine
    if (da > Math.PI / 2) da -= Math.PI;
    const inside = Math.abs(dx) < (BAY_W - CAR_WID) / 2 + 0.2 && Math.abs(dz) < 1.2 && Math.abs(da) < 0.2;
    if (inside && Math.abs(this.speed) < 0.7) this.stillFor += dt; else this.stillFor = 0;
    this.marker.material.color.setHex(inside ? PALETTE.lime : PALETTE.amber);
    this.marker.material.emissive.setHex(inside ? PALETTE.lime : PALETTE.amber);
    if (this.stillFor > 0.7) this.parkedOk();

    this.burst.update(dt);
    this.hud.stat('Parked', this.score);
    this.hud.stat('Time', this.timeLeft.toFixed(1), this.timeLeft < 10);
    this.hud.stat('Speed', `${Math.abs(this.speed * 3.6).toFixed(0)} kph`);
  }

  parkedOk() {
    this.score++;
    this.timeLeft += PARK_BONUS;
    this.audio.win();
    this.hud.toast(`PARKED · +${PARK_BONUS} s`, 900);
    this.burst.burst({ x: this.target.x, y: 0.8, z: this.target.z }, PALETTE.lime, 26, 8);
    // the car you just parked stays put as a new obstacle for this lot only, then the lot is refreshed
    this.newLot();
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `${this.score} car${this.score === 1 ? '' : 's'} parked.`);
  }
}
