import { Game } from '../engine/Game.js';
import {
  ball, ground, lights, sky, Burst, clamp, rand, pick, PALETTE, COLORS,
} from '../engine/utils.js';

const GRAV = 13;
const LIVES = 3;

export default class FruitSlice extends Game {
  start() {
    sky(this.scene, '#3a1f4a', '#0b0612', 30, 100);
    lights(this.scene, { sky: 0xffc8f0, groundCol: 0x241030 });
    const floor = this.add(ground(80, 0x1a1024));
    floor.position.y = -7;

    this.live = [];
    this.pool = [];
    for (let i = 0; i < 24; i++) {
      const o = ball(0.55, PALETTE.white, { seg: 14 });
      o.visible = false;
      this.pool.push(this.add(o));
    }

    this.burst = new Burst(this.scene, 140, 0.16);
    this.score = 0;
    this.lives = LIVES;
    this.nextSpawn = 0.6;
    this.prevDown = false;

    this.camera.position.set(0, 1.5, 11);
    this.camera.lookAt(0, 1.5, 0);
    this.hud.hint('Hold and drag across the fruit to slice it · avoid the bombs');
  }

  spawn() {
    const o = this.pool.pop();
    if (!o) return;
    const isBomb = Math.random() < 0.18;
    o.material.color.set(isBomb ? 0x1c1e24 : pick(COLORS));
    o.material.emissive.set(isBomb ? 0xff3040 : pick(COLORS));
    o.material.emissiveIntensity = isBomb ? 0.4 : 0.7;
    o.scale.setScalar(isBomb ? 1.1 : rand(0.85, 1.25));
    o.position.set(rand(-5.5, 5.5), -6, rand(-1, 1));
    o.userData = {
      bomb: isBomb,
      vel: { x: rand(-2.2, 2.2), y: rand(9.5, 12.5) },
      sliced: false,
    };
    o.visible = true;
    this.live.push(o);
  }

  update(dt) {
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawn();
      this.nextSpawn = clamp(0.75 - this.score * 0.01, 0.28, 0.75) * rand(0.8, 1.2);
    }

    for (let i = this.live.length - 1; i >= 0; i--) {
      const o = this.live[i];
      const d = o.userData;
      d.vel.y -= GRAV * dt;
      o.position.x += d.vel.x * dt;
      o.position.y += d.vel.y * dt;
      o.rotation.x += dt * 3;
      o.rotation.z += dt * 2;
      if (o.position.y < -8) this.recycle(o, i);
    }

    // A swipe is any drag while the button is held; picking every frame while
    // down is enough to catch a fast pass across several fruit in one stroke.
    if (this.input.down) {
      const hit = this.input.pick(this.camera, this.live, false);
      if (hit) this.slice(hit.object);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '●'.repeat(Math.max(0, this.lives)) || '—', this.lives === 1);
  }

  slice(o) {
    const i = this.live.indexOf(o);
    if (i < 0 || o.userData.sliced) return;
    o.userData.sliced = true;
    if (o.userData.bomb) {
      this.lives--;
      this.burst.burst(o.position, 0xff3040, 26, 8);
      this.audio.boom();
      if (this.lives <= 0) {
        this.recycle(o, i);
        this.audio.lose();
        return this.end(this.score, `Sliced ${this.score} fruit before a bomb got you.`);
      }
      this.hud.toast('BOOM', 700);
    } else {
      this.score++;
      this.burst.burst(o.position, o.material.color.getHex(), 14, 6);
      this.audio.blip(clamp(this.score, 0, 20));
    }
    this.recycle(o, i);
  }

  recycle(o, i) {
    o.visible = false;
    this.live.splice(i, 1);
    this.pool.push(o);
  }
}
