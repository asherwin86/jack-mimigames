import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, Burst, clamp, damp, rand, pick, shuffle, overlaps,
  PALETTE, COLORS,
} from '../engine/utils.js';

const LANES = [-2.4, 0, 2.4];
const HALF_WIDTH = 3.4;
const SPAWN_Z = -120;
const GRAV = 30;
const JUMP = 10.5;

export default class HurdleRunner extends Game {
  start() {
    sky(this.scene, '#1f3d2e', '#070c0a', 30, 120);
    lights(this.scene, { sky: 0xbdf2c8, groundCol: 0x10201a });

    this.floor = this.add(ground(400, 0x142418));
    this.floor.position.z = -110;

    this.rails = [];
    for (const side of [-1, 1]) {
      const rail = box(0.22, 0.22, 400, glow(PALETTE.lime), { cast: false, receive: false });
      rail.position.set(side * (HALF_WIDTH + 0.5), 0.12, -110);
      this.rails.push(this.add(rail));
    }

    this.player = this.add(box(1.0, 1.5, 1.0, glow(PALETTE.cyan)));
    this.player.position.set(0, 0.75, 0);
    this.playerX = 0;
    this.velY = 0;
    this.grounded = true;
    this.ducking = false;

    this.obstacles = [];
    for (let i = 0; i < 30; i++) {
      const o = box(1.6, 1, 1.6, pick(COLORS));
      o.visible = false;
      o.position.z = 999;
      this.obstacles.push(this.add(o));
    }
    this.pool = [...this.obstacles];
    this.live = [];

    // Coins: some float at head height (grab them on the ground), some high up (you have to jump). +10 m each.
    this.coinPool = [];
    for (let i = 0; i < 10; i++) {
      const c = ball(0.42, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false });
      c.scale.set(1, 1, 0.35);
      c.visible = false;
      c.position.z = 999;
      this.coinPool.push(this.add(c));
    }
    this.coinLive = [];
    this.bonus = 0;

    this.burst = new Burst(this.scene, 70, 0.2);
    this.speed = 20;
    this.distance = 0;
    this.nextSpawn = 1;

    this.camera.position.set(0, 4, 8);
    this.camera.lookAt(0, 1.4, -10);
    this.hud.hint('A / D to change lane · Space to jump hurdles · S to duck under bars · grab coins (+10 m) — the high ones need a jump');
  }

  spawnRow() {
    const lanes = shuffle([0, 1, 2]);
    const blocked = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < blocked; i++) {
      const o = this.pool.pop();
      if (!o) return;
      const isBar = Math.random() < 0.4;
      o.material.color.set(isBar ? PALETTE.violet : PALETTE.amber);
      if (isBar) {
        o.scale.set(1, 0.35, 1);
        o.position.set(LANES[lanes[i]], 2.05, SPAWN_Z);
      } else {
        o.scale.set(1, 0.6, 1);
        o.position.set(LANES[lanes[i]], 0.4, SPAWN_Z);
      }
      o.userData = { bar: isBar };
      o.visible = true;
      this.live.push(o);
    }
    // Sometimes a coin in a lane with nothing in it.
    if (Math.random() < 0.4) {
      const c = this.coinPool.pop();
      if (c) {
        c.userData = { high: Math.random() < 0.5 };
        c.position.set(LANES[lanes[2]], c.userData.high ? 2.4 : 1.0, SPAWN_Z - 4);
        c.visible = true;
        this.coinLive.push(c);
      }
    }
  }

  update(dt) {
    const target = 20 + Math.min(30, this.distance / 55);
    this.speed = damp(this.speed, target, 2.5, dt);
    this.distance += this.speed * dt;

    const dir = this.input.axisX();
    this.playerX = clamp(this.playerX + dir * 14 * dt, -HALF_WIDTH, HALF_WIDTH);
    this.player.position.x = damp(this.player.position.x, this.playerX, 16, dt);

    // Jump
    if ((this.input.hit('Space') || this.input.gpHit(0)) && this.grounded) {
      this.velY = JUMP;
      this.grounded = false;
      this.audio.tone([420, 700], 0.08, { type: 'triangle', gain: 0.11 });
    }
    this.velY -= GRAV * dt;
    this.player.position.y += this.velY * dt;
    if (this.player.position.y <= 0.75) {
      this.player.position.y = 0.75;
      this.velY = 0;
      this.grounded = true;
    }

    // Duck
    this.ducking = (this.input.key('KeyS', 'ArrowDown', 'ControlLeft') || this.input.gpButton(1)) && this.grounded;
    this.player.scale.y = damp(this.player.scale.y, this.ducking ? 0.5 : 1, 16, dt);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawnRow();
      this.nextSpawn = clamp(48 / this.speed, 0.5, 1.6) * rand(0.85, 1.2);
    }

    const dz = this.speed * dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const o = this.live[i];
      o.position.z += dz;
      if (o.position.z > 12) {
        o.visible = false;
        this.live.splice(i, 1);
        this.pool.push(o);
        continue;
      }
      if (Math.abs(o.position.z - this.player.position.z) < 1.6
        && Math.abs(o.position.x - this.player.position.x) < 1.15) {
        const cleared = o.userData.bar
          ? this.player.position.y > 1.55
          : this.player.position.y < 0.5 || this.ducking;
        if (!overlaps(o, this.player, 0.12) || cleared) continue;
        return this.crash(o);
      }
    }

    for (let i = this.coinLive.length - 1; i >= 0; i--) {
      const c = this.coinLive[i];
      c.position.z += dz;
      c.rotation.y += dt * 5;
      const got = Math.abs(c.position.z - this.player.position.z) < 1.3
        && Math.abs(c.position.x - this.player.position.x) < 1.1
        && Math.abs(c.position.y - this.player.position.y) < 1.15;
      if (got) {
        this.bonus += 10;
        this.audio.pickup();
        this.burst.burst(c.position, PALETTE.amber, 8, 5);
      }
      if (got || c.position.z > 12) {
        c.visible = false;
        this.coinLive.splice(i, 1);
        this.coinPool.push(c);
      }
    }

    this.burst.update(dt);
    this.camera.position.x = damp(this.camera.position.x, this.player.position.x * 0.4, 5, dt);
    this.camera.lookAt(this.player.position.x * 0.4, 1.4, -10);

    this.hud.stat('Distance', `${Math.floor(this.distance + this.bonus)} m`);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
  }

  crash(o) {
    this.burst.burst(this.player.position, PALETTE.cyan, 20, 8);
    this.burst.burst(o.position, o.material.color.getHex(), 12, 6);
    this.player.visible = false;
    this.audio.boom();
    this.audio.lose();
    const total = Math.floor(this.distance + this.bonus);
    this.end(total, `You covered ${total} metres.`);
  }
}
