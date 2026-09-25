import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, labelPlane, setLabel, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const DIST = 100;
const LANE_X = [-4.5, -1.5, 1.5, 4.5];
const HEATS = 4;
const RIVAL_BASE = [8.6, 9.2, 9.8, 10.4];
const PLACE_PTS = [100, 60, 30, 10];
const COLS = [PALETTE.cyan, PALETTE.pink, PALETTE.lime, PALETTE.amber];

/** A rival's speed t seconds after the gun. */
export const rivalSpeed = (vmax, t) => vmax * (1 - Math.exp(-t / 1.1));

function runner(col) {
  const g = new THREE.Group();
  const torso = box(0.7, 1.1, 0.4, glow(col, { emissiveIntensity: 0.35 }));
  torso.position.y = 1.15;
  const head = ball(0.24, mat(0xf2c9a0));
  head.position.y = 1.95;
  const legA = box(0.22, 0.7, 0.25, mat(0x2a3050));
  const legB = box(0.22, 0.7, 0.25, mat(0x2a3050));
  legA.position.set(-0.17, 0.35, 0);
  legB.position.set(0.17, 0.35, 0);
  g.add(torso, head, legA, legB);
  g.userData.legs = [legA, legB];
  return g;
}

export default class TrackSprint extends Game {
  start() {
    sky(this.scene, '#5aa6f0', '#d8eeff', 80, 260);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    this.add(ground(500, 0x3a8a3a));
    const track = box(LANE_X[3] * 2 + 3.4, 0.1, DIST + 60, mat(0xb8543a, { roughness: 0.9 }));
    track.position.set(0, 0.02, -DIST / 2 + 5);
    this.add(track);
    for (let i = 0; i <= 4; i++) {
      const line = box(0.12, 0.02, DIST + 40, mat(0xffffff), { cast: false });
      line.position.set((i - 2) * 3, 0.08, -DIST / 2 + 5);
      this.add(line);
    }
    const finish = box(LANE_X[3] * 2 + 3.4, 0.03, 0.8, mat(0xffffff), { cast: false });
    finish.position.set(0, 0.09, -DIST);
    this.add(finish);
    const gate = box(LANE_X[3] * 2 + 4, 0.4, 0.4, glow(PALETTE.amber, { emissiveIntensity: 0.6 }));
    gate.position.set(0, 4, -DIST);
    this.add(gate);
    for (const s of [-1, 1]) {
      const post = box(0.3, 4, 0.3, mat(0xeeeeee));
      post.position.set(s * 8.5, 2, -DIST);
      this.add(post);
    }

    this.runners = LANE_X.map((x, i) => { const r = runner(COLS[i]); r.position.set(x, 0, 0); this.add(r); return r; });
    this.board = labelPlane('', 14, 3, { size: 128, fg: '#ffffff', scale: 0.5, aspect: 14 / 3 });
    this.board.position.set(0, 5.5, -6);
    this.add(this.board);
    this.burst = new Burst(this.scene, 40, 0.2);

    this.heat = 0;
    this.score = 0;
    this.results = [];
    this.setup();
    this.camera.position.set(0, 3.2, 9);
    this.camera.lookAt(0, 1.4, -8);
    this.hud.hint('Wait for the gun, then mash A and D (or ← and →, or click) one after the other, as fast as you can — repeating the same key barely helps · jumping the gun costs you the start · 4 heats');
  }

  setup() {
    this.state = 'marks';
    this.t = 0;
    this.gun = rand(1.6, 3.2);
    this.raceT = 0;
    this.pos = [0, 0, 0, 0];      // metres; lane 0 is you
    this.finished_ = [null, null, null, null];
    this.vel = 0;
    this.last = null;
    this.lock = 0;
    this.taps = 0;
    const b = RIVAL_BASE[this.heat];
    this.rivals = [null, b - 0.6 + rand(-0.2, 0.2), b + rand(-0.2, 0.2), b + 0.5 + rand(-0.2, 0.2)];
    this.rivals[0] = 0;
    this.board.visible = true;
    this.say('ON YOUR MARKS');
    this.done = 0;
  }

  say(text) { setLabel(this.board, text, { size: 128, fg: '#ffffff', scale: 0.5 }); }

  /** A tap of 'L' or 'R'. Returns the speed gained. */
  tap(side) {
    if (this.state === 'marks') {   // jumped the gun: locked out for a moment
      this.lock = 0.9;
      this.falseStart = true;
      this.audio.bad();
      return 0;
    }
    if (this.state !== 'run' || this.lock > 0) return 0;
    const gain = side !== this.last ? 1.0 : 0.2;
    this.last = side;
    this.vel += gain;
    this.taps++;
    return gain;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    this.lock = Math.max(0, this.lock - dt);

    // input: alternate sides from the keys or clicks
    const l = this.input.hit('KeyA', 'ArrowLeft') || this.input.gpHit(4);
    const r = this.input.hit('KeyD', 'ArrowRight') || this.input.gpHit(5);
    if (l) this.tap('L');
    if (r) this.tap('R');
    if (this.input.clicked || this.input.gpHit(0)) this.tap(this.last === 'L' ? 'R' : 'L');

    if (this.state === 'marks') {
      this.t += dt;
      if (this.t > this.gun - 0.9 && this.t < this.gun) this.say('SET');
      if (this.t >= this.gun) { this.state = 'run'; this.say('GO!'); this.audio.good(); this.raceT = 0; }
    } else if (this.state === 'run') {
      this.raceT += dt;
      if (this.raceT > 0.8) this.board.visible = false;
      // you
      this.vel *= Math.exp(-0.8 * dt);
      const startLag = this.lock > 0 ? 0 : 1;
      if (this.finished_[0] === null) {
        this.pos[0] += this.vel * dt * startLag;
        if (this.pos[0] >= DIST) this.cross(0);
      }
      for (let i = 1; i < 4; i++) {
        if (this.finished_[i] !== null) continue;
        this.pos[i] += rivalSpeed(this.rivals[i], this.raceT) * dt;
        if (this.pos[i] >= DIST) this.cross(i);
      }
      if (this.finished_[0] !== null) {
        this.after = (this.after ?? 2.6) - dt;
        if (this.after <= 0) this.endHeat();
      }
    } else if (this.state === 'between') {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.heat++;
        if (this.heat >= HEATS) return this.finish();
        this.after = undefined;
        this.setup();
      }
    }

    this.runners.forEach((rn, i) => {
      rn.position.z = -this.pos[i];
      const speed = i === 0 ? this.vel : rivalSpeed(this.rivals[i] ?? 0, this.raceT);
      const swing = Math.sin(this.time * (6 + speed * 1.4)) * Math.min(0.9, speed * 0.1);
      rn.userData.legs[0].rotation.x = swing;
      rn.userData.legs[1].rotation.x = -swing;
    });
    this.camera.position.z = damp(this.camera.position.z, 9 - this.pos[0], 6, dt);
    this.camera.lookAt(0, 1.4, -this.pos[0] - 16);
    this.hud.stat('Heat', `${Math.min(this.heat + 1, HEATS)}/${HEATS}`);
    this.hud.stat('Score', this.score);
    this.hud.stat('Speed', `${this.vel.toFixed(1)} m/s`);
    this.hud.stat('Distance', `${Math.min(DIST, Math.floor(this.pos[0]))} m`);
  }

  cross(i) {
    this.done++;
    this.finished_[i] = { place: this.done, time: this.raceT };
    if (i === 0) {
      this.audio[this.done <= 2 ? 'win' : 'blip'](...(this.done <= 2 ? [] : [4]));
      this.say(`${['1ST!', '2ND', '3RD', '4TH'][this.done - 1]}  ${this.raceT.toFixed(2)} s`);
      this.board.visible = true;
    }
  }

  endHeat() {
    const f = this.finished_[0];
    // anyone still running finishes behind you in order of distance
    const place = f.place;
    let pts = PLACE_PTS[place - 1] + Math.max(0, Math.round((13 - f.time) * 8));
    if (this.falseStart) pts = Math.max(0, pts - 20);
    this.score += pts;
    this.results.push({ place, time: f.time, pts });
    this.hud.toast(`HEAT ${this.heat + 1}: ${['1st', '2nd', '3rd', '4th'][place - 1]} · +${pts}`, 1400);
    this.falseStart = false;
    this.state = 'between';
    this.wait = 1.8;
  }

  finish() {
    const wins = this.results.filter((r) => r.place === 1).length;
    this.audio[wins >= 2 ? 'win' : 'lose']();
    this.end(this.score, `${wins} win${wins === 1 ? '' : 's'} in ${HEATS} heats — ${this.score} points.`);
  }
}
