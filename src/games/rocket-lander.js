import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, mat, starfield, Burst, clamp, damp, rand, randInt, PALETTE,
} from '../engine/utils.js';

const W = 60;               // playfield width (x from -W/2 to W/2)
const COL = 1;              // terrain column width
const SAFE_VY = 3.2;
const SAFE_VX = 2.2;
const SAFE_ANGLE = 0.28;

export default class RocketLander extends Game {
  start() {
    sky(this.scene, '#0a0f2c', '#02030a', 80, 240);
    lights(this.scene, { sky: 0x9fb0ff, groundCol: 0x14182c });
    starfield(this.scene, 500, 200);

    this.terrainGroup = this.add(new THREE.Group());
    this.rocket = this.add(new THREE.Group());
    const body = cyl(0.55, 0.7, 2.2, mat(0xe8ecf7, { roughness: 0.4 }));
    body.position.y = 1.1;
    const nose = cyl(0.01, 0.55, 0.9, glow(PALETTE.red, { emissiveIntensity: 0.4 }));
    nose.position.y = 2.65;
    const legL = box(0.12, 1.0, 0.12, mat(0x8a93b0)); legL.position.set(-0.8, 0.3, 0); legL.rotation.z = 0.5;
    const legR = box(0.12, 1.0, 0.12, mat(0x8a93b0)); legR.position.set(0.8, 0.3, 0); legR.rotation.z = -0.5;
    this.flame = box(0.6, 1.4, 0.6, glow(PALETTE.amber, { emissiveIntensity: 1.2 }), { cast: false });
    this.flame.position.y = -0.3;
    this.rocket.add(body, nose, legL, legR, this.flame);

    this.burst = new Burst(this.scene, 100, 0.25);
    this.score = 0;
    this.landings = 0;
    this.level = 0;
    this.fuelMax = 100;
    this.nextLevel();

    this.camera.position.set(0, 14, 36);
    this.camera.lookAt(0, 12, 0);
    this.hud.hint('A / D or ← → to tilt · W, Space or hold click to thrust · touch down gently on the pad: slow and upright');
  }

  nextLevel() {
    this.level++;
    // Terrain heights per column: rolling hills with one flat landing pad that gets narrower each level.
    const cols = W / COL;
    this.padWidth = Math.max(4, 9 - this.level);
    const padStart = randInt(4, cols - 4 - this.padWidth);
    this.padX0 = padStart * COL - W / 2;
    this.padX1 = this.padX0 + this.padWidth * COL;
    const phase = rand(0, 6);
    this.heights = [];
    let base = rand(2, 5);
    for (let i = 0; i < cols; i++) {
      const rough = 1.2 + this.level * 0.5;
      const h = base + Math.sin(i * 0.35 + phase) * rough + Math.sin(i * 0.9 + phase * 2) * rough * 0.4;
      this.heights.push(Math.max(1, h));
    }
    const padH = this.heights[padStart];
    for (let i = padStart; i < padStart + this.padWidth; i++) this.heights[i] = padH;
    this.padY = padH;

    this.terrainGroup.clear();
    for (let i = 0; i < cols; i++) {
      const onPad = i >= padStart && i < padStart + this.padWidth;
      const c = box(COL, this.heights[i], 3, mat(onPad ? 0x2fbf6a : 0x5a5f78, { roughness: 0.9 }));
      c.position.set(i * COL - W / 2 + COL / 2, this.heights[i] / 2, 0);
      if (onPad) { c.material.emissive.setHex(0x0f5a2a); }
      this.terrainGroup.add(c);
    }

    this.pos = new THREE.Vector3(rand(-W / 3, W / 3), 26 + this.level, 0);
    this.vel = new THREE.Vector3(rand(-2, 2), 0, 0);
    this.angle = 0;            // radians, positive tilts to the left
    this.spin = 0;
    this.fuel = this.fuelMax;
    this.gravity = 3.4 + this.level * 0.35;
    this.landed = 0;
    this.thrusting = false;
  }

  terrainAt(x) {
    const i = clamp(Math.floor((x + W / 2) / COL), 0, this.heights.length - 1);
    return this.heights[i];
  }

  update(dt) {
    if (this.landed > 0) {
      this.landed -= dt;
      if (this.landed <= 0) this.nextLevel();
      this.burst.update(dt);
      return;
    }

    const turn = this.input.axisX() || -this.input.gpAxis(0);
    this.spin = damp(this.spin, -turn * 1.9, 8, dt);
    this.angle = clamp(this.angle + this.spin * dt, -1.6, 1.6);

    const wantsThrust = (this.input.key('Space', 'KeyW', 'ArrowUp') || this.input.down || this.input.gpButton(0) || this.input.gpButton(7)) && this.fuel > 0;
    this.thrusting = wantsThrust;
    if (wantsThrust) {
      const power = 11 + this.level * 0.3;
      this.vel.x += -Math.sin(this.angle) * power * dt;
      this.vel.y += Math.cos(this.angle) * power * dt;
      this.fuel = Math.max(0, this.fuel - 14 * dt);
      if (Math.random() < 0.5) this.burst.burst(new THREE.Vector3(this.pos.x + Math.sin(this.angle) * 0.6, this.pos.y - Math.cos(this.angle) * 0.6, 0), PALETTE.amber, 1, 4);
    }
    this.vel.y -= this.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x = clamp(this.pos.x, -W / 2 + 1, W / 2 - 1);

    this.rocket.position.copy(this.pos);
    this.rocket.rotation.z = this.angle;
    this.flame.visible = wantsThrust;
    this.flame.scale.y = 0.7 + Math.random() * 0.6;

    // Contact with the ground (the rocket's feet are about 0.1 below its position)
    const ground = Math.max(this.terrainAt(this.pos.x - 0.8), this.terrainAt(this.pos.x + 0.8));
    if (this.pos.y <= ground + 0.1) return this.touchdown(ground);
    if (this.pos.y > 60) this.vel.y = Math.min(this.vel.y, 0);

    // Camera follows the rocket, pulling in as it nears the ground.
    const near = clamp(1 - (this.pos.y - ground) / 26, 0, 1);
    this.camera.position.x = damp(this.camera.position.x, this.pos.x * 0.6, 3, dt);
    this.camera.position.y = damp(this.camera.position.y, Math.max(8, this.pos.y * 0.6 + 5 - near * 3), 3, dt);
    this.camera.position.z = damp(this.camera.position.z, 36 - near * 14, 3, dt);
    this.camera.lookAt(this.pos.x * 0.8, this.pos.y * 0.7, 0);

    this.burst.update(dt);
    const alt = Math.max(0, this.pos.y - ground);
    this.hud.stat('Score', this.score);
    this.hud.stat('Altitude', `${alt.toFixed(0)} m`);
    this.hud.stat('Fall speed', `${Math.max(0, -this.vel.y).toFixed(1)}`, -this.vel.y > SAFE_VY);
    this.hud.stat('Sideways', `${Math.abs(this.vel.x).toFixed(1)}`, Math.abs(this.vel.x) > SAFE_VX);
    this.hud.stat('Fuel', `${Math.round(this.fuel)}%`, this.fuel < 20);
  }

  /** The rocket met the ground: a soft, upright, slow landing on the pad wins, anything else is a crash. */
  touchdown(groundY) {
    const onPad = this.pos.x - 0.8 >= this.padX0 - 0.2 && this.pos.x + 0.8 <= this.padX1 + 0.2 && Math.abs(groundY - this.padY) < 0.01;
    const soft = -this.vel.y <= SAFE_VY && Math.abs(this.vel.x) <= SAFE_VX && Math.abs(this.angle) <= SAFE_ANGLE;
    if (onPad && soft) {
      const bonus = Math.round(this.fuel * 2);
      const pts = 100 + bonus;
      this.score += pts;
      this.landings++;
      this.landed = 1.8;
      this.vel.set(0, 0, 0);
      this.pos.y = groundY + 0.1;
      this.rocket.position.copy(this.pos);
      this.flame.visible = false;
      this.burst.burst(this.pos, PALETTE.lime, 24, 8);
      this.audio.win();
      this.hud.toast(`LANDED +${pts}`, 1400);
      return;
    }
    this.burst.burst(this.pos, PALETTE.red, 30, 11);
    this.burst.burst(this.pos, PALETTE.amber, 20, 8);
    this.rocket.visible = false;
    this.audio.boom();
    this.audio.lose();
    const why = !onPad ? 'Missed the pad.' : -this.vel.y > SAFE_VY ? 'Came in too fast.' : Math.abs(this.vel.x) > SAFE_VX ? 'Too much sideways speed.' : 'Not upright.';
    this.end(this.score, `${why} ${this.landings} landing${this.landings === 1 ? '' : 's'}.`);
  }
}
