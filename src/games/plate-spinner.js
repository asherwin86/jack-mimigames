import { Game } from '../engine/Game.js';
import {
  cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, TAU, PALETTE,
} from '../engine/utils.js';

const MAX_SLOTS = 8;
const RADIUS = 6;
const ORDER = [0, 4, 2, 6, 1, 5, 3, 7];   // spreads new plates out, not clustered
const ACTIVATE_EVERY = 8;
const RESPAWN_AFTER = 2.4;
const LOSS_LIMIT = 5;

export default class PlateSpinner extends Game {
  start() {
    sky(this.scene, '#2a1f45', '#07060f', 30, 100);
    lights(this.scene, { sky: 0xd8c8ff, groundCol: 0x1c1430 });
    this.add(ground(50, 0x1a1428));

    this.slots = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const a = (i / MAX_SLOTS) * TAU;
      const x = Math.sin(a) * RADIUS;
      const z = Math.cos(a) * RADIUS;
      const pole = this.add(cyl(0.08, 0.1, 2.4, mat(0x555560)));
      pole.position.set(x, 1.2, z);
      const plate = this.add(cyl(0.7, 0.7, 0.12, glow(PALETTE.cyan, { emissiveIntensity: 0.5 })));
      plate.position.set(x, 2.5, z);
      plate.visible = false;
      this.slots.push({
        pole, plate, x, z, active: false, wobble: 0, spin: 0, respawnT: 0, falling: false, fallVel: 0,
      });
    }

    this.activeCount = 0;
    this.lost = 0;
    this.burst = new Burst(this.scene, 90, 0.18);
    this.activateNext(); this.activateNext(); this.activateNext();
    this.nextActivate = ACTIVATE_EVERY;

    this.camera.position.set(0, 9, 10);
    this.camera.lookAt(0, 2, 0);
    this.hud.hint('Click a wobbling plate before it tips over · new pedestals join over time');
  }

  activateNext() {
    if (this.activeCount >= MAX_SLOTS) return;
    const slot = this.slots[ORDER[this.activeCount]];
    this.activeCount++;
    this.wake(slot);
  }

  wake(slot) {
    slot.active = true;
    slot.falling = false;
    slot.wobble = 0;
    slot.spin = 8;
    slot.plate.visible = true;
    slot.plate.position.y = 2.5;
    slot.plate.rotation.set(0, 0, 0);
  }

  update(dt) {
    this.nextActivate -= dt;
    if (this.nextActivate <= 0 && this.activeCount < MAX_SLOTS) {
      this.activateNext();
      this.nextActivate = ACTIVATE_EVERY;
    }

    const wobbleRate = 0.09 + Math.min(0.08, this.time / 400);
    for (const s of this.slots) {
      if (s.falling) {
        s.fallVel += 14 * dt;
        s.plate.position.y -= s.fallVel * dt;
        s.plate.rotation.x += dt * 6;
        if (s.plate.position.y < -3) {
          s.plate.visible = false;
          s.falling = false;
          s.respawnT = RESPAWN_AFTER;
        }
        continue;
      }
      if (!s.active) {
        if (s.respawnT > 0) {
          s.respawnT -= dt;
          if (s.respawnT <= 0) this.wake(s);
        }
        continue;
      }

      s.wobble = clamp(s.wobble + wobbleRate * dt, 0, 1.25);
      s.spin = damp(s.spin, 1.5, 3, dt);
      s.plate.rotation.y += s.spin * dt;
      const tilt = Math.min(1, s.wobble) * 0.55;
      s.plate.rotation.x = Math.sin(this.time * 6 + s.x) * tilt;
      s.plate.rotation.z = Math.cos(this.time * 5.3 + s.z) * tilt;
      s.plate.material.color.setHSL(0.55 - Math.min(1, s.wobble) * 0.55, 0.8, 0.55);
      s.plate.material.emissive.copy(s.plate.material.color);

      if (s.wobble >= 1.25) this.drop(s);
    }

    if (this.input.clicked) {
      const targets = this.slots.filter((s) => s.active && !s.falling).map((s) => s.plate);
      const hit = this.input.pick(this.camera, targets, false);
      if (hit) {
        const slot = this.slots.find((s) => s.plate === hit.object);
        this.save(slot);
      }
    }

    this.burst.update(dt);
    this.hud.stat('Survived', `${this.time.toFixed(1)}s`);
    this.hud.stat('Spinning', this.slots.filter((s) => s.active && !s.falling).length);
    this.hud.stat('Dropped', this.lost, this.lost >= LOSS_LIMIT - 1);

    if (this.lost >= LOSS_LIMIT) return this.finish();
  }

  save(slot) {
    slot.wobble = 0;
    slot.spin = 8;
    this.audio.blip(4);
    this.burst.burst(slot.plate.position, PALETTE.cyan, 8, 4);
  }

  drop(slot) {
    slot.active = false;
    slot.falling = true;
    slot.fallVel = 0;
    this.lost++;
    this.burst.burst(slot.plate.position, PALETTE.red, 14, 6);
    this.audio.bad();
  }

  finish() {
    this.audio.lose();
    this.end(Math.floor(this.time), `You kept plates spinning for ${Math.floor(this.time)} seconds.`);
  }
}
