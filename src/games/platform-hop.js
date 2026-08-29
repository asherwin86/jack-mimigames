import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, Burst, clamp, damp, rand, chase, COLORS, PALETTE,
} from '../engine/utils.js';

const GRAV = 34;
const JUMP = 13.5;
const RUN = 9;
const RADIUS = 0.45;
const RISE = 4.2;      // vertical gap between floors

export default class PlatformHop extends Game {
  start() {
    sky(this.scene, '#3a2b5e', '#07070f', 30, 120);
    lights(this.scene, { sky: 0xd9c4ff, groundCol: 0x1c1633 });

    this.platforms = [];
    this.burst = new Burst(this.scene, 80, 0.2);

    // Wide starting pad so the first jump is never a coin flip.
    this.makePlatform(0, 0, 0, 5.5, 5.5, 0);
    for (let i = 1; i <= 12; i++) this.spawnFloor(i);

    this.player = this.add(cyl(RADIUS, RADIUS, 1.2, glow(PALETTE.lime)));
    this.player.position.set(0, 1.2, 0);
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.standing = this.platforms[0];
    this.floor = 0;
    this.bestFloor = 0;
    this.coyote = 0;

    this.camera.position.set(0, 8, 13);
    this.hud.hint('WASD to move · Space to jump · platforms drift, so time it');
  }

  makePlatform(x, y, z, w, d, index) {
    const p = box(w, 0.6, d, COLORS[index % COLORS.length]);
    p.position.set(x, y, z);
    p.userData = {
      index, w, d,
      drift: index === 0 ? 0 : rand(0.6, 1.5) + index * 0.05,
      phase: rand(0, Math.PI * 2),
      axis: Math.random() < 0.5 ? 'x' : 'z',
      home: new THREE.Vector3(x, y, z),
      range: index === 0 ? 0 : clamp(1 + index * 0.18, 1, 5),
    };
    this.platforms.push(this.add(p));
    return p;
  }

  spawnFloor(i) {
    const prev = this.platforms[this.platforms.length - 1].userData.home;
    const a = rand(0, Math.PI * 2);
    const reach = clamp(4.6 + i * 0.12, 4.6, 8.2);
    const size = clamp(4.4 - i * 0.11, 1.9, 4.4);
    this.makePlatform(
      prev.x + Math.cos(a) * reach,
      i * RISE,
      prev.z + Math.sin(a) * reach,
      size, size, i,
    );
  }

  update(dt) {
    const inX = this.input.axisX();
    const inZ = -this.input.axisY();

    // Movement is camera-relative-ish: the camera always sits on +z.
    const accel = this.grounded ? 60 : 26;
    this.vel.x = damp(this.vel.x, inX * RUN, accel / RUN, dt);
    this.vel.z = damp(this.vel.z, inZ * RUN, accel / RUN, dt);

    this.coyote -= dt;
    if (this.input.hit('Space') && (this.grounded || this.coyote > 0)) {
      this.vel.y = JUMP;
      this.grounded = false;
      this.coyote = 0;
      this.audio.tone([420, 700], 0.1, { type: 'triangle', gain: 0.12 });
    }

    this.vel.y -= GRAV * dt;
    const p = this.player.position;
    const prevY = p.y;
    p.addScaledVector(this.vel, dt);

    // Drifting platforms — moved after the player so carrying works.
    for (const plat of this.platforms) {
      const d = plat.userData;
      if (!d.range) continue;
      const before = d.axis === 'x' ? plat.position.x : plat.position.z;
      const val = d.home[d.axis] + Math.sin(this.time * d.drift + d.phase) * d.range;
      plat.position[d.axis] = val;
      if (this.standing === plat && this.grounded) p[d.axis] += val - before;
    }

    // Landing test: only while falling, and only through the top face.
    this.grounded = false;
    for (const plat of this.platforms) {
      const d = plat.userData;
      const rest = plat.position.y + 0.3 + 0.6;   // player centre when standing
      if (this.vel.y <= 0 && prevY >= rest - 0.06 && p.y <= rest) {
        if (Math.abs(p.x - plat.position.x) < d.w / 2 + RADIUS * 0.4
          && Math.abs(p.z - plat.position.z) < d.d / 2 + RADIUS * 0.4) {
          p.y = rest;
          this.vel.y = 0;
          this.grounded = true;
          this.coyote = 0.12;
          if (this.standing !== plat) this.land(plat);
          this.standing = plat;
          break;
        }
      }
    }

    // Fell off the tower.
    const floorY = this.floor * RISE;
    if (p.y < floorY - 14) return this.fall();

    this.player.rotation.y += dt * 2;
    this.player.scale.y = damp(this.player.scale.y, this.grounded ? 1 : 1.15, 10, dt);
    this.burst.update(dt);

    chase(this.camera, this.player, new THREE.Vector3(0, 6.5, 12), dt, 3.5,
      new THREE.Vector3(p.x, p.y + 1.5, p.z));

    this.hud.stat('Floor', this.floor);
    this.hud.stat('Height', `${Math.max(0, p.y).toFixed(1)} m`);
    this.hud.stat('Best', this.bestFloor);
  }

  land(plat) {
    const i = plat.userData.index;
    this.audio.thud();
    if (i > this.floor) {
      this.floor = i;
      this.bestFloor = Math.max(this.bestFloor, i);
      this.audio.blip(clamp(i, 0, 20));
      this.burst.burst(this.player.position, plat.material.color.getHex(), 8, 4);
      // Keep a runway of platforms above the player.
      while (this.platforms.length < this.floor + 12) this.spawnFloor(this.platforms.length);
      if (this.floor % 10 === 0) { this.hud.toast(`FLOOR ${this.floor}`); this.audio.good(); }
    }
  }

  fall() {
    this.audio.lose();
    this.end(this.bestFloor, `You reached floor ${this.bestFloor}.`);
  }
}
