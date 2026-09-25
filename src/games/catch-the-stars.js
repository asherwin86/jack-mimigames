import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';
import * as THREE from 'three';

const HALF = 9;
const TOP = 14;
const LIVES = 3;

export default class CatchTheStars extends Game {
  start() {
    sky(this.scene, '#241a5c', '#07040f', 40, 130);
    lights(this.scene, { sky: 0xd0c0ff, groundCol: 0x160f33 });
    const floor = this.add(ground(80, 0x120c28));
    floor.position.y = -0.4;

    this.basket = this.add(new THREE.Group());
    const bowl = cyl(1.9, 1.3, 1.1, glow(PALETTE.cyan, { emissiveIntensity: 0.35 }));
    bowl.position.y = 0.55;
    this.basket.add(bowl);
    this.basket.position.set(0, 0, 0);
    this.baskX = 0;

    this.items = [];
    this.burst = new Burst(this.scene, 80, 0.22);
    this.score = 0;
    this.lives = LIVES;
    this.caught = 0;
    this.nextSpawn = 0.6;
    this.showCursor = true;

    this.camera.position.set(0, 6, 17);
    this.camera.lookAt(0, 6.5, 0);
    this.hud.hint('Move the mouse, or A / D, to slide the basket · catch stars, gold is worth more · dodge the bombs');
  }

  spawn() {
    const roll = Math.random();
    const kind = roll < 0.18 ? 'bomb' : roll < 0.3 ? 'gold' : roll < 0.36 && this.lives < LIVES ? 'heart' : 'star';
    const col = kind === 'bomb' ? 0x22242c : kind === 'gold' ? PALETTE.amber : kind === 'heart' ? PALETTE.pink : PALETTE.white;
    const m = new THREE.Mesh(
      kind === 'bomb' ? new THREE.SphereGeometry(0.75, 14, 10) : new THREE.OctahedronGeometry(kind === 'gold' ? 0.85 : 0.65),
      glow(kind === 'bomb' ? 0x22242c : col, { emissiveIntensity: kind === 'bomb' ? 0 : 0.9 }),
    );
    if (kind === 'bomb') { m.material.emissive.setHex(0xff3040); m.material.emissiveIntensity = 0.35; }
    m.position.set(rand(-HALF, HALF), TOP, 0);
    m.userData = { kind, vy: -rand(4, 6) - Math.min(9, this.caught * 0.12), spin: rand(1, 3) };
    this.items.push(this.add(m));
  }

  update(dt) {
    // The basket follows the pointer (mouse or the controller's cursor); keys nudge it too.
    const aim = this.input.activePointer();
    const key = this.input.axisX();
    if (key) this.baskX = clamp(this.baskX + key * 16 * dt, -HALF, HALF);
    else if (this.input.pixel.lengthSq() > 0 || this.input.usingGamepadPointer) this.baskX = damp(this.baskX, clamp(aim.x * HALF * 1.25, -HALF, HALF), 12, dt);
    this.basket.position.x = damp(this.basket.position.x, this.baskX, 22, dt);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawn();
      this.nextSpawn = clamp(0.95 - this.caught * 0.012, 0.32, 0.95) * rand(0.75, 1.25);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.position.y += it.userData.vy * dt;
      it.rotation.y += it.userData.spin * dt;
      const inBasket = it.position.y < 1.4 && it.position.y > 0.2 && Math.abs(it.position.x - this.basket.position.x) < 2.0;
      if (inBasket) { this.catchItem(it); this.remove(it, i); continue; }
      if (it.position.y < -1) {
        if (it.userData.kind === 'star' || it.userData.kind === 'gold') { this.audio.tone(140, 0.05, { type: 'sine', gain: 0.05 }); }
        this.remove(it, i);
        if (this.finished) return;
      }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
    this.hud.stat('Caught', this.caught);
  }

  catchItem(it) {
    const k = it.userData.kind;
    if (k === 'bomb') {
      this.lives--;
      this.burst.burst(it.position, PALETTE.red, 22, 9);
      this.audio.boom();
      if (this.lives <= 0) {
        this.audio.lose();
        this.end(this.score, `${this.caught} caught before the bombs won.`);
      } else this.hud.toast('BOOM', 600);
      return;
    }
    if (k === 'heart') { this.lives = Math.min(LIVES, this.lives + 1); this.hud.toast('LIFE BACK', 700); this.audio.good(); return; }
    this.caught++;
    this.score += k === 'gold' ? 30 : 10;
    this.burst.burst(it.position, k === 'gold' ? PALETTE.amber : PALETTE.white, 10, 6);
    this.audio.blip(clamp(this.caught % 15, 0, 14));
  }

  remove(it, i) {
    this.scene.remove(it);
    it.geometry.dispose();
    it.material.dispose();
    this.items.splice(i, 1);
  }
}
