import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  ground, lights, sky, glow, Burst, clamp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const ROUND = 45;
const SIZES = [
  { r: 0.55, points: 30, speed: 1.35 },
  { r: 0.95, points: 15, speed: 1.0 },
  { r: 1.5, points: 8, speed: 0.7 },
];

export default class BubblePop extends Game {
  start() {
    sky(this.scene, '#3ab0e8', '#cdf0ff', 40, 120);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x6ab0d8, intensity: 1.1 });
    const floor = this.add(ground(120, 0x8ad0f0));
    floor.position.y = -12;

    this.bubbles = [];
    this.burst = new Burst(this.scene, 90, 0.25);
    this.score = 0;
    this.timeLeft = ROUND;
    this.combo = 0;
    this.comboT = 0;
    this.pops = 0;
    this.nextSpawn = 0.2;
    this.showCursor = true;
    this._geo = new THREE.SphereGeometry(1, 20, 14);

    this.camera.position.set(0, 0, 22);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('Click the bubbles to pop them · small ones pay most · chain pops for a multiplier · black bombs cost time');
  }

  spawn() {
    const roll = Math.random();
    const kind = roll < 0.12 ? 'bomb' : roll < 0.2 ? 'gold' : 'normal';
    const size = SIZES[Math.floor(rand(0, 3))];
    const colour = kind === 'bomb' ? 0x22252e : kind === 'gold' ? 0xffd23f : COLORS[Math.floor(rand(0, COLORS.length))];
    const m = new THREE.Mesh(this._geo, glow(colour, { emissiveIntensity: kind === 'gold' ? 0.9 : 0.35, transparent: true, opacity: kind === 'bomb' ? 0.95 : 0.82 }));
    m.scale.setScalar(size.r);
    m.position.set(rand(-13, 13), -11 - size.r, rand(-3, 1));
    m.userData = { kind, points: kind === 'gold' ? 100 : size.points, vy: rand(3.2, 5.2) * size.speed * (1 + this.time * 0.01), sway: rand(0, 6.28), r: size.r };
    this.bubbles.push(this.add(m));
  }

  update(dt) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish();
    this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawn();
      this.nextSpawn = clamp(0.5 - this.time * 0.004, 0.16, 0.5) * rand(0.6, 1.3);
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.position.y += b.userData.vy * dt;
      b.position.x += Math.sin(this.time * 1.5 + b.userData.sway) * 0.9 * dt;
      if (b.position.y > 12 + b.userData.r) {
        if (b.userData.kind === 'normal') this.combo = 0;   // one got away
        this.remove(b, i);
      }
    }

    if (this.clickedNow()) {
      const hit = this.pickAt(this.bubbles);
      if (hit) this.pop(hit.object);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Time', Math.ceil(this.timeLeft), this.timeLeft < 8);
    this.hud.stat('Combo', this.combo > 1 ? `×${this.multiplier()}` : '—');
  }

  multiplier() { return clamp(1 + Math.floor(this.combo / 3), 1, 5); }

  pop(b) {
    const i = this.bubbles.indexOf(b);
    if (i < 0) return;
    const u = b.userData;
    this.burst.burst(b.position, b.material.color.getHex(), 12, 7);
    if (u.kind === 'bomb') {
      this.timeLeft = Math.max(0, this.timeLeft - 4);
      this.combo = 0;
      this.audio.boom();
      this.hud.toast('BOMB · -4 s', 700);
    } else {
      this.combo++;
      this.comboT = 1.3;
      const pts = u.points * this.multiplier();
      this.score += pts;
      this.pops++;
      if (u.kind === 'gold') { this.timeLeft = Math.min(ROUND + 10, this.timeLeft + 3); this.hud.toast(`GOLD +${pts} · +3 s`, 700); this.audio.win(); }
      else if (this.multiplier() > 1) this.hud.toast(`+${pts}`, 350);
      this.audio.blip(clamp(this.combo, 0, 16));
    }
    this.remove(b, i);
  }

  remove(b, i) {
    this.scene.remove(b);
    b.material.dispose();
    this.bubbles.splice(i, 1);
  }

  finish() {
    this.audio.win();
    this.end(this.score, `${this.pops} bubbles popped.`);
  }
}
