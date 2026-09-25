import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, mat, labelPlane, Burst, damp, shuffle, PALETTE,
} from '../engine/utils.js';

const COLS = 4;
const ROWS = 4;
const GAP = 2.2;
const FACES = [
  ['A', 0x6ee7ff], ['B', 0xff6ea9], ['C', 0x7bffb0], ['D', 0xffc861],
  ['E', 0xb08cff], ['F', 0xff5f6d], ['G', 0x5b8cff], ['H', 0xf2f6ff],
];
const MISS_PENALTY = 1;   // seconds added for every wrong pair

export default class MemoryMatch extends Game {
  start() {
    sky(this.scene, '#1c2a55', '#080b16', 30, 90);
    lights(this.scene, { sky: 0xbcd0ff, groundCol: 0x141a33 });
    this.add(ground(60, 0x0f1424));

    const deck = shuffle([...FACES.keys(), ...FACES.keys()]);
    this.cards = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const card = box(1.9, 0.35, 1.9, mat(0x4a6bc4, { roughness: 0.55 }));
      card.position.set((c - (COLS - 1) / 2) * GAP, 0.18, (r - (ROWS - 1) / 2) * GAP);
      const label = labelPlane(FACES[deck[i]][0], 1.5, 1.5, { fg: '#0b0e17' });
      label.rotation.x = -Math.PI / 2;
      label.position.y = 0.19;
      label.visible = false;
      card.add(label);
      card.userData = { pair: deck[i], state: 'down', label };
      this.cards.push(this.add(card));
    }

    this.burst = new Burst(this.scene, 80, 0.2);
    this.first = null;
    this.second = null;
    this.lock = 0;
    this.matched = 0;
    this.misses = 0;
    this.elapsed = 0;
    this.showCursor = true;   // a controller gets a cursor: A flips the card under it

    this.camera.position.set(0, 13, 8.5);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click two cards to flip them · matching pairs stay up · a wrong pair costs 1 second · clear the board fast');
  }

  flip(card, up) {
    card.userData.state = up ? 'up' : 'down';
    card.userData.label.visible = up;
    card.material.color.set(up ? FACES[card.userData.pair][1] : 0x4a6bc4);
    card.material.emissive.set(up ? FACES[card.userData.pair][1] : 0x000000);
    card.material.emissiveIntensity = up ? 0.35 : 0;
  }

  update(dt) {
    this.elapsed += dt;

    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0 && this.first && this.second) {
        this.flip(this.first, false);
        this.flip(this.second, false);
        this.first = this.second = null;
      }
    } else if (this.clickedNow()) {
      const hit = this.pickAt(this.cards);
      if (hit && hit.object.userData.state === 'down') this.turn(hit.object);
    }

    for (const c of this.cards) {
      const lifted = c.userData.state !== 'down';
      c.position.y = damp(c.position.y, lifted ? 0.55 : 0.18, 14, dt);
      if (c.userData.state === 'matched') c.rotation.y += dt * 1.2;
    }

    this.burst.update(dt);
    this.hud.stat('Time', this.elapsed.toFixed(1));
    this.hud.stat('Pairs', `${this.matched / 2}/${this.cards.length / 2}`);
    this.hud.stat('Misses', this.misses, this.misses > 5);
  }

  turn(card) {
    this.flip(card, true);
    this.audio.blip(card.userData.pair);
    if (!this.first) { this.first = card; return; }
    this.second = card;
    if (this.first.userData.pair === card.userData.pair) {
      for (const c of [this.first, this.second]) {
        c.userData.state = 'matched';
        this.burst.burst(c.position, FACES[c.userData.pair][1], 12, 6);
      }
      this.matched += 2;
      this.first = this.second = null;
      this.audio.good();
      if (this.matched >= this.cards.length) this.finish();
    } else {
      this.misses++;
      this.elapsed += MISS_PENALTY;
      this.lock = 0.7;
      this.audio.bad();
      this.hud.toast(`+${MISS_PENALTY} s`, 500);
    }
  }

  finish() {
    const t = Math.round(this.elapsed * 10) / 10;
    this.audio.win();
    this.end(t, `Cleared in ${t}s with ${this.misses} wrong pair${this.misses === 1 ? '' : 's'}.`);
  }
}
