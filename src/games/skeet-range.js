import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  cyl, ground, lights, sky, glow, mat, Burst, clamp, rand, pick, PALETTE,
} from '../engine/utils.js';

const GRAV = 9;
const MISS_LIMIT = 10;
const LAUNCHERS = [
  { x: -15, dir: 1 },
  { x: 15, dir: -1 },
];

export default class SkeetRange extends Game {
  start() {
    sky(this.scene, '#7fb2f0', '#dceeff', 40, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4c7a3a, intensity: 1.1 });
    this.add(ground(200, 0x3f6b30));

    for (const l of LAUNCHERS) {
      const launcher = this.add(cyl(0.8, 1.1, 1.4, mat(0x5a4632)));
      launcher.position.set(l.x, 0.7, -18);
    }

    this.live = [];
    this.pool = [];
    for (let i = 0; i < 12; i++) {
      const d = cyl(0.42, 0.42, 0.1, glow(PALETTE.amber, { emissiveIntensity: 0.35 }));
      d.visible = false;
      this.pool.push(this.add(d));
    }

    this.burst = new Burst(this.scene, 100, 0.16);
    this.hits = 0;
    this.misses = 0;
    this.nextLaunch = 0.6;

    this.camera.position.set(0, 4, 14);
    this.camera.lookAt(0, 5, -14);
    this.hud.hint(`Click a clay while it is in the air · ${MISS_LIMIT} misses ends the round`);
  }

  launchPair() {
    const which = Math.random() < 0.5 ? [LAUNCHERS[0]] : [LAUNCHERS[1]];
    if (Math.random() < 0.35) which.push(LAUNCHERS[which[0] === LAUNCHERS[0] ? 1 : 0]);
    for (const l of which) {
      const d = this.pool.pop();
      if (!d) return;
      d.position.set(l.x, 1, -18);
      d.rotation.set(Math.PI / 2, 0, 0);
      const speed = rand(14, 19);
      d.userData = {
        vel: new THREE.Vector3(l.dir * speed * 0.6, rand(9, 12), speed * 0.55),
        hit: false,
      };
      d.visible = true;
      this.live.push(d);
    }
  }

  update(dt) {
    this.nextLaunch -= dt;
    if (this.nextLaunch <= 0) {
      this.launchPair();
      this.nextLaunch = clamp(2.2 - (this.hits + this.misses) * 0.03, 0.9, 2.2) * rand(0.85, 1.2);
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      const u = d.userData;
      u.vel.y -= GRAV * dt;
      d.position.addScaledVector(u.vel, dt);
      d.rotation.z += dt * 10;
      if (d.position.y <= 0.1) {
        this.misses++;
        this.audio.tone([180, 90], 0.12, { type: 'sawtooth', gain: 0.08 });
        this.recycle(d, i);
      }
    }

    if (this.input.clicked) {
      const hit = this.input.pick(this.camera, this.live, false);
      if (hit) this.shoot(hit.object);
    }

    this.burst.update(dt);
    this.hud.stat('Hits', this.hits);
    this.hud.stat('Misses', `${this.misses}/${MISS_LIMIT}`, this.misses >= MISS_LIMIT - 2);

    if (this.misses >= MISS_LIMIT) return this.finish();
  }

  shoot(d) {
    const i = this.live.indexOf(d);
    if (i < 0) return;
    this.hits++;
    this.burst.burst(d.position, pick([PALETTE.amber, PALETTE.white]), 16, 7);
    this.audio.thud();
    this.audio.blip(clamp(this.hits % 12, 0, 12));
    this.recycle(d, i);
  }

  recycle(d, i) {
    d.visible = false;
    this.live.splice(i, 1);
    this.pool.push(d);
  }

  finish() {
    this.audio.lose();
    this.end(this.hits, `You hit ${this.hits} clays before missing ${MISS_LIMIT}.`);
  }
}
