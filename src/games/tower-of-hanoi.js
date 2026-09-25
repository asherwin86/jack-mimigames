import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, damp, COLORS, PALETTE,
} from '../engine/utils.js';

const START_DISCS = 3;
const MAX_DISCS = 7;
const PEG_X = [-7, 0, 7];
const DISC_H = 0.6;
const TIME = 150;

/** The fewest moves that solve n discs. */
export const optimalMoves = (n) => 2 ** n - 1;

export default class TowerOfHanoi extends Game {
  start() {
    sky(this.scene, '#2b2140', '#0b0812', 30, 90);
    lights(this.scene, { sky: 0xe3d4ff, groundCol: 0x1d1530 });
    this.add(ground(60, 0x150f20));

    const base = box(20, 0.5, 5, mat(0x5a4632));
    base.position.y = 0.25;
    this.add(base);
    this.zones = [];
    for (let p = 0; p < 3; p++) {
      const pole = cyl(0.22, 0.22, 6, mat(0xbba98a));
      pole.position.set(PEG_X[p], 3.3, 0);
      this.add(pole);
      const zone = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 4), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      zone.position.set(PEG_X[p], 4, 0);
      zone.userData.peg = p;
      this.zones.push(this.add(zone));
    }

    this.burst = new Burst(this.scene, 60, 0.2);
    this.discs = [];
    this.round = 0;
    this.points = 0;
    this.timeLeft = TIME;
    this.held = null;
    this.moves = 0;
    this.pause = 0;
    this.showCursor = true;
    this.deal(START_DISCS);

    this.camera.position.set(0, 8, 15);
    this.camera.lookAt(0, 3, 0);
    this.hud.hint('Click a tower to lift its top disc, click another to drop it · a disc never goes on a smaller one · 1 / 2 / 3 also pick towers · move the whole stack across');
  }

  deal(n) {
    for (const d of this.discs) this.scene.remove(d);
    this.n = n;
    this.pegs = [[], [], []];
    this.discs = [];
    this.moves = 0;
    this.held = null;
    for (let size = n; size >= 1; size--) {
      const d = cyl(0.55 + size * 0.28, 0.55 + size * 0.28, DISC_H - 0.06, mat(COLORS[size % COLORS.length], { roughness: 0.5 }));
      d.userData.size = size;
      this.discs.push(this.add(d));
      this.pegs[0].push(size);
    }
    this.layout(true);
  }

  layout(snap = false) {
    this.discs.forEach((d) => {
      for (let p = 0; p < 3; p++) {
        const i = this.pegs[p].indexOf(d.userData.size);
        if (i >= 0) {
          d.userData.target = new THREE.Vector3(PEG_X[p], 0.5 + DISC_H * (i + 0.5), 0);
          if (this.held && this.held.from === p && i === this.pegs[p].length - 1) d.userData.target.y = 7.6;
        }
      }
      if (snap) d.position.copy(d.userData.target);
    });
  }

  /** Lift the top disc of a peg, or drop the held one there. Returns whether anything happened. */
  select(p) {
    if (p < 0 || p > 2) return false;
    if (!this.held) {
      if (!this.pegs[p].length) return false;
      this.held = { from: p, size: this.pegs[p].at(-1) };
      this.audio.blip(2);
      this.layout();
      return true;
    }
    if (p === this.held.from) { this.held = null; this.layout(); return true; }
    const top = this.pegs[p].at(-1);
    if (top !== undefined && top < this.held.size) { this.audio.bad(); return false; }
    this.pegs[this.held.from].pop();
    this.pegs[p].push(this.held.size);
    this.held = null;
    this.moves++;
    this.audio.thud();
    this.layout();
    if (this.pegs[2].length === this.n) this.solved();
    return true;
  }

  solved() {
    const pts = Math.round(this.n * 20 * optimalMoves(this.n) / this.moves);
    this.points += pts;
    this.round++;
    this.timeLeft += 12;
    this.audio.good();
    this.hud.toast(`SOLVED · +${pts}`, 1000);
    this.burst.burst(new THREE.Vector3(PEG_X[2], 3, 0), PALETTE.lime, 26, 9);
    this.pause = 1.1;
  }

  update(dt) {
    this.burst.update(dt);
    for (const d of this.discs) {
      const t = d.userData.target;
      if (t) d.position.set(damp(d.position.x, t.x, 14, dt), damp(d.position.y, t.y, 14, dt), 0);
    }
    this.hud.stat('Points', this.points);
    this.hud.stat('Discs', this.n);
    this.hud.stat('Moves', `${this.moves} (best ${optimalMoves(this.n)})`);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 20);

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        if (this.n >= MAX_DISCS) return this.finish(true);
        this.deal(this.n + 1);
      }
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish(false);

    for (let p = 0; p < 3; p++) if (this.input.hit(`Digit${p + 1}`, `Numpad${p + 1}`)) this.select(p);
    if (this.clickedNow()) {
      const hit = this.pickAt([...this.zones, ...this.discs]);
      if (hit) {
        const peg = hit.object.userData.peg ?? this.pegs.findIndex((s) => s.includes(hit.object.userData.size));
        this.select(peg);
      }
    }
  }

  finish(all) {
    this.audio[all ? 'win' : 'lose']();
    this.end(this.points, all ? `Every tower solved! ${this.points} points.` : `You solved ${this.round} tower${this.round === 1 ? '' : 's'} before time ran out.`);
  }
}
