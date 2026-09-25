import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const TARGET_Z = -42;
const TARGET_Y = 3.2;
const RING_W = 0.42;           // each of the ten rings is this wide
const ARROWS = 10;
const GRAV = 9.8;
const EYE = new THREE.Vector3(0, 1.6, 0);
const RING_COLOURS = [0xf2f6ff, 0xf2f6ff, 0x1a1a24, 0x1a1a24, 0x3a8fe0, 0x3a8fe0, 0xe0343a, 0xe0343a, 0xffd23f, 0xffd23f];   // outside in

export default class ArcheryRange extends Game {
  start() {
    sky(this.scene, '#78b8f0', '#e0f2ff', 60, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    this.add(ground(300, 0x4f8a3f));

    // Target: ten rings, biggest first
    this.targetGroup = this.add(new THREE.Group());
    for (let i = 0; i < 10; i++) {
      const r = (10 - i) * RING_W;
      const disc = cyl(r, r, 0.15, mat(RING_COLOURS[i], { roughness: 0.6 }), { cast: false });
      disc.rotation.x = Math.PI / 2;
      disc.position.z = i * 0.02;
      this.targetGroup.add(disc);
    }
    this.targetGroup.position.set(0, TARGET_Y, TARGET_Z);
    const stand = box(0.3, TARGET_Y, 0.3, mat(0x5a3a1c));
    stand.position.set(0, TARGET_Y / 2, TARGET_Z - 0.4);
    this.add(stand);

    this.arrows = [];
    this.flying = null;
    this.burst = new Burst(this.scene, 50, 0.2);
    this.score = 0;
    this.shots = 0;
    this.draw = 0;
    this.drawing = false;
    this.wind = 0;
    this.newWind();
    this.tens = 0;
    this.showCursor = true;

    this.camera.position.copy(EYE);
    this.camera.lookAt(0, TARGET_Y, TARGET_Z);
    this.hud.hint('Move the mouse to aim (aim above the target: arrows drop) · hold click to draw the bow, release to shoot · mind the wind');
  }

  newWind() { this.wind = Math.round(rand(-3.5, 3.5) * 10) / 10; }

  /** The direction the pointer is aiming: the ray through it, from the archer's eye. */
  aimDir() {
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(this.input.activePointer(), this.camera);
    return this._ray.ray.direction.clone();
  }

  update(dt) {
    const held = (this.input.down || this.input.gpButton(0) || this.input.gpButton(7)) && !this.flying && this.shots < ARROWS;
    if (held) { this.drawing = true; this.draw = Math.min(1, this.draw + dt / 0.9); }
    else if (this.drawing) {
      this.drawing = false;
      if (this.draw >= 0.15) this.shoot(this.draw);
      this.draw = 0;
    }

    if (this.flying) this.flyArrow(dt);

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Arrows', ARROWS - this.shots);
    this.hud.stat('Draw', `${Math.round(this.draw * 100)}%`);
    this.hud.stat('Wind', `${this.wind > 0 ? '→' : this.wind < 0 ? '←' : '·'} ${Math.abs(this.wind).toFixed(1)}`);
  }

  shoot(power) {
    this.shots++;
    const dir = this.aimDir();
    const speed = 22 + power * 30;
    const a = box(0.08, 0.08, 1.3, glow(PALETTE.amber, { emissiveIntensity: 0.6 }), { cast: false });
    a.position.copy(EYE);
    a.position.y -= 0.2;
    this.add(a);
    this.arrows.push(a);
    this.flying = { arrow: a, vel: dir.multiplyScalar(speed), prev: a.position.clone() };
    this.audio.tone([900, 300], 0.1, { type: 'triangle', gain: 0.1 });
  }

  flyArrow(dt) {
    const f = this.flying;
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      f.prev.copy(f.arrow.position);
      f.vel.y -= GRAV * dt / steps;
      f.vel.x += this.wind * dt / steps;
      f.arrow.position.addScaledVector(f.vel, dt / steps);
      f.arrow.lookAt(f.arrow.position.clone().add(f.vel));
      if (f.arrow.position.z <= TARGET_Z) {
        // interpolate to where it crossed the target's plane
        const k = (f.prev.z - TARGET_Z) / (f.prev.z - f.arrow.position.z);
        const x = f.prev.x + (f.arrow.position.x - f.prev.x) * k;
        const y = f.prev.y + (f.arrow.position.y - f.prev.y) * k;
        f.arrow.position.set(x, y, TARGET_Z);
        return this.land(x, y);
      }
      if (f.arrow.position.y <= 0.05) return this.land(null, null);
    }
  }

  /** Points for an arrow crossing the target plane at (x, y): 10 in the middle ring down to 1, or 0 off the target. */
  static pointsAt(x, y) {
    const d = Math.hypot(x, y - TARGET_Y);
    if (d >= 10 * RING_W) return 0;
    return 10 - Math.floor(d / RING_W);
  }

  land(x, y) {
    const pts = x === null ? 0 : ArcheryRange.pointsAt(x, y);
    this.score += pts;
    if (pts === 10) this.tens++;
    this.flying = null;
    this.burst.burst(this.arrows[this.arrows.length - 1].position, pts >= 9 ? PALETTE.amber : PALETTE.white, pts ? 10 : 4, 5);
    this.hud.toast(pts === 10 ? 'BULLSEYE! 10' : pts ? `+${pts}` : 'MISS', 700);
    (pts >= 9 ? this.audio.win() : pts ? this.audio.good() : this.audio.bad());
    this.newWind();
    if (this.shots >= ARROWS) this.end(this.score, `${this.tens} bullseye${this.tens === 1 ? '' : 's'} from ${ARROWS} arrows.`);
  }
}
