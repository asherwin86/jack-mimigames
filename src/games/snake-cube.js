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
    this.dir = { x: 1, z: 0 };
    this.queued = [];
    this.tick = 0;
    this.rate = 0.16;
    this.eaten = 0;
    this.burst = new Burst(this.scene, 60, 0.18);
    this.placeFood();

    this.camera.position.set(0, 19, 15);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('Arrows or WASD to turn · eating speeds you up');
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

  placeFood() {
    let cell;
    do {
      cell = { x: randInt(0, N - 1), z: randInt(0, N - 1) };
    } while (this.body.some((b) => b.x === cell.x && b.z === cell.z));
    this.foodCell = cell;
    this.place(this.food, cell, 0.55);
  }

  update(dt) {
    // Queue turns so a fast double-tap isn't swallowed between ticks.
    const x = this.input.axisX();
    const z = -this.input.axisY();
    if (this.input.hit('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD', 'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')) {
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

    this.food.rotation.y += dt * 2.5;
    this.food.position.y = 0.55 + Math.sin(this.time * 3) * 0.12;
    this.burst.update(dt);

    this.hud.stat('Length', this.body.length);
    this.hud.stat('Eaten', this.eaten);
    this.hud.stat('Speed', `${(1 / this.rate).toFixed(1)}/s`);
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

    this.body.unshift(next);
    if (next.x === this.foodCell.x && next.z === this.foodCell.z) {
      this.eaten++;
      this.rate = Math.max(0.06, this.rate * 0.96);
      const s = this.addSegment();
      this.place(s, this.body[this.body.length - 1]);
      this.burst.burst(this.food.position, PALETTE.amber, 10, 5);
      this.audio.pickup();
      this.placeFood();
    } else {
      this.body.pop();
    }
  }

  die(why) {
    this.audio.lose();
    this.burst.burst(this.segments[0].position, PALETTE.red, 18, 7);
    this.end(this.body.length, `${why} Final length ${this.body.length}.`);
  }
}
