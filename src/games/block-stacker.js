import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import { box, lights, sky, damp, COLORS } from '../engine/utils.js';

const FLOOR_H = 0.85;
const START = 6;

export default class BlockStacker extends Game {
  start() {
    sky(this.scene, '#1c3a5e', '#070b14', 25, 90);
    lights(this.scene, { sky: 0x9fd8ff, groundCol: 0x16203a });

    this.tower = this.add(new THREE.Group());
    this.scraps = [];

    // Foundation slab
    this.base = this.makeSlab(START, START, 0);
    this.base.position.set(0, FLOOR_H / 2, 0);
    this.tower.add(this.base);

    this.size = { x: START, z: START };
    this.centre = { x: 0, z: 0 };
    this.floors = 0;
    this.perfects = 0;
    this.axis = 'x';
    this.dir = 1;
    this.speed = 5.5;
    this.dropping = false;
    this.spawnMoving();

    this.camY = 6;
    this.camera.position.set(9, 7, 9);
    this.hud.hint('Click or press Space to drop the slab');
  }

  makeSlab(sx, sz, index) {
    const colour = COLORS[index % COLORS.length];
    const m = box(sx, FLOOR_H, sz, colour, { receive: true });
    return m;
  }

  spawnMoving() {
    const i = this.floors + 1;
    this.moving = this.makeSlab(this.size.x, this.size.z, i);
    const y = FLOOR_H * (i + 0.5);
    const off = 9;
    if (this.axis === 'x') this.moving.position.set(-off * this.dir, y, this.centre.z);
    else this.moving.position.set(this.centre.x, y, -off * this.dir);
    this.tower.add(this.moving);
    this.dropping = false;
    // Brief lockout so a stray click can't end the run before you've seen the
    // slab, and so one click never registers as two drops.
    this.dropLock = this.floors === 0 ? 0.6 : 0.1;
  }

  update(dt) {
    this.dropLock -= dt;

    // Slide the active slab back and forth over the tower.
    if (this.moving && !this.dropping) {
      const p = this.moving.position;
      const limit = 9;
      if (this.axis === 'x') {
        p.x += this.dir * this.speed * dt;
        if (Math.abs(p.x) > limit) { p.x = Math.sign(p.x) * limit; this.dir *= -1; }
      } else {
        p.z += this.dir * this.speed * dt;
        if (Math.abs(p.z) > limit) { p.z = Math.sign(p.z) * limit; this.dir *= -1; }
      }
      const wants = this.input.clicked || this.input.hit('Space', 'Enter');
      if (wants && this.dropLock <= 0) this.drop();
    }

    // Sliced-off pieces tumble away.
    for (let i = this.scraps.length - 1; i >= 0; i--) {
      const s = this.scraps[i];
      s.userData.vy -= 26 * dt;
      s.position.y += s.userData.vy * dt;
      s.position.x += s.userData.vx * dt;
      s.position.z += s.userData.vz * dt;
      s.rotation.x += dt * 2;
      s.rotation.z += dt * 1.4;
      if (s.position.y < -30) {
        this.tower.remove(s);
        s.geometry.dispose();
        s.material.dispose();
        this.scraps.splice(i, 1);
      }
    }

    const targetY = FLOOR_H * (this.floors + 1) + 5;
    this.camY = damp(this.camY, targetY, 3.5, dt);
    const a = this.time * 0.18;
    this.camera.position.set(Math.cos(a) * 12, this.camY, Math.sin(a) * 12);
    this.camera.lookAt(0, this.camY - 4.2, 0);

    this.hud.stat('Floors', this.floors);
    this.hud.stat('Perfect', this.perfects);
    this.hud.stat('Width', `${this.size.x.toFixed(1)} × ${this.size.z.toFixed(1)}`);
  }

  drop() {
    this.dropping = true;
    const ax = this.axis;
    const movingPos = ax === 'x' ? this.moving.position.x : this.moving.position.z;
    const basePos = ax === 'x' ? this.centre.x : this.centre.z;
    const span = ax === 'x' ? this.size.x : this.size.z;

    const delta = movingPos - basePos;
    const overlap = span - Math.abs(delta);

    if (overlap <= 0.05) {
      this.moving.userData = { vy: 0, vx: ax === 'x' ? Math.sign(delta) * 3 : 0, vz: ax === 'z' ? Math.sign(delta) * 3 : 0 };
      this.scraps.push(this.moving);
      this.moving = null;
      this.audio.lose();
      return this.end(this.floors, `Tower of ${this.floors} floor${this.floors === 1 ? '' : 's'}.`);
    }

    const perfect = Math.abs(delta) < 0.14;
    const newCentre = basePos + delta / 2;

    if (perfect) {
      // Snap it flush and reward the player by keeping the full width.
      if (ax === 'x') this.moving.position.x = basePos;
      else this.moving.position.z = basePos;
      this.perfects++;
      this.hud.toast('PERFECT', 600);
      this.audio.good();
    } else {
      // Trim the slab down to the overlap and let the offcut fall.
      const keep = overlap;
      const scrapSize = span - keep;
      const scrap = this.makeSlab(
        ax === 'x' ? scrapSize : this.size.x,
        ax === 'z' ? scrapSize : this.size.z,
        this.floors + 1,
      );
      const edge = newCentre + Math.sign(delta) * (keep / 2 + scrapSize / 2);
      scrap.position.copy(this.moving.position);
      if (ax === 'x') scrap.position.x = edge; else scrap.position.z = edge;
      scrap.userData = {
        vy: 1, vx: ax === 'x' ? Math.sign(delta) * 2.5 : 0, vz: ax === 'z' ? Math.sign(delta) * 2.5 : 0,
      };
      this.tower.add(scrap);
      this.scraps.push(scrap);

      this.moving.geometry.dispose();
      this.moving.geometry = new THREE.BoxGeometry(
        ax === 'x' ? keep : this.size.x, FLOOR_H, ax === 'z' ? keep : this.size.z,
      );
      if (ax === 'x') { this.moving.position.x = newCentre; this.size.x = keep; }
      else { this.moving.position.z = newCentre; this.size.z = keep; }
      this.centre[ax] = newCentre;
      this.audio.thud();
      this.audio.blip(Math.min(24, this.floors));
    }

    this.floors++;
    this.axis = this.axis === 'x' ? 'z' : 'x';
    this.speed = Math.min(13, 5.5 + this.floors * 0.22);
    this.spawnMoving();
  }
}
