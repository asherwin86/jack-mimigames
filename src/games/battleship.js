import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, Burst, damp, randInt, shuffle, PALETTE,
} from '../engine/utils.js';

const N = 8;
const SIZE = 1.8;
const OFF = ((N - 1) * SIZE) / 2;
const FLEET = [5, 4, 3, 3, 2];

export default class Battleship extends Game {
  start() {
    sky(this.scene, '#0e3a5c', '#04121e', 40, 110);
    lights(this.scene, { sky: 0xbfe6ff, groundCol: 0x0a2438 });
    this.add(ground(80, 0x08243a));

    this.cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = box(SIZE - 0.12, 0.3, SIZE - 0.12, mat(0x1e6fa8, { roughness: 0.3 }), { cast: false });
        cell.position.set(c * SIZE - OFF, 0.1, r * SIZE - OFF);
        cell.userData = { r, c, shot: false, ship: -1 };
        this.cells.push(this.add(cell));
      }
    }
    this.ships = [];
    this.placeFleet();
    this.pegs = [];
    this.burst = new Burst(this.scene, 70, 0.2);
    this.shots = 0;
    this.hits = 0;
    this.showCursor = true;

    this.camera.position.set(0, 16, 9);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('Click a square to fire · find and sink all five hidden ships in as few shots as you can');
  }

  cell(r, c) { return this.cells[r * N + c]; }

  /** Random, non-overlapping placement of the whole fleet. */
  placeFleet() {
    for (let attempt = 0; attempt < 500; attempt++) {
      const taken = new Set();
      const ships = [];
      let ok = true;
      for (const len of FLEET) {
        let placed = false;
        for (let t = 0; t < 60 && !placed; t++) {
          const horizontal = Math.random() < 0.5;
          const r = randInt(0, horizontal ? N - 1 : N - len);
          const c = randInt(0, horizontal ? N - len : N - 1);
          const cells = Array.from({ length: len }, (_, k) => [horizontal ? r : r + k, horizontal ? c + k : c]);
          if (cells.some(([y, x]) => taken.has(`${y},${x}`))) continue;
          cells.forEach(([y, x]) => taken.add(`${y},${x}`));
          ships.push({ len, cells, hits: 0, sunk: false });
          placed = true;
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) {
        this.ships = ships;
        ships.forEach((s, i) => s.cells.forEach(([y, x]) => { this.cell(y, x).userData.ship = i; }));
        return;
      }
    }
  }

  /** Fires at a square. Returns 'hit', 'miss', 'sunk' or null if it was already shot. */
  fire(r, c) {
    if (r < 0 || c < 0 || r >= N || c >= N) return null;
    const cell = this.cell(r, c);
    if (!cell || cell.userData.shot || this.finished) return null;
    cell.userData.shot = true;
    this.shots++;
    const peg = box(0.5, 0.5, 0.5, glow(0xffffff, { emissiveIntensity: 0.5 }));
    peg.position.set(cell.position.x, 0.5, cell.position.z);
    this.pegs.push(this.add(peg));
    const si = cell.userData.ship;
    if (si < 0) {
      peg.material.color.setHex(0xdfe8f5);
      peg.scale.set(0.5, 0.5, 0.5);
      this.audio.tone(200, 0.08, { type: 'sine', gain: 0.08 });
      return 'miss';
    }
    const ship = this.ships[si];
    ship.hits++;
    this.hits++;
    peg.material.color.setHex(PALETTE.red);
    peg.material.emissive.setHex(PALETTE.red);
    this.burst.burst(peg.position, PALETTE.amber, 12, 6);
    this.audio.boom();
    if (ship.hits >= ship.len) {
      ship.sunk = true;
      for (const [y, x] of ship.cells) this.cell(y, x).material.color.setHex(0x4a5468);
      this.hud.toast(`SUNK · length ${ship.len}`, 1000);
      this.audio.win();
      if (this.ships.every((s) => s.sunk)) this.finish();
      return 'sunk';
    }
    this.hud.toast('HIT', 500);
    return 'hit';
  }

  update(dt) {
    if (this.clickedNow()) {
      const hit = this.pickAt(this.cells);
      if (hit) this.fire(hit.object.userData.r, hit.object.userData.c);
    }
    const over = this.pickAt(this.cells);
    for (const cell of this.cells) {
      const hovered = over && over.object === cell && !cell.userData.shot;
      cell.position.y = damp(cell.position.y, hovered ? 0.3 : 0.1, 16, dt);
    }
    this.burst.update(dt);
    this.hud.stat('Shots', this.shots);
    this.hud.stat('Hits', this.hits);
    this.hud.stat('Sunk', `${this.ships.filter((s) => s.sunk).length}/${this.ships.length}`);
  }

  finish() {
    this.audio.win();
    this.end(this.shots, `Fleet sunk in ${this.shots} shots.`);
  }
}
