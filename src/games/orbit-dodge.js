import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  ball, box, torus, lights, sky, glow, starfield, Burst, clamp, damp, rand,
  randInt, TAU, PALETTE, COLORS,
} from '../engine/utils.js';

const R_MIN = 7;
const R_MAX = 25;
const K = 62;          // angular speed constant: inner orbits are faster

export default class OrbitDodge extends Game {
  start() {
    sky(this.scene, '#1a1040', '#03030a', 60, 200);
    lights(this.scene, { sky: 0xc0a8ff, groundCol: 0x14103a });
    starfield(this.scene, 700, 220);

    this.planet = this.add(ball(4.4, glow(0x4a6bd8, { emissiveIntensity: 0.35 })));
    this.add(torus(4.9, 0.06, PALETTE.violet, { cast: false })).rotation.x = Math.PI / 2;

    this.ship = this.add(box(0.9, 0.5, 1.6, glow(PALETTE.lime)));
    this.angle = 0;
    this.radius = 14;
    this.targetR = 14;

    this.rings = [];
    this.stars = [];
    this.burst = new Burst(this.scene, 100, 0.22);
    this.collected = 0;
    this.survived = 0;
    this.nextRing = 0;
    this.nextStar = 1.5;

    for (let i = 0; i < 3; i++) this.addRing();

    this.camera.position.set(0, 42, 26);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('W / S (or ↑ ↓) to climb and drop between orbits · inner orbits move faster');
  }

  addRing() {
    // Never drop a ring straight onto the lane the player is flying in.
    let radius = rand(R_MIN + 1, R_MAX - 1);
    for (let i = 0; i < 24 && Math.abs(radius - this.radius) < 3.2; i++) {
      radius = rand(R_MIN + 1, R_MAX - 1);
    }
    const count = randInt(3, 6) + Math.floor(this.survived / 20);
    const spin = rand(0.25, 0.7) * (Math.random() < 0.5 ? -1 : 1);
    const rocks = [];
    for (let i = 0; i < count; i++) {
      const r = box(rand(1.4, 2.4), rand(1.4, 2.2), rand(1.4, 2.4), glow(PALETTE.red, { emissiveIntensity: 0.35 }));
      r.userData.phase = (i / count) * TAU + rand(-0.2, 0.2);
      rocks.push(this.add(r));
    }
    const guide = this.add(torus(radius, 0.035, 0xff6a80, { cast: false }));
    guide.rotation.x = Math.PI / 2;
    guide.material = glow(0xff6a80, { transparent: true, opacity: 0.22 });
    this.rings.push({ radius, spin, rocks, guide, phase: rand(0, TAU) });
  }

  addStar() {
    const s = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7),
      glow(COLORS[randInt(0, COLORS.length - 1)]),
    );
    s.userData = { radius: rand(R_MIN, R_MAX), angle: rand(0, TAU), spin: rand(0.1, 0.4) };
    this.stars.push(this.add(s));
  }

  update(dt) {
    this.survived += dt;

    // Orbit mechanics: you steer radius, physics decides your angular speed.
    this.targetR = clamp(this.targetR + this.input.axisY() * 9 * dt, R_MIN, R_MAX);
    this.radius = damp(this.radius, this.targetR, 4, dt);
    const omega = K / this.radius / this.radius * 3.4;
    this.angle += omega * dt;

    const px = Math.cos(this.angle) * this.radius;
    const pz = Math.sin(this.angle) * this.radius;
    this.ship.position.set(px, 0, pz);
    this.ship.rotation.y = -this.angle + Math.PI / 2;
    this.ship.rotation.z = damp(this.ship.rotation.z, -this.input.axisY() * 0.4, 8, dt);

    // Difficulty: more rings over time, and they speed up.
    this.nextRing -= dt;
    if (this.nextRing <= 0 && this.rings.length < 7) {
      this.addRing();
      this.nextRing = 14;
      this.hud.toast('NEW DEBRIS RING', 800);
      this.audio.tone([120, 260], 0.3, { type: 'sawtooth', gain: 0.09 });
    }

    const boost = 1 + this.survived / 60;
    for (const ring of this.rings) {
      ring.phase += ring.spin * boost * dt;
      for (const r of ring.rocks) {
        const a = ring.phase + r.userData.phase;
        r.position.set(Math.cos(a) * ring.radius, 0, Math.sin(a) * ring.radius);
        r.rotation.x += dt;
        r.rotation.y += dt * 0.7;
        if (r.position.distanceTo(this.ship.position) < 1.9) return this.crash(r);
      }
    }

    this.nextStar -= dt;
    if (this.nextStar <= 0 && this.stars.length < 5) {
      this.addStar();
      this.nextStar = rand(1.6, 3.4);
    }

    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      const d = s.userData;
      d.angle += (K / d.radius / d.radius * 3.4) * dt * 0.5;
      s.position.set(Math.cos(d.angle) * d.radius, 0, Math.sin(d.angle) * d.radius);
      s.rotation.y += d.spin * 4 * dt;
      if (s.position.distanceTo(this.ship.position) < 1.7) {
        this.collected++;
        this.burst.burst(s.position, s.material.color.getHex(), 12, 6);
        this.audio.pickup();
        this.scene.remove(s);
        s.geometry.dispose();
        s.material.dispose();
        this.stars.splice(i, 1);
        if (this.collected % 10 === 0) { this.hud.toast(`${this.collected} stars`); this.audio.good(); }
      }
    }

    this.planet.rotation.y += dt * 0.1;
    this.burst.update(dt);

    this.hud.stat('Stars', this.collected);
    this.hud.stat('Orbit', `${this.radius.toFixed(1)}`);
    this.hud.stat('Alive', `${this.survived.toFixed(1)}s`);
  }

  crash(rock) {
    this.burst.burst(this.ship.position, PALETTE.lime, 22, 8);
    this.burst.burst(rock.position, PALETTE.red, 14, 7);
    this.ship.visible = false;
    this.audio.boom();
    this.audio.lose();
    this.end(this.collected, `${this.collected} stars in ${this.survived.toFixed(1)}s.`);
  }
}
