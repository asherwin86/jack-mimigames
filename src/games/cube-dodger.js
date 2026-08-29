import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, Burst, clamp, damp, rand, pick, shuffle, overlaps,
  PALETTE, COLORS,
} from '../engine/utils.js';

const LANES = [-4.8, -2.4, 0, 2.4, 4.8];
const HALF_WIDTH = 5.6;
const SPAWN_Z = -140;

export default class CubeDodger extends Game {
  start() {
    sky(this.scene, '#241a4d', '#080a14', 30, 130);
    lights(this.scene, { sky: 0xa88cff, groundCol: 0x1a1030 });

    this.floor = this.add(ground(400, 0x151a2e));
    this.floor.position.z = -120;

    // Glowing rails down each side of the corridor.
    this.rails = [];
    for (const side of [-1, 1]) {
      const rail = box(0.25, 0.25, 400, glow(PALETTE.cyan), { cast: false, receive: false });
      rail.position.set(side * (HALF_WIDTH + 0.6), 0.15, -120);
      this.rails.push(this.add(rail));
    }

    // Dashes that stream past to sell the speed.
    this.dashes = [];
    for (let i = 0; i < 30; i++) {
      const d = box(0.18, 0.04, 3.2, glow(0x5b6ea8, { emissiveIntensity: 0.4 }), { cast: false });
      d.position.set(0, 0.03, -i * 8);
      this.dashes.push(this.add(d));
    }

    this.player = this.add(box(1.1, 1.1, 1.6, glow(PALETTE.lime), { pos: [0, 0.62, 0] }));
    this.playerX = 0;
    this.tilt = 0;

    this.obstacles = [];
    for (let i = 0; i < 42; i++) {
      const o = box(2.0, 1.8, 2.0, pick(COLORS));
      o.visible = false;
      o.position.z = 999;
      this.obstacles.push(this.add(o));
    }
    this.pool = [...this.obstacles];
    this.live = [];

    this.burst = new Burst(this.scene, 80, 0.2);

    this.speed = 22;
    this.distance = 0;
    this.boost = 1;
    this.nextSpawn = 0;
    this.shake = 0;

    this.camera.position.set(0, 4.4, 8.5);
    this.camera.lookAt(0, 1, -12);
    this.audio.tone([180, 420], 0.25, { type: 'triangle', gain: 0.1 });
  }

  spawnRow() {
    const lanes = shuffle([0, 1, 2, 3, 4]);
    const blocked = Math.min(3, 1 + Math.floor(this.distance / 400));
    for (let i = 0; i < blocked; i++) {
      const o = this.pool.pop();
      if (!o) return;
      const h = rand(1.4, 2.6);
      o.scale.set(1, h / 1.8, 1);
      o.material.color.set(pick(COLORS));
      o.position.set(LANES[lanes[i]] + rand(-0.3, 0.3), h / 2, SPAWN_Z);
      o.rotation.y = rand(-0.2, 0.2);
      o.visible = true;
      this.live.push(o);
    }
  }

  update(dt) {
    const boosting = this.input.key('ShiftLeft', 'ShiftRight') && this.boost > 0.02;
    this.boost = clamp(this.boost + (boosting ? -0.42 : 0.18) * dt, 0, 1);

    const target = 22 + Math.min(38, this.distance / 60);
    this.speed = damp(this.speed, target * (boosting ? 1.55 : 1), 3, dt);
    this.distance += this.speed * dt;

    // Steering
    const dir = this.input.axisX();
    this.playerX = clamp(this.playerX + dir * 15 * dt, -HALF_WIDTH, HALF_WIDTH);
    this.player.position.x = damp(this.player.position.x, this.playerX, 18, dt);
    this.tilt = damp(this.tilt, -dir * 0.45, 9, dt);
    this.player.rotation.z = this.tilt;
    this.player.position.y = 0.62 + Math.sin(this.time * 9) * 0.04;

    // Scroll the world toward the player
    const dz = this.speed * dt;
    for (const d of this.dashes) {
      d.position.z += dz;
      if (d.position.z > 12) d.position.z -= 240;
    }

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawnRow();
      this.nextSpawn = clamp(46 / this.speed, 0.32, 1.4) * rand(0.85, 1.25);
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const o = this.live[i];
      o.position.z += dz;
      if (o.position.z > 14) {
        o.visible = false;
        this.live.splice(i, 1);
        this.pool.push(o);
        continue;
      }
      if (Math.abs(o.position.z - this.player.position.z) < 2.2 && overlaps(o, this.player, 0.18)) {
        this.crash(o);
        return;
      }
    }

    this.burst.update(dt);

    // Camera trails the ship with a touch of speed-shake.
    this.shake = Math.max(0, this.shake - dt * 4);
    const sway = this.player.position.x * 0.35;
    this.camera.position.x = damp(this.camera.position.x, sway, 5, dt) + rand(-1, 1) * this.shake;
    this.camera.position.y = 4.4 + (boosting ? -0.35 : 0);
    this.camera.position.z = damp(this.camera.position.z, boosting ? 7.4 : 8.5, 4, dt);
    this.camera.lookAt(sway * 0.5, 1, -14);
    this.camera.fov = damp(this.camera.fov, boosting ? 78 : 65, 4, dt);
    this.camera.updateProjectionMatrix();

    this.hud.stat('Distance', `${Math.floor(this.distance)} m`);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
    this.hud.stat('Boost', `${Math.round(this.boost * 100)}%`, this.boost < 0.2);
  }

  crash(o) {
    this.burst.burst(this.player.position, PALETTE.lime, 22, 9);
    this.burst.burst(o.position, o.material.color.getHex(), 14, 7);
    this.player.visible = false;
    this.audio.boom();
    this.audio.lose();
    this.end(Math.floor(this.distance), `You covered ${Math.floor(this.distance)} metres.`);
  }
}
