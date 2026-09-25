import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, PALETTE,
} from '../engine/utils.js';

const CELL = 1.25;
const TOWER_X = 9;          // left edge of the tower
const ANCHOR = { x: -9, y: 3.4 };
const MAX_PULL = 4;
const POWER = 5.6;
const GRAV = 15;
const SHOTS = 4;
const R = 0.5;

// . empty · w wood (2 hits) · s stone (4 hits) · p pig (1 hit). Each column is solid from the ground up.
export const LEVELS = [
  ['..p..', '.www.', 'wwpww', 'wwwww'],
  ['.p.p.', '.s.s.', 'wwwww', 'wpwpw', 'wwwww'],
  ['p...p', 's.p.s', 'sswss', 'wpwpw', 'sssss'],
];
const HP = { w: 2, s: 4, p: 1 };

/** Parses a level into columns of cells from the ground up: cols[c] = [{ type, hp }]. */
export function parseTower(rows) {
  const cols = [];
  const w = rows[0].length;
  for (let c = 0; c < w; c++) {
    const col = [];
    for (let r = rows.length - 1; r >= 0; r--) {
      const t = rows[r][c];
      if (t === '.') break;
      col.push({ type: t, hp: HP[t] });
    }
    cols.push(col);
  }
  return cols;
}

/** Does every '.' sit above every solid cell in its column? (No floating blocks.) */
export function isSupported(rows) {
  const h = rows.length;
  for (let c = 0; c < rows[0].length; c++) {
    let seenGap = false;
    for (let r = h - 1; r >= 0; r--) {
      if (rows[r][c] === '.') seenGap = true; else if (seenGap) return false;
    }
  }
  return true;
}

export default class SlingshotSmash extends Game {
  start() {
    sky(this.scene, '#78b8f0', '#d8f0ff', 80, 260);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    const floor = box(120, 1, 10, mat(0x4a8a3a));
    floor.position.set(0, -0.5, 0);
    this.add(floor);
    const post = box(0.5, 3, 0.5, mat(0x5a3a1a));
    post.position.set(ANCHOR.x, 1.5, 0);
    this.add(post);
    const pouch = box(0.6, 0.6, 0.4, mat(0x3a2a1a));
    this.pouch = this.add(pouch);
    this.pouch.position.set(ANCHOR.x, ANCHOR.y, 0);
    this.band = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x3a2a1a }));
    this.band.frustumCulled = false;
    this.add(this.band);
    this.dots = Array.from({ length: 14 }, () => { const d = ball(0.09, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }), { cast: false }); d.visible = false; return this.add(d); });
    this.burst = new Burst(this.scene, 90, 0.25);

    this.level = 0;
    this.score = 0;
    this.pigsKilled = 0;
    this.dragging = false;
    this.projectile = null;
    this.shotsLeft = SHOTS;
    this.tower = [];
    this.meshes = new Map();
    this.buildLevel(0);
    this.showCursor = true;
    this.camera.position.set(2, 6, 26);
    this.camera.lookAt(2, 4, 0);
    this.hud.hint('Hold the ball, drag back and let go to fire (drag further for more power; the dotted line shows the flight) · smash the blocks and pop every green pig · unused shots are worth bonus points');
  }

  buildLevel(i) {
    for (const m of this.meshes.values()) this.scene.remove(m);
    this.meshes.clear();
    this.tower = parseTower(LEVELS[i % LEVELS.length]);
    this.tower.forEach((col, c) => col.forEach((cell, r) => {
      cell.id = `${c}:${r}:${Math.random()}`;
      const m = cell.type === 'p'
        ? ball(CELL * 0.42, glow(0x6fdc4a, { emissiveIntensity: 0.4 }))
        : box(CELL * 0.96, CELL * 0.96, CELL * 0.96, mat(cell.type === 's' ? 0x8a8f99 : 0xb98a4a, { roughness: 0.8 }));
      m.position.set(TOWER_X + c * CELL, r * CELL + CELL / 2, 0);
      cell.mesh = this.add(m);
      this.meshes.set(cell.id, m);
    }));
    this.shotsLeft = SHOTS;
    this.pigs = this.tower.flat().filter((c) => c.type === 'p').length;
  }

  pigsLeft() { return this.tower.flat().filter((c) => c.type === 'p').length; }

  /** Velocity for a pull (the vector from the release point to the anchor). */
  static velocityFor(pullX, pullY) {
    return { vx: pullX * POWER, vy: pullY * POWER };
  }

  /** Fires the ball with the given pull vector. */
  fire(pullX, pullY) {
    if (this.projectile || this.shotsLeft <= 0) return false;
    const len = Math.hypot(pullX, pullY);
    if (len < 0.4) return false;
    const k = Math.min(1, MAX_PULL / len);
    const v = SlingshotSmash.velocityFor(pullX * k, pullY * k);
    const b = ball(R, glow(PALETTE.red, { emissiveIntensity: 0.5 }));
    b.position.set(ANCHOR.x - pullX * k, ANCHOR.y - pullY * k, 0);
    this.add(b);
    this.projectile = { mesh: b, x: b.position.x, y: b.position.y, vx: v.vx, vy: v.vy, life: 0, hits: 0 };
    this.shotsLeft--;
    this.audio.thud();
    return true;
  }

  /** Damages the cell at (c, r); removes it at 0 hp and drops the column above. */
  damage(c, r, amount = 1) {
    const col = this.tower[c];
    const cell = col?.[r];
    if (!cell) return false;
    cell.hp -= amount;
    if (cell.hp > 0) { this.burst.burst(cell.mesh.position, 0xffffff, 3, 4); return false; }
    this.scene.remove(cell.mesh);
    this.meshes.delete(cell.id);
    this.burst.burst(cell.mesh.position, cell.type === 'p' ? 0x6fdc4a : cell.type === 's' ? 0x9aa0aa : 0xb98a4a, 10, 7);
    if (cell.type === 'p') { this.score += 100; this.pigsKilled++; this.audio.good(); } else { this.score += 10; this.audio.thud(); }
    col.splice(r, 1);
    // Everything above drops one cell; a pig that falls is squashed, a block takes a knock.
    for (let k = r; k < col.length; k++) {
      col[k].fell = true;
      if (col[k].type === 'p') col[k].hp -= 1;
    }
    for (let k = col.length - 1; k >= r; k--) if (col[k].hp <= 0) this.damage(c, k, 0);
    return true;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    const p = this.planePoint(0);
    // Aiming
    if (!this.projectile) {
      const down = this.input.down || this.input.gpButton(0);
      if (down && !this.dragging && this.shotsLeft > 0) this.dragging = true;
      if (this.dragging && p) {
        let px = ANCHOR.x - p.x;
        let py = ANCHOR.y - p.y;
        const len = Math.hypot(px, py);
        if (len > MAX_PULL) { px *= MAX_PULL / len; py *= MAX_PULL / len; }
        this.pull = { x: px, y: py };
        this.pouch.position.set(ANCHOR.x - px, ANCHOR.y - py, 0);
        // predicted path
        const v = SlingshotSmash.velocityFor(px, py);
        let x = ANCHOR.x - px; let y = ANCHOR.y - py; let vx = v.vx; let vy = v.vy;
        this.dots.forEach((d, i) => {
          for (let s = 0; s < 3; s++) { vy -= GRAV * 0.05; x += vx * 0.05; y += vy * 0.05; }
          d.position.set(x, y, 0);
          d.visible = Math.hypot(px, py) > 0.4;
        });
        if (!down) {
          this.dragging = false;
          this.dots.forEach((d) => { d.visible = false; });
          this.fire(px, py);
          this.pouch.position.set(ANCHOR.x, ANCHOR.y, 0);
        }
      } else if (!down) {
        this.dragging = false;
        this.dots.forEach((d) => { d.visible = false; });
      }
    }
    const bp = this.band.geometry.attributes.position;
    bp.setXYZ(0, ANCHOR.x - 0.4, ANCHOR.y + 0.3, -0.2);
    bp.setXYZ(1, this.pouch.position.x, this.pouch.position.y, this.pouch.position.z);
    bp.setXYZ(2, ANCHOR.x + 0.4, ANCHOR.y + 0.3, 0.2);
    bp.needsUpdate = true;

    // Flight
    const pr = this.projectile;
    if (pr) {
      pr.life += dt;
      pr.vy -= GRAV * dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.mesh.position.set(pr.x, pr.y, 0);
      pr.mesh.rotation.z += dt * 8;
      // Hit test against every cell.
      for (let c = 0; c < this.tower.length; c++) {
        const cx = TOWER_X + c * CELL;
        if (pr.x < cx - CELL / 2 - R || pr.x > cx + CELL / 2 + R) continue;
        for (let r = this.tower[c].length - 1; r >= 0; r--) {
          const cy = r * CELL + CELL / 2;
          if (Math.abs(pr.y - cy) < CELL / 2 + R * 0.8 && Math.abs(pr.x - cx) < CELL / 2 + R * 0.8) {
            const speed = Math.hypot(pr.vx, pr.vy);
            if (speed > 3) {
              this.damage(c, r, speed > 14 ? 2 : 1);
              pr.vx *= 0.55; pr.vy *= 0.55;
              pr.hits++;
              if (pr.hits >= 3 || speed < 6) pr.vx = Math.min(pr.vx, 1);
            }
            break;
          }
        }
      }
      if (pr.y <= R) { pr.y = R; pr.vy = Math.abs(pr.vy) * 0.3; pr.vx *= 0.7; }
      if (pr.life > 5 || pr.x > 40 || (pr.y <= R + 0.01 && Math.abs(pr.vx) < 0.5)) this.endShot();
    }

    // Blocks slide down into place after a collapse.
    this.tower.forEach((col, c) => col.forEach((cell, r) => {
      const t = r * CELL + CELL / 2;
      cell.mesh.position.y = damp(cell.mesh.position.y, t, 10, dt);
      cell.mesh.position.x = TOWER_X + c * CELL;
    }));

    this.hud.stat('Score', this.score);
    this.hud.stat('Level', `${this.level + 1}/${LEVELS.length}`);
    this.hud.stat('Pigs', this.pigsLeft());
    this.hud.stat('Shots', this.shotsLeft);
  }

  endShot() {
    if (this.projectile) { this.scene.remove(this.projectile.mesh); this.projectile = null; }
    if (this.pigsLeft() === 0) {
      const bonus = this.shotsLeft * 50;
      this.score += bonus;
      this.hud.toast(`LEVEL CLEARED · +${bonus}`, 1400);
      this.audio.win();
      this.level++;
      if (this.level >= LEVELS.length) return this.finish(true);
      this.buildLevel(this.level);
    } else if (this.shotsLeft <= 0) {
      this.finish(false);
    }
  }

  finish(won) {
    this.audio[won ? 'win' : 'lose']();
    this.end(this.score, won ? `Every pig popped! ${this.score} points.` : `Out of shots on level ${this.level + 1} — ${this.pigsKilled} pigs popped for ${this.score} points.`);
  }
}
