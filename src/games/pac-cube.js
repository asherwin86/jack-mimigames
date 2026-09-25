import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, damp, PALETTE,
} from '../engine/utils.js';

const MAP = [
  '###############',
  '#o.....#.....o#',
  '#.###.###.###.#',
  '#.............#',
  '#.###.#.#.###.#',
  '#.....#.#.....#',
  '#.###.###.###.#',
  '#o...........o#',
  '###############',
];
const W = MAP[0].length;
const H = MAP.length;
const CELL = 1.6;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const GHOST_COLORS = [PALETTE.red, PALETTE.pink, PALETTE.amber];
const GHOST_HOMES = [[7, 3], [1, 3], [13, 3]];
const PLAYER_SPEED = 5.2;
const GHOST_SPEED = 4;
const FRIGHT_TIME = 7;

const open = (c, r) => r >= 0 && r < H && c >= 0 && c < W && MAP[r][c] !== '#';
const worldOf = (c, r) => [(c - (W - 1) / 2) * CELL, (r - (H - 1) / 2) * CELL];

/** A walker that moves cell to cell: `cell` is where it is, `to` where it is heading, `t` how far along (0 to 1). */
function walker(c, r) { return { c, r, tc: c, tr: r, t: 1, dir: null }; }

export default class PacCube extends Game {
  start() {
    sky(this.scene, '#101a4a', '#04060f', 40, 110);
    lights(this.scene, { sky: 0xb0c0ff, groundCol: 0x0c1230 });
    this.add(ground(70, 0x080b1c));

    const wallMat = mat(0x2a3bb0, { roughness: 0.5 });
    this.pellets = new Map();
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const [x, z] = worldOf(c, r);
        if (MAP[r][c] === '#') {
          const w = box(CELL, 1.3, CELL, wallMat);
          w.position.set(x, 0.65, z);
          this.add(w);
        } else {
          const big = MAP[r][c] === 'o';
          const p = big
            ? ball(0.38, glow(PALETTE.white, { emissiveIntensity: 1 }), { seg: 10 })
            : ball(0.14, glow(PALETTE.amber, { emissiveIntensity: 0.9 }), { seg: 8 });
          p.position.set(x, 0.5, z);
          p.userData = { big };
          this.pellets.set(`${c},${r}`, this.add(p));
        }
      }
    }
    this.totalPellets = this.pellets.size;

    this.pac = this.add(ball(0.62, glow(PALETTE.lime, { emissiveIntensity: 0.6 })));
    this.me = walker(7, 7);
    this.wantDir = null;
    this.ghosts = GHOST_HOMES.map(([c, r], i) => {
      const g = box(1.1, 1.1, 1.1, glow(GHOST_COLORS[i], { emissiveIntensity: 0.6 }));
      this.add(g);
      return { mesh: g, w: walker(c, r), color: GHOST_COLORS[i], home: [c, r], delay: i * 1.5 };
    });

    this.burst = new Burst(this.scene, 80, 0.2);
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.fright = 0;
    this.eatenStreak = 0;
    this.invuln = 1.5;
    this.place();

    this.camera.position.set(0, 20, 9);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('WASD or arrows to steer · eat every pellet · big pellets let you eat the ghosts');
  }

  place() {
    const [x, z] = worldOf(this.me.c, this.me.r);
    this.pac.position.set(x, 0.62, z);
    for (const g of this.ghosts) {
      const [gx, gz] = worldOf(g.w.c, g.w.r);
      g.mesh.position.set(gx, 0.6, gz);
    }
  }

  /** Moves a walker along its heading; returns true on the frame it arrives at a cell centre (time to choose a new way). */
  advance(w, speed, dt) {
    if (w.t >= 1) return true;
    w.t += (speed / CELL) * dt;
    if (w.t >= 1) { w.c = w.tc; w.r = w.tr; w.t = 1; return true; }
    return false;
  }

  head(w, dir) {
    const [dc, dr] = DIRS[dir];
    if (!open(w.c + dc, w.r + dr)) return false;
    w.tc = w.c + dc; w.tr = w.r + dr; w.t = 0; w.dir = dir;
    return true;
  }

  update(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.fright = Math.max(0, this.fright - dt);
    if (this.fright === 0) this.eatenStreak = 0;

    // Steering: remember the latest turn wanted.
    if (this.input.hit('KeyW', 'ArrowUp') || this.input.gpHit(12)) this.wantDir = 'up';
    else if (this.input.hit('KeyS', 'ArrowDown') || this.input.gpHit(13)) this.wantDir = 'down';
    else if (this.input.hit('KeyA', 'ArrowLeft') || this.input.gpHit(14)) this.wantDir = 'left';
    else if (this.input.hit('KeyD', 'ArrowRight') || this.input.gpHit(15)) this.wantDir = 'right';
    else {
      const ax = this.input.axisX();
      const ay = this.input.axisY();
      if (Math.abs(ax) > Math.abs(ay) && ax) this.wantDir = ax > 0 ? 'right' : 'left';
      else if (ay) this.wantDir = ay > 0 ? 'up' : 'down';
    }

    // Player
    const me = this.me;
    if (this.wantDir && me.t >= 1 && this.head(me, this.wantDir)) { /* turned */ }
    else if (this.wantDir && me.dir === OPPOSITE[this.wantDir] && me.t < 1) {
      // reversing mid-corridor: turn around on the spot
      [me.c, me.tc] = [me.tc, me.c]; [me.r, me.tr] = [me.tr, me.r]; me.t = 1 - me.t; me.dir = this.wantDir;
    }
    if (this.advance(me, PLAYER_SPEED, dt)) {
      this.eat(me.c, me.r);
      if (me.dir && !this.head(me, me.dir)) me.dir = null;
    }
    const [px, pz] = worldOf(me.c + (me.tc - me.c) * me.t, me.r + (me.tr - me.r) * me.t);
    this.pac.position.set(px, 0.62, pz);
    this.pac.scale.setScalar(1 + Math.sin(this.time * 18) * 0.06);

    // Ghosts
    for (const g of this.ghosts) {
      g.delay -= dt;
      if (g.delay > 0) continue;
      const speed = this.fright > 0 ? GHOST_SPEED * 0.6 : GHOST_SPEED + this.level * 0.15;
      if (this.advance(g.w, speed, dt)) this.steer(g);
      const [gx, gz] = worldOf(g.w.c + (g.w.tc - g.w.c) * g.w.t, g.w.r + (g.w.tr - g.w.r) * g.w.t);
      g.mesh.position.set(gx, 0.6 + Math.sin(this.time * 6) * 0.06, gz);
      const scared = this.fright > 0;
      const flicker = scared && this.fright < 2 && Math.sin(this.time * 24) > 0;
      g.mesh.material.color.setHex(scared ? (flicker ? 0xffffff : 0x3a5bff) : g.color);
      g.mesh.material.emissive.setHex(scared ? (flicker ? 0xffffff : 0x3a5bff) : g.color);

      if (Math.hypot(gx - px, gz - pz) < CELL * 0.62 && !g.eaten) {
        if (scared) this.eatGhost(g);
        else if (this.invuln <= 0) { this.die(); if (this.finished) return; break; }
      }
    }

    if (this.pellets.size === 0) this.nextLevel();

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
    this.hud.stat('Level', this.level);
    this.pac.visible = this.invuln <= 0 || Math.sin(this.time * 30) > 0;
  }

  /** At a cell centre a ghost picks its way: towards you normally, away when scared, never straight back. */
  steer(g) {
    const w = g.w;
    const options = Object.keys(DIRS).filter((d) => d !== OPPOSITE[w.dir] && open(w.c + DIRS[d][0], w.r + DIRS[d][1]));
    if (!options.length) { this.head(w, OPPOSITE[w.dir] ?? 'up'); return; }
    let pick;
    if (Math.random() < 0.15) pick = options[Math.floor(Math.random() * options.length)];   // a little wandering keeps them beatable
    else {
      const sign = this.fright > 0 ? -1 : 1;
      let best = Infinity;
      for (const d of options) {
        const nc = w.c + DIRS[d][0];
        const nr = w.r + DIRS[d][1];
        const dist = sign * (Math.abs(nc - this.me.c) + Math.abs(nr - this.me.r));
        if (dist < best) { best = dist; pick = d; }
      }
    }
    this.head(w, pick);
  }

  eat(c, r) {
    const key = `${c},${r}`;
    const p = this.pellets.get(key);
    if (!p) return;
    this.pellets.delete(key);
    this.scene.remove(p);
    if (p.userData.big) {
      this.score += 50;
      this.fright = FRIGHT_TIME;
      this.eatenStreak = 0;
      this.audio.good();
    } else {
      this.score += 10;
      this.audio.blip(this.pellets.size % 8);
    }
  }

  eatGhost(g) {
    this.eatenStreak++;
    const pts = 200 * this.eatenStreak;
    this.score += pts;
    this.hud.toast(`+${pts}`, 600);
    this.burst.burst(g.mesh.position, PALETTE.white, 16, 8);
    this.audio.win();
    g.w = walker(g.home[0], g.home[1]);
    g.delay = 2;
    const [gx, gz] = worldOf(g.w.c, g.w.r);
    g.mesh.position.set(gx, 0.6, gz);
  }

  die() {
    this.lives--;
    this.burst.burst(this.pac.position, PALETTE.lime, 24, 9);
    this.audio.boom();
    if (this.lives <= 0) {
      this.audio.lose();
      this.end(this.score, `Level ${this.level}, ${this.totalPellets - this.pellets.size} pellets eaten this level.`);
      return;
    }
    this.me = walker(7, 7);
    this.wantDir = null;
    this.invuln = 2;
    this.fright = 0;
    this.ghosts.forEach((g, i) => { g.w = walker(g.home[0], g.home[1]); g.delay = 1 + i * 0.8; });
    this.place();
    this.hud.toast(`${this.lives} lives left`, 800);
  }

  nextLevel() {
    this.level++;
    this.score += 500;
    this.hud.toast(`LEVEL ${this.level}`, 900);
    this.audio.win();
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (MAP[r][c] === '#') continue;
        const big = MAP[r][c] === 'o';
        const p = big ? ball(0.38, glow(PALETTE.white, { emissiveIntensity: 1 }), { seg: 10 }) : ball(0.14, glow(PALETTE.amber, { emissiveIntensity: 0.9 }), { seg: 8 });
        const [x, z] = worldOf(c, r);
        p.position.set(x, 0.5, z);
        p.userData = { big };
        this.pellets.set(`${c},${r}`, this.add(p));
      }
    }
    this.me = walker(7, 7);
    this.wantDir = null;
    this.invuln = 1.5;
    this.ghosts.forEach((g, i) => { g.w = walker(g.home[0], g.home[1]); g.delay = 1 + i; });
    this.place();
  }
}
