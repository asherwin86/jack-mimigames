import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, mat, Burst, clamp, damp, rand, chase, PALETTE,
} from '../engine/utils.js';

const N = 9;
const CELL = 2.6;
const OFF = ((N - 1) * CELL) / 2;
const FUSE = 1.25;       // seconds a tile survives once you stand on it
const REGROW = 7;
const GRAV = 40;

export default class LavaFloor extends Game {
  start() {
    sky(this.scene, '#4a1c10', '#0a0403', 25, 90);
    lights(this.scene, { sky: 0xffb08a, groundCol: 0x3a1208 });

    this.lavaY = -6;
    this.lava = this.add(box(N * CELL + 40, 0.4, N * CELL + 40, glow(0xff5a2a, {
      emissiveIntensity: 0.9, transparent: true, opacity: 0.92,
    }), { cast: false }));
    this.lava.position.y = this.lavaY;

    this.tiles = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const t = box(CELL - 0.18, 0.6, CELL - 0.18, mat(0x3a3038, { roughness: 0.9 }));
        t.position.set(-OFF + i * CELL, 0, -OFF + j * CELL);
        t.userData = { fuse: 0, state: 'solid', home: t.position.y, regrow: 0, i, j };
        this.tiles.push(this.add(t));
      }
    }

    this.player = this.add(cyl(0.55, 0.55, 1.4, glow(PALETTE.cyan)));
    this.player.position.set(0, 1, 0);
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.burst = new Burst(this.scene, 100, 0.22);
    this.survived = 0;

    this.camera.position.set(0, 18, 18);
    this.hud.hint('WASD to run · Space to jump · tiles crumble a moment after you touch them');
  }

  tileAt(x, z) {
    const i = Math.round((x + OFF) / CELL);
    const j = Math.round((z + OFF) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const t = this.tiles[i * N + j];
    if (Math.abs(x - t.position.x) > CELL / 2 || Math.abs(z - t.position.z) > CELL / 2) return null;
    return t;
  }

  update(dt) {
    this.survived += dt;
    this.lavaY += dt * 0.09 + this.survived * dt * 0.014;
    this.lava.position.y = this.lavaY;
    this.lava.material.emissiveIntensity = 0.75 + Math.sin(this.time * 3) * 0.25;

    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq()) dir.normalize();
    const p = this.player.position;
    this.vel.x = damp(this.vel.x, dir.x * 11, 14, dt);
    this.vel.z = damp(this.vel.z, dir.z * 11, 14, dt);

    if (this.input.hit('Space') && this.grounded) {
      this.vel.y = 14;
      this.grounded = false;
      this.audio.tone([400, 680], 0.09, { type: 'triangle', gain: 0.1 });
    }
    this.vel.y -= GRAV * dt;
    p.addScaledVector(this.vel, dt);

    // Tile lifecycle
    const under = this.tileAt(p.x, p.z);
    for (const t of this.tiles) {
      const d = t.userData;
      if (d.state === 'solid') {
        if (t === under && this.grounded) d.fuse += dt;
        if (d.fuse > 0) {
          const k = clamp(d.fuse / FUSE, 0, 1);
          t.material.color.setRGB(0.23 + k * 0.7, 0.19 - k * 0.06, 0.22 - k * 0.1);
          t.position.x = (-OFF + d.i * CELL) + rand(-1, 1) * k * 0.06;
        }
        if (d.fuse >= FUSE) {
          d.state = 'falling';
          d.regrow = REGROW;
          this.audio.thud();
          this.burst.burst(t.position, 0xff6a3a, 8, 4);
        }
      } else if (d.state === 'falling') {
        t.position.y -= 26 * dt;
        t.rotation.x += dt * 1.6;
        d.regrow -= dt;
        if (d.regrow <= 0) {
          d.state = 'solid';
          d.fuse = 0;
          t.rotation.set(0, 0, 0);
          t.position.set(-OFF + d.i * CELL, 0, -OFF + d.j * CELL);
          t.material.color.setHex(0x3a3038);
        }
      }
    }

    // Landing
    this.grounded = false;
    if (this.vel.y <= 0 && under && under.userData.state === 'solid') {
      const rest = 0.3 + 0.7;
      if (p.y <= rest && p.y > rest - 1.6) {
        p.y = rest;
        this.vel.y = 0;
        this.grounded = true;
      }
    }

    p.x = clamp(p.x, -OFF - CELL, OFF + CELL);
    p.z = clamp(p.z, -OFF - CELL, OFF + CELL);
    this.player.scale.y = damp(this.player.scale.y, this.grounded ? 1 : 1.2, 10, dt);
    this.burst.update(dt);

    if (p.y < this.lavaY + 0.5) return this.burn();

    chase(this.camera, this.player, new THREE.Vector3(0, 17, 17), dt, 3,
      new THREE.Vector3(p.x * 0.4, 0, p.z * 0.4));

    const gap = p.y - this.lavaY;
    this.hud.stat('Survived', `${this.survived.toFixed(1)}s`);
    this.hud.stat('Clearance', `${gap.toFixed(1)} m`, gap < 2.5);
    this.hud.stat('Solid', this.tiles.filter((t) => t.userData.state === 'solid').length);
  }

  burn() {
    this.audio.boom();
    this.audio.lose();
    this.burst.burst(this.player.position, 0xff5a2a, 22, 8);
    const t = Math.round(this.survived * 10) / 10;
    this.end(t, `You lasted ${t}s above the lava.`);
  }
}
