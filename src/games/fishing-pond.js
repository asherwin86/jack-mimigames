import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HW = 13;
const HD = 8;
const ROUND = 70;
const TYPES = [
  { name: 'minnow', value: 10, len: 0.9, power: 0.10, colour: 0x9fd8ff, weight: 0.55 },
  { name: 'trout', value: 25, len: 1.5, power: 0.17, colour: 0xffb14a, weight: 0.33 },
  { name: 'pike', value: 60, len: 2.4, power: 0.27, colour: 0x6ee0a0, weight: 0.12 },
];

export default class FishingPond extends Game {
  start() {
    sky(this.scene, '#6fb6e8', '#dff3ff', 60, 160);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    this.add(ground(120, 0x4f8a3f));
    const water = box(HW * 2 + 2, 0.3, HD * 2 + 2, mat(0x2a7fc4, { roughness: 0.2, transparent: true, opacity: 0.92 }), { cast: false });
    water.position.y = -0.1;
    this.add(water);
    const dock = box(4, 0.4, 5, mat(0x8a5a2c));
    dock.position.set(0, 0.3, HD + 3.4);
    this.add(dock);

    this.fish = [];
    for (let i = 0; i < 9; i++) this.spawnFish();
    this.bobber = this.add(ball(0.32, glow(PALETTE.red, { emissiveIntensity: 0.6 })));
    this.bobber.visible = false;
    this.line = this.add(box(0.04, 0.04, 1, mat(0xffffff), { cast: false, receive: false }));
    this.line.visible = false;

    this.state = 'idle';        // idle -> cast -> bite -> reel
    this.stateT = 0;
    this.target = null;
    this.reel = 0;
    this.burst = new Burst(this.scene, 60, 0.2);
    this.score = 0;
    this.caught = 0;
    this.timeLeft = ROUND;
    this.showCursor = true;

    this.camera.position.set(0, 15, HD + 10);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('Click the water to cast · when the float dips, click to hook · then click fast to reel in before it escapes');
  }

  spawnFish() {
    const r = Math.random();
    const type = r < TYPES[0].weight ? TYPES[0] : r < TYPES[0].weight + TYPES[1].weight ? TYPES[1] : TYPES[2];
    const f = box(type.len, 0.35, 0.5, mat(type.colour, { roughness: 0.4 }));
    f.position.set(rand(-HW + 2, HW - 2), -0.15, rand(-HD + 1, HD - 1));
    f.userData = { type, goal: new THREE.Vector3(rand(-HW + 2, HW - 2), -0.15, rand(-HD + 1, HD - 1)), speed: rand(1.2, 2.4), interest: 0 };
    this.fish.push(this.add(f));
    return f;
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();
    const click = this.clickedNow() || this.input.hit('Space');

    // Fish swim between random spots.
    for (const f of this.fish) {
      const g = f.userData.goal;
      const dx = g.x - f.position.x;
      const dz = g.z - f.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) g.set(rand(-HW + 2, HW - 2), -0.15, rand(-HD + 1, HD - 1));
      else {
        f.position.x += (dx / d) * f.userData.speed * dt;
        f.position.z += (dz / d) * f.userData.speed * dt;
        f.rotation.y = damp(f.rotation.y, Math.atan2(-dz, dx), 8, dt);
      }
    }

    if (this.state === 'idle') {
      this.bobber.visible = false; this.line.visible = false;
      if (click) {
        const p = this.groundPoint(0);
        if (p && Math.abs(p.x) < HW && Math.abs(p.z) < HD) this.cast(p);
      }
    } else if (this.state === 'cast') {
      this.stateT -= dt;
      this.bobber.position.y = 0.05 + Math.sin(this.time * 3) * 0.05;
      // a fish that swims close takes an interest; after a moment it bites
      if (!this.target) {
        let best = null; let bd = 3.2;
        for (const f of this.fish) {
          const d = Math.hypot(f.position.x - this.bobber.position.x, f.position.z - this.bobber.position.z);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) { this.target = best; this.stateT = rand(0.8, 2.2); best.userData.goal.copy(this.bobber.position).setY(-0.15); }
      } else if (this.stateT <= 0) {
        this.state = 'bite'; this.stateT = 0.9;
        this.audio.tone([400, 700], 0.1, { type: 'triangle', gain: 0.12 });
        this.hud.toast('BITE!', 500);
      }
      if (click && this.state === 'cast') this.reset();   // reeled in early
    } else if (this.state === 'bite') {
      this.stateT -= dt;
      this.bobber.position.y = -0.1 + Math.sin(this.time * 30) * 0.12;
      if (click) { this.state = 'reel'; this.reel = 0.4; this.audio.good(); this.hud.toast('HOOKED!', 500); }
      else if (this.stateT <= 0) { this.hud.toast('IT GOT AWAY', 600); this.reset(); }
    } else if (this.state === 'reel') {
      const power = this.target.userData.type.power;
      this.reel -= (power + (Math.sin(this.time * 7) * 0.5 + 0.5) * 0.06) * dt * 2.2;
      if (click) { this.reel += 0.085; this.audio.blip(Math.floor(this.reel * 10)); }
      this.bobber.position.x += Math.sin(this.time * 9) * 0.02;
      this.target.position.lerp(this.bobber.position, 0.1);
      if (this.reel >= 1) this.landFish();
      else if (this.reel <= 0) { this.hud.toast('IT ESCAPED', 700); this.audio.bad(); this.reset(); }
    }

    // The line from the rod tip to the float
    if (this.bobber.visible) {
      const from = new THREE.Vector3(0, 3, HD + 3.4);
      const to = this.bobber.position;
      this.line.position.copy(from).add(to).multiplyScalar(0.5);
      this.line.scale.z = from.distanceTo(to);
      this.line.lookAt(to);
      this.line.visible = true;
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Time', Math.ceil(this.timeLeft), this.timeLeft < 10);
    this.hud.stat('Caught', this.caught);
    if (this.state === 'reel') this.hud.stat('Reel', `${Math.round(clamp(this.reel, 0, 1) * 100)}%`, this.reel < 0.25);
    else this.hud.removeStat('Reel');
  }

  cast(p) {
    this.bobber.position.set(p.x, 0.05, p.z);
    this.bobber.visible = true;
    this.state = 'cast';
    this.stateT = 0;
    this.target = null;
    this.audio.tone([300, 150], 0.1, { type: 'sine', gain: 0.1 });
  }

  reset() {
    this.state = 'idle';
    this.target = null;
    this.bobber.visible = false;
    this.line.visible = false;
  }

  landFish() {
    const t = this.target.userData.type;
    this.score += t.value;
    this.caught++;
    this.burst.burst(this.bobber.position, PALETTE.cyan, 18, 8);
    this.hud.toast(`${t.name.toUpperCase()} +${t.value}`, 900);
    this.audio.win();
    this.scene.remove(this.target);
    this.fish.splice(this.fish.indexOf(this.target), 1);
    this.spawnFish();
    this.reset();
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.caught} fish caught.`);
  }
}
