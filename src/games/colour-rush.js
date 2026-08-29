import { Game } from '../engine/Game.js';
import {
  box, ground, lights, sky, glow, Burst, clamp, damp, shuffle, randInt,
  PALETTE, COLORS,
} from '../engine/utils.js';

const PADS = 4;

export default class ColourRush extends Game {
  start() {
    sky(this.scene, '#0f2f45', '#04080d', 22, 70);
    lights(this.scene, { sky: 0xa8e8ff, groundCol: 0x0f2029 });
    this.add(ground(60, 0x0d1a24));

    // The beacon shows the colour you are chasing.
    this.beacon = this.add(box(3, 3, 3, glow(PALETTE.white, { emissiveIntensity: 1 })));
    this.beacon.position.set(0, 5.5, -4);

    this.pads = [];
    for (let i = 0; i < PADS; i++) {
      const pad = box(4.2, 0.8, 4.2, glow(COLORS[i], { emissiveIntensity: 0.55 }));
      pad.position.set(-7.5 + i * 5, 0.4, 5);
      pad.userData = { index: i, flash: 0, base: 0.4 };
      this.pads.push(this.add(pad));
    }

    this.burst = new Burst(this.scene, 80, 0.22);
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.lives = 3;
    this.inverted = false;
    this.limit = 2.2;
    this.clock = 0;
    this.round = 0;
    this.newRound();

    this.camera.position.set(0, 11, 15);
    this.camera.lookAt(0, 2, 0);
    this.hud.hint('Click the pad matching the beacon · when the beacon flashes white, click any pad that does NOT match');
  }

  newRound() {
    this.round++;
    // Reshuffle the pad colours so position never becomes muscle memory.
    const cols = shuffle(COLORS.slice(0, PADS + 2)).slice(0, PADS);
    this.pads.forEach((p, i) => {
      p.userData.colour = cols[i];
      p.material.color.set(cols[i]);
      p.material.emissive.set(cols[i]);
    });

    this.target = cols[randInt(0, PADS - 1)];
    // Inverted rounds start appearing once the player is warmed up.
    this.inverted = this.round > 5 && Math.random() < 0.22;
    this.beacon.material.color.set(this.inverted ? PALETTE.white : this.target);
    this.beacon.material.emissive.set(this.inverted ? PALETTE.white : this.target);
    this.beaconTint = this.target;

    this.limit = clamp(2.3 - this.round * 0.035, 0.85, 2.3);
    this.clock = this.limit;
    this.audio.tone(this.inverted ? 300 : 520, 0.07, { type: 'sine', gain: 0.08 });
  }

  update(dt) {
    this.clock -= dt;
    if (this.clock <= 0) return this.wrong('Too slow.');

    this.beacon.rotation.y += dt * (this.inverted ? 4 : 1.4);
    this.beacon.rotation.x += dt * 0.6;
    this.beacon.position.y = 5.5 + Math.sin(this.time * 3) * 0.25;
    if (this.inverted) {
      // Strobe between white and the target colour: the white says "inverted",
      // the colour still tells you which pad to avoid.
      const hex = Math.sin(this.time * 11) > 0 ? 0xffffff : this.beaconTint;
      this.beacon.material.color.setHex(hex);
      this.beacon.material.emissive.setHex(hex);
    }

    for (const p of this.pads) {
      p.userData.flash = Math.max(0, p.userData.flash - dt * 3);
      p.position.y = damp(p.position.y, p.userData.base + p.userData.flash * 0.6, 14, dt);
      p.material.emissiveIntensity = damp(p.material.emissiveIntensity, 0.55 + p.userData.flash, 12, dt);
    }

    if (this.input.clicked) {
      const hit = this.input.pick(this.camera, this.pads, false);
      if (hit) this.choose(hit.object);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Streak', this.streak);
    this.hud.stat('Time', this.clock.toFixed(2), this.clock < this.limit * 0.35);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
  }

  choose(pad) {
    pad.userData.flash = 1;
    const matches = pad.userData.colour === this.target;
    const correct = this.inverted ? !matches : matches;

    if (!correct) return this.wrong(this.inverted ? 'That one matched.' : 'Wrong colour.');

    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const speedBonus = Math.round((this.clock / this.limit) * 60);
    this.score += 40 + speedBonus + (this.inverted ? 40 : 0);
    this.burst.burst(pad.position, pad.userData.colour, 10, 5);
    this.audio.blip(clamp(this.streak, 0, 18));
    if (this.streak % 10 === 0) { this.hud.toast(`${this.streak} STREAK`); this.audio.good(); }
    this.newRound();
  }

  wrong(why) {
    this.streak = 0;
    this.lives--;
    this.audio.bad();
    this.burst.burst(this.beacon.position, PALETTE.red, 14, 6);
    if (this.lives <= 0) {
      this.audio.lose();
      return this.end(this.score, `${why} Best streak ${this.bestStreak} over ${this.round} rounds.`);
    }
    this.hud.toast(why, 700);
    this.newRound();
  }
}
