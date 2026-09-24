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
    this.showCursor = true;   // a real on-screen cursor — see Engine._updateCursor()
    this._ray = new THREE.Raycaster();

    this.camera.position.set(0, 4, 14);
    this.camera.lookAt(0, 5, -14);
    this.hud.hint(`Click a clay while it is in the air · ${MISS_LIMIT} misses ends the round · gold clays count 3 and forgive 2 misses · never shoot the red decoys`);
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
      const roll = Math.random();
      const kind = roll < 0.08 ? 'gold' : roll < 0.2 && this.hits >= 3 ? 'decoy' : 'clay';
      const col = kind === 'gold' ? 0xffe066 : kind === 'decoy' ? PALETTE.red : PALETTE.amber;
      d.material.color.set(col);
      d.material.emissive.set(col);
      d.material.emissiveIntensity = kind === 'clay' ? 0.35 : 0.9;
      d.userData = {
        vel: new THREE.Vector3(l.dir * speed * 0.6, rand(9, 12), speed * 0.55),
        hit: false,
        kind,
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
        if (u.kind !== 'decoy') {   // letting a decoy drop is exactly right
          this.misses++;
          this.audio.tone([180, 90], 0.12, { type: 'sawtooth', gain: 0.08 });
        }
        this.recycle(d, i);
      }
    }

    if (this.input.clicked) {
      const hit = this.input.pick(this.camera, this.live, false);
      if (hit) this.shoot(hit.object);
    } else if (this.input.gpHit(0)) {
      this._ray.setFromCamera(this.input.activePointer(), this.camera);
      const hits = this._ray.intersectObjects(this.live, false);
      if (hits.length) this.shoot(hits[0].object);
    }

    this.burst.update(dt);
    this.hud.stat('Hits', this.hits);
    this.hud.stat('Misses', `${this.misses}/${MISS_LIMIT}`, this.misses >= MISS_LIMIT - 2);

    if (this.misses >= MISS_LIMIT) return this.finish();
  }

  shoot(d) {
    const i = this.live.indexOf(d);
    if (i < 0) return;
    const kind = d.userData.kind;
    if (kind === 'decoy') {
      this.misses += 2;
      this.burst.burst(d.position, PALETTE.red, 14, 6);
      this.audio.boom();
      this.hud.toast('DECOY · +2 misses', 800);
      this.recycle(d, i);
      return;
    }
    if (kind === 'gold') {
      this.hits += 2;    // (plus the 1 below)
      this.misses = Math.max(0, this.misses - 2);
      this.hud.toast('GOLD · +3', 800);
      this.audio.win();
    }
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
