import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, lights, sky, glow, mat, damp, PALETTE,
} from '../engine/utils.js';

const HALF = 10;          // board half-extent in local units
const R = 0.55;           // marble radius
const MAX_TILT = 0.34;    // radians
const G = 26;             // gravity along the board
const START = { x: -8, z: 8.4 };
const GOAL = { x: 0, z: -8.4, r: 1.15 };

// [centreX, centreZ, width, depth] in board-local space.
const WALLS = [
  [0, -HALF, HALF * 2, 0.6], [0, HALF, HALF * 2, 0.6],
  [-HALF, 0, 0.6, HALF * 2], [HALF, 0, 0.6, HALF * 2],
  [-2, 6, 16, 0.6],
  [2, 2, 16, 0.6],
  [-2, -2, 16, 0.6],
  [2, -6, 16, 0.6],
  [-4.5, 4, 0.6, 3.4],
  [4.5, 0, 0.6, 3.4],
  [-4.5, -4, 0.6, 3.4],
];

const HOLES = [
  [-8, 4], [-1.5, 4.6], [7.5, 3.6], [8.6, 0.2], [0.5, -0.2],
  [-8.4, -0.4], [-6, -4.4], [2.5, -4.2], [8, -8], [-4, -8.2],
];

export default class MarbleMaze extends Game {
  start() {
    sky(this.scene, '#2a3f66', '#080b14', 25, 85);
    lights(this.scene, { sky: 0xcfe4ff, groundCol: 0x1b2440 });

    this.board = this.add(new THREE.Group());

    const deck = box(HALF * 2, 0.5, HALF * 2, mat(0x243156, { roughness: 0.85 }), { cast: false });
    deck.position.y = -0.25;
    this.board.add(deck);

    for (const [x, z, w, d] of WALLS) {
      const wall = box(w, 1.1, d, mat(0x39508a));
      wall.position.set(x, 0.55, z);
      this.board.add(wall);
    }

    // Holes are drawn as dark sockets punched into the deck.
    this.holes = HOLES.map(([x, z]) => {
      const h = cyl(0.95, 0.95, 0.62, mat(0x05070d, { roughness: 1 }), { cast: false });
      h.position.set(x, -0.24, z);
      this.board.add(h);
      return { x, z, r: 0.95 };
    });

    const goal = cyl(GOAL.r, GOAL.r, 0.16, glow(PALETTE.lime), { cast: false });
    goal.position.set(GOAL.x, 0.08, GOAL.z);
    this.board.add(goal);
    this.goalMesh = goal;

    this.marble = ball(R, glow(PALETTE.amber, { emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.25 }));
    this.board.add(this.marble);

    this.tilt = new THREE.Vector2(0, 0);
    this.falls = 0;
    this.elapsed = 0;
    this.reset();

    this.camera.position.set(0, 21, 15);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('WASD / arrows tilt the board · a hole costs you 3 seconds');
  }

  reset() {
    this.pos = new THREE.Vector2(START.x, START.z);
    this.vel = new THREE.Vector2(0, 0);
    this.marble.position.set(START.x, R, START.z);
  }

  update(dt) {
    this.elapsed += dt;

    // Tilt eases toward the held direction so the board feels weighty.
    const tx = this.input.axisX();
    const tz = -this.input.axisY();
    this.tilt.x = damp(this.tilt.x, tx, 7, dt);
    this.tilt.y = damp(this.tilt.y, tz, 7, dt);
    this.board.rotation.z = -this.tilt.x * MAX_TILT;
    this.board.rotation.x = this.tilt.y * MAX_TILT;

    // Integrate in board-local 2D, then collide.
    this.vel.x += G * Math.sin(this.tilt.x * MAX_TILT) * dt;
    this.vel.y += G * Math.sin(this.tilt.y * MAX_TILT) * dt;
    this.vel.multiplyScalar(Math.exp(-1.15 * dt));       // rolling friction

    const step = Math.min(dt, 1 / 60);
    this.pos.x += this.vel.x * step;
    this.collideAxis('x');
    this.pos.y += this.vel.y * step;
    this.collideAxis('y');

    this.marble.position.set(this.pos.x, R, this.pos.y);
    this.marble.rotation.z -= this.vel.x * dt / R;
    this.marble.rotation.x += this.vel.y * dt / R;

    // Holes swallow the marble once it is more than half over the lip.
    for (const h of this.holes) {
      if (Math.hypot(this.pos.x - h.x, this.pos.y - h.z) < h.r * 0.7) return this.fall();
    }

    this.goalMesh.material.emissiveIntensity = 0.7 + Math.sin(this.time * 5) * 0.3;
    if (Math.hypot(this.pos.x - GOAL.x, this.pos.y - GOAL.z) < GOAL.r) return this.win();

    this.hud.stat('Time', this.elapsed.toFixed(1));
    this.hud.stat('Falls', this.falls, this.falls > 0);
    this.hud.stat('Speed', this.vel.length().toFixed(1));
  }

  /** Circle-vs-AABB resolution, one axis at a time. */
  collideAxis(axis) {
    for (const [cx, cz, w, d] of WALLS) {
      const hx = w / 2 + R;
      const hz = d / 2 + R;
      const dx = this.pos.x - cx;
      const dz = this.pos.y - cz;
      if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue;

      if (axis === 'x') {
        this.pos.x = cx + Math.sign(dx || 1) * hx;
        if (Math.abs(this.vel.x) > 6) this.audio.thud();
        this.vel.x *= -0.32;
      } else {
        this.pos.y = cz + Math.sign(dz || 1) * hz;
        if (Math.abs(this.vel.y) > 6) this.audio.thud();
        this.vel.y *= -0.32;
      }
    }
  }

  fall() {
    this.falls++;
    this.elapsed += 3;
    this.audio.bad();
    this.hud.toast('+3s', 700);
    this.reset();
  }

  win() {
    this.audio.win();
    const t = Math.round(this.elapsed * 10) / 10;
    this.end(t, `Cleared in ${t}s with ${this.falls} fall${this.falls === 1 ? '' : 's'}.`);
  }
}
