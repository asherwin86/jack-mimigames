import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, damp, randInt, PALETTE, COLORS,
} from '../engine/utils.js';

const N = 15;          // grid is N x N cells
const CELL = 1.25;
const OFF = ((N - 1) * CELL) / 2;

export default class SnakeCube extends Game {
  start() {
    sky(this.scene, '#1d3a2e', '#060a08', 28, 90);
    lights(this.scene, { sky: 0xa8ffd8, groundCol: 0x16281f });

    const deck = box(N * CELL + 1, 0.5, N * CELL + 1, mat(0x16241d), { cast: false });
    deck.position.y = -0.3;
    this.add(deck);

    // Faint grid so the discrete cells are readable.
    for (let i = 0; i <= N; i++) {
      const t = -OFF - CELL / 2 + i * CELL;
      for (const axis of ['x', 'z']) {
        const line = box(
          axis === 'x' ? 0.04 : N * CELL, 0.02, axis === 'x' ? N * CELL : 0.04,
          glow(0x2f5c48, { emissiveIntensity: 0.4 }), { cast: false, receive: false },
        );
        line.position.set(axis === 'x' ? t : 0, -0.03, axis === 'x' ? 0 : t);
        this.add(line);
      }
    }

    this.segments = [];
    this.body = [{ x: 7, z: 7 }, { x: 6, z: 7 }, { x: 5, z: 7 }];
    this.body.forEach(() => this.addSegment());

    this.food = this.add(box(0.8, 0.8, 0.8, glow(PALETTE.amber)));
    // A golden apple shows up now and then and vanishes if you dawdle: +3 length, but no speed-up.
    this.gold = this.add(box(0.95, 0.95, 0.95, glow(PALETTE.white, { emissiveIntensity: 1 })));
    this.gold.visible = false;
    this.goldCell = null;
    this.goldLeft = 0;
    this.pendingGrow = 0;
    // Rocks start to appear once you are getting long.
    this.rocks = [];
    this.dir = { x: 1, z: 0 };
    this.queued = [];
    this.tick = 0;
    this.rate = 0.16;
    this.eaten = 0;
    this.burst = new Burst(this.scene, 60, 0.18);
    this.placeFood();

    this.camera.position.set(0, 19, 15);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('Arrows or WASD to turn · eating speeds you up · grab golden apples before they vanish · rocks block the way');
  }

  addSegment() {
    const i = this.segments.length;
    const s = box(0.95, 0.95, 0.95, glow(COLORS[i % COLORS.length], { emissiveIntensity: 0.5 }));
    this.segments.push(this.add(s));
    return s;
  }

  place(mesh, cell, y = 0.5) {
    mesh.position.set(-OFF + cell.x * CELL, y, -OFF + cell.z * CELL);
  }

  /** A random cell nothing is on. */
  freeCell(keepAwayFromHead = 0) {
    const head = this.body[0];
    for (let tries = 0; tries < 200; tries++) {
      const cell = { x: randInt(0, N - 1), z: randInt(0, N - 1) };
      const taken = this.body.some((b) => b.x === cell.x && b.z === cell.z)
        || this.rocks.some((r) => r.cell.x === cell.x && r.cell.z === cell.z)
        || (this.foodCell && this.foodCell.x === cell.x && this.foodCell.z === cell.z)
        || (this.goldCell && this.goldCell.x === cell.x && this.goldCell.z === cell.z);
      if (!taken && Math.abs(cell.x - head.x) + Math.abs(cell.z - head.z) > keepAwayFromHead) return cell;
    }
    return null;
  }

  placeFood() {
    this.foodCell = null;   // so freeCell() doesn't treat the old spot as taken
    const cell = this.freeCell() || { x: 0, z: 0 };
    this.foodCell = cell;
    this.place(this.food, cell, 0.55);
  }

  addRock() {
    const cell = this.freeCell(4);   // never right in front of you
    if (!cell) return;
    const mesh = this.add(box(1.0, 1.1, 1.0, mat(0x6b7a72, { roughness: 0.95 })));
    this.place(mesh, cell, 0.55);
    this.rocks.push({ cell, mesh });
  }

  spawnGold() {
    const cell = this.freeCell(2);
    if (!cell) return;
    this.goldCell = cell;
    this.goldLeft = 7;
    this.place(this.gold, cell, 0.55);
    this.gold.visible = true;
    this.hud.toast('GOLDEN APPLE', 800);
    this.audio.tone([900, 1300], 0.14, { type: 'triangle', gain: 0.12 });
  }

  hideGold() {
    this.goldCell = null;
    this.gold.visible = false;
  }

  update(dt) {
    // Queue turns so a fast double-tap isn't swallowed between ticks.
    // axisX()/axisY() only blend keyboard and the left stick, never the
    // D-pad, so a D-pad-only press needs its own direction here too.
    let x = this.input.axisX();
    let z = -this.input.axisY();
    if (this.input.gpHit(14)) x = -1;
    else if (this.input.gpHit(15)) x = 1;
    else if (this.input.gpHit(12)) z = 1;
    else if (this.input.gpHit(13)) z = -1;
    if (this.input.hit('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')
      || this.input.gpHit(12) || this.input.gpHit(13) || this.input.gpHit(14) || this.input.gpHit(15)) {
      const want = x !== 0 ? { x, z: 0 } : { x: 0, z };
      const last = this.queued[this.queued.length - 1] || this.dir;
      if ((want.x || want.z) && !(want.x === -last.x && want.z === -last.z) && this.queued.length < 2) {
        this.queued.push(want);
      }
    }

    this.tick += dt;
    if (this.tick >= this.rate) {
      this.tick -= this.rate;
      this.step();
      if (this.finished) return;
    }

    // Smoothly settle the meshes onto their cells; the sim itself is discrete.
    this.body.forEach((cell, i) => {
      const s = this.segments[i];
      if (!s) return;
      const tx = -OFF + cell.x * CELL;
      const tz = -OFF + cell.z * CELL;
      s.position.x = damp(s.position.x, tx, 22, dt);
      s.position.z = damp(s.position.z, tz, 22, dt);
      s.position.y = 0.5 + Math.sin(this.time * 6 - i * 0.4) * 0.06;
    });

    if (this.goldCell) {
      this.goldLeft -= dt;
      this.gold.rotation.y -= dt * 3;
      this.gold.position.y = 0.6 + Math.sin(this.time * 6) * 0.15;
      this.gold.visible = this.goldLeft > 2 || Math.sin(this.time * 24) > 0;   // flickers when about to go
      if (this.goldLeft <= 0) this.hideGold();
    }
    this.food.rotation.y += dt * 2.5;
    this.food.position.y = 0.55 + Math.sin(this.time * 3) * 0.12;
    this.burst.update(dt);

    this.hud.stat('Length', this.body.length);
    this.hud.stat('Eaten', this.eaten);
    this.hud.stat('Speed', `${(1 / this.rate).toFixed(1)}/s`);
    if (this.goldCell) this.hud.stat('Gold', `${Math.ceil(this.goldLeft)}s`, this.goldLeft < 3);
    else this.hud.removeStat('Gold');
  }

  step() {
    if (this.queued.length) this.dir = this.queued.shift();
    const head = this.body[0];
    const next = { x: head.x + this.dir.x, z: head.z + this.dir.z };

    if (next.x < 0 || next.x >= N || next.z < 0 || next.z >= N) return this.die('Hit the edge.');
    // The tail cell frees up this tick, so it is fair game.
    if (this.body.slice(0, -1).some((b) => b.x === next.x && b.z === next.z)) {
      return this.die('Ate yourself.');
    }
    if (this.rocks.some((r) => r.cell.x === next.x && r.cell.z === next.z)) return this.die('Hit a rock.');

    this.body.unshift(next);
    if (next.x === this.foodCell.x && next.z === this.foodCell.z) {
      this.eaten++;
      this.rate = Math.max(0.06, this.rate * 0.96);
      const s = this.addSegment();
      this.place(s, this.body[this.body.length - 1]);
      this.burst.burst(this.food.position, PALETTE.amber, 10, 5);
      this.audio.pickup();
      this.placeFood();
      if (this.eaten >= 4 && this.eaten % 2 === 0 && this.rocks.length < 6) this.addRock();
      if (this.eaten % 4 === 0 && !this.goldCell) this.spawnGold();
    } else if (this.goldCell && next.x === this.goldCell.x && next.z === this.goldCell.z) {
      this.pendingGrow += 2;   // this step's growth plus two more
      this.burst.burst(this.gold.position, PALETTE.white, 16, 6);
      this.audio.good();
      this.hud.toast('+3 LENGTH', 700);
      this.hideGold();
      this.growTail();
    } else if (this.pendingGrow > 0) {
      this.pendingGrow--;
      this.growTail();
    } else {
      this.body.pop();
    }
  }

  /** Keeps the tail this tick (the snake gets one longer) and gives it a mesh. */
  growTail() {
    const s = this.addSegment();
    this.place(s, this.body[this.body.length - 1]);
  }

  die(why) {
    this.audio.lose();
    this.burst.burst(this.segments[0].position, PALETTE.red, 18, 7);
    this.end(this.body.length, `${why} Final length ${this.body.length}.`);
  }
}
