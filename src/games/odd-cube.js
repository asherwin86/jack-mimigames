import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, mat, Burst, damp, rand, randInt, PALETTE,
} from '../engine/utils.js';

const TIME = 60;
const AREA = 12;   // the board is always this wide, whatever the grid size

/** Grid size for a given number of correct answers so far. */
export const sizeFor = (correct) => Math.min(7, 2 + Math.floor(correct / 2));
/** How different the odd tile is (lightness), shrinking as you go. */
export const deltaFor = (correct) => Math.max(0.035, 0.26 - correct * 0.011);

export default class OddCube extends Game {
  start() {
    sky(this.scene, '#1b2233', '#07090e', 30, 90);
    lights(this.scene, { sky: 0xe4ecff, groundCol: 0x10141e });
    this.add(ground(70, 0x0d1119));
    this.burst = new Burst(this.scene, 40, 0.2);
    this.group = null;
    this.correct = 0;
    this.timeLeft = TIME;
    this.showCursor = true;
    this.deal();
    this.camera.position.set(0, 15, 8);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('One tile is a slightly different shade — click it! · a wrong guess costs 3 seconds · the board grows and the shades get closer');
  }

  deal() {
    if (this.group) this.scene.remove(this.group);
    this.group = this.add(new THREE.Group());
    const n = sizeFor(this.correct);
    const size = AREA / n;
    const hue = Math.random();
    const l = rand(0.4, 0.6);
    const d = deltaFor(this.correct) * (Math.random() < 0.5 ? 1 : -1);
    this.odd = randInt(0, n * n - 1);
    this.tiles = [];
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const t = box(size - 0.14, 0.4, size - 0.14, mat(new THREE.Color().setHSL(hue, 0.65, i === this.odd ? l + d : l), { roughness: 0.6 }));
      t.position.set(c * size - ((n - 1) * size) / 2, 0.2, r * size - ((n - 1) * size) / 2);
      t.userData.i = i;
      this.tiles.push(t);
      this.group.add(t);
    }
  }

  /** Answer with a tile index. Returns true for the odd one. */
  guess(i) {
    if (i === this.odd) {
      this.correct++;
      this.audio.blip(Math.min(12, 2 + this.correct));
      this.burst.burst(this.tiles[i].position.clone().setY(0.6), PALETTE.lime, 10, 6);
      this.deal();
      return true;
    }
    this.timeLeft -= 3;
    this.audio.bad();
    this.hud.toast('−3 s', 500);
    this.tiles[i].position.y = -0.1;
    return false;
  }

  update(dt) {
    this.timeLeft -= dt;
    this.burst.update(dt);
    for (const t of this.tiles) t.position.y = damp(t.position.y, 0.2, 10, dt);
    this.hud.stat('Found', this.correct);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 10);
    if (this.timeLeft <= 0) return this.finish();
    if (this.clickedNow()) {
      const hit = this.pickAt(this.tiles);
      if (hit) this.guess(hit.object.userData.i);
    }
  }

  finish() {
    this.audio.lose();
    this.end(this.correct, `You spotted ${this.correct} odd tile${this.correct === 1 ? '' : 's'}.`);
  }
}
