import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, mat, starfield, Burst, clamp, damp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const COLS = 8;
const ROWS = 4;
const GAP_X = 2.2;
const GAP_Z = 1.9;
const FIELD = 15;          // playfield half-width
const SHIP_Z = 11;
const ROW_POINTS = [40, 30, 20, 10];

export default class InvaderGrid extends Game {
  start() {
    sky(this.scene, '#0e1240', '#03040c', 50, 160);
    lights(this.scene, { sky: 0xa8b8ff, groundCol: 0x0c1030 });
    starfield(this.scene, 500, 200);
    this.add(ground(120, 0x0a0d24));

    this.ship = this.add(box(1.8, 0.7, 1.2, glow(PALETTE.lime)));
    this.ship.position.set(0, 0.5, SHIP_Z);
    this.shipX = 0;

    this.invaders = [];
    this.bullets = [];       // the ship's shots
    this.bombs = [];         // the invaders' shots
    this.burst = new Burst(this.scene, 100, 0.22);
    this.score = 0;
    this.lives = 3;
    this.wave = 0;
    this.cooldown = 0;
    this.invuln = 0;
    this.ufo = null;
    this.nextUfo = rand(12, 20);
    this.newWave();

    this.camera.position.set(0, 16, 19);
    this.camera.lookAt(0, 0, 2);
    this.hud.hint('A / D or ← → to move · Space or click to fire · stop them reaching the bottom');
  }

  newWave() {
    this.wave++;
    this.dir = 1;
    this.stepTimer = 0;
    this.speed = 2.2 + this.wave * 0.6;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const inv = box(1.5, 0.7, 1.1, glow(COLORS[(r + this.wave) % COLORS.length], { emissiveIntensity: 0.5 }));
        inv.position.set((c - (COLS - 1) / 2) * GAP_X, 0.5, -10 + r * GAP_Z);
        inv.userData = { row: r, alive: true };
        this.invaders.push(this.add(inv));
      }
    }
    this.hud.toast(`Wave ${this.wave}`, 800);
  }

  alive() { return this.invaders.filter((i) => i.userData.alive); }

  update(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.cooldown -= dt;

    // Ship
    const dir = this.input.axisX();
    this.shipX = clamp(this.shipX + dir * 16 * dt, -FIELD, FIELD);
    this.ship.position.x = damp(this.ship.position.x, this.shipX, 20, dt);
    this.ship.visible = this.invuln <= 0 || Math.sin(this.time * 30) > 0;
    if ((this.input.key('Space') || this.input.down || this.input.gpButton(0) || this.input.gpButton(7)) && this.cooldown <= 0 && this.bullets.length < 3) this.fire();

    // Invaders march and step down at the edges.
    const live = this.alive();
    const minX = Math.min(...live.map((i) => i.position.x));
    const maxX = Math.max(...live.map((i) => i.position.x));
    const pace = this.speed * (1 + (1 - live.length / (COLS * ROWS)) * 1.8);
    let step = 0;
    if ((this.dir > 0 && maxX > FIELD) || (this.dir < 0 && minX < -FIELD)) { this.dir *= -1; step = GAP_Z * 0.45; }
    for (const i of live) {
      i.position.x += this.dir * pace * dt;
      i.position.z += step;
      i.rotation.y = Math.sin(this.time * 6 + i.userData.row) * 0.25;
    }

    // Invaders drop bombs, more often as they thin out.
    this.bombCool = (this.bombCool ?? 1) - dt;
    if (this.bombCool <= 0 && live.length) {
      const shooter = live[Math.floor(Math.random() * live.length)];
      this.dropBomb(shooter.position);
      this.bombCool = clamp(1.3 - this.wave * 0.08 - (1 - live.length / (COLS * ROWS)) * 0.5, 0.25, 1.3) * rand(0.6, 1.3);
    }

    // Bonus saucer
    this.nextUfo -= dt;
    if (this.nextUfo <= 0 && !this.ufo) {
      this.ufo = this.add(box(2.4, 0.6, 1.2, glow(PALETTE.pink, { emissiveIntensity: 0.9 })));
      this.ufo.position.set(-FIELD - 3, 0.6, -13);
      this.nextUfo = rand(15, 25);
    }
    if (this.ufo) {
      this.ufo.position.x += 9 * dt;
      if (this.ufo.position.x > FIELD + 3) { this.scene.remove(this.ufo); this.ufo = null; }
    }

    // Shots
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.position.z -= 30 * dt;
      let gone = b.position.z < -16;
      for (const inv of this.alive()) {
        if (Math.abs(inv.position.x - b.position.x) < 0.95 && Math.abs(inv.position.z - b.position.z) < 0.8) {
          this.kill(inv);
          gone = true;
          break;
        }
      }
      if (!gone && this.ufo && Math.abs(this.ufo.position.x - b.position.x) < 1.4 && Math.abs(this.ufo.position.z - b.position.z) < 1) {
        const pts = [50, 100, 150, 300][Math.floor(Math.random() * 4)];
        this.score += pts;
        this.burst.burst(this.ufo.position, PALETTE.pink, 22, 9);
        this.hud.toast(`SAUCER +${pts}`, 800);
        this.audio.win();
        this.scene.remove(this.ufo);
        this.ufo = null;
        gone = true;
      }
      if (gone) { this.scene.remove(b); this.bullets.splice(i, 1); }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.position.z += 11 * dt;
      let gone = b.position.z > SHIP_Z + 2;
      if (this.invuln <= 0 && Math.abs(b.position.x - this.ship.position.x) < 1.1 && Math.abs(b.position.z - SHIP_Z) < 0.9) {
        this.hurt();
        gone = true;
        if (this.finished) return;
      }
      if (gone) { this.scene.remove(b); this.bombs.splice(i, 1); }
    }

    if (!this.alive().length) { this.score += 100; this.newWave(); }
    if (this.alive().some((i) => i.position.z > SHIP_Z - 1.2)) return this.lose('They reached you.');

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
    this.hud.stat('Wave', this.wave);
  }

  fire() {
    this.cooldown = 0.32;
    const b = box(0.25, 0.25, 0.9, glow(PALETTE.white, { emissiveIntensity: 1 }), { cast: false });
    b.position.set(this.ship.position.x, 0.5, SHIP_Z - 1);
    this.bullets.push(this.add(b));
    this.audio.tone([900, 500], 0.06, { type: 'square', gain: 0.08 });
  }

  dropBomb(pos) {
    const b = box(0.3, 0.3, 0.7, glow(PALETTE.red, { emissiveIntensity: 1 }), { cast: false });
    b.position.set(pos.x, 0.5, pos.z + 0.8);
    this.bombs.push(this.add(b));
  }

  kill(inv) {
    inv.userData.alive = false;
    inv.visible = false;
    this.score += ROW_POINTS[inv.userData.row];
    this.burst.burst(inv.position, inv.material.color.getHex(), 12, 6);
    this.audio.blip(inv.userData.row * 2);
  }

  hurt() {
    this.lives--;
    this.invuln = 1.8;
    this.burst.burst(this.ship.position, PALETTE.lime, 20, 8);
    this.audio.boom();
    if (this.lives <= 0) this.lose('Out of lives.');
    else this.hud.toast(`${this.lives} lives left`, 800);
  }

  lose(why) {
    this.audio.lose();
    this.end(this.score, `${why} Wave ${this.wave}.`);
  }
}
