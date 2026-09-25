import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, PALETTE,
} from '../engine/utils.js';

const SIZES = [5, 6, 7, 8];
const TIME = 240;
const CELL = 1.55;

/** Queens as [r, c] pairs; returns the pairs of queens that attack one another. */
export function conflicts(queens) {
  const bad = [];
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const [a, b] = queens[i];
      const [x, y] = queens[j];
      if (a === x || b === y || Math.abs(a - x) === Math.abs(b - y)) bad.push([i, j]);
    }
  }
  return bad;
}

export default class EightQueens extends Game {
  start() {
    sky(this.scene, '#3a1c3a', '#0c060c', 30, 90);
    lights(this.scene, { sky: 0xffd0f0, groundCol: 0x2a1028 });
    this.add(ground(60, 0x180a18));
    this.burst = new Burst(this.scene, 60, 0.2);
    this.round = 0;
    this.solved = 0;
    this.timeLeft = TIME;
    this.pause = 0;
    this.group = null;
    this.showCursor = true;
    this.build(SIZES[0]);
    this.camera.position.set(0, 15, 7);
    this.camera.lookAt(0, 0, 0.6);
    this.hud.hint('Click a square to place or remove a queen · no two queens may share a row, column or diagonal · fill the whole board — it gets bigger each time');
  }

  build(n) {
    if (this.group) this.scene.remove(this.group);
    this.group = this.add(new THREE.Group());
    this.n = n;
    this.queens = [];
    this.meshes = new Map();
    this.tiles = [];
    const off = ((n - 1) * CELL) / 2;
    this.off = off;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const t = box(CELL - 0.06, 0.3, CELL - 0.06, mat((r + c) % 2 ? 0x5a3a63 : 0xa88fb5, { roughness: 0.6 }));
        t.position.set(c * CELL - off, 0.15, r * CELL - off);
        t.userData = { r, c, base: (r + c) % 2 ? 0x5a3a63 : 0xa88fb5 };
        this.tiles.push(t);
        this.group.add(t);
      }
    }
  }

  /** Places or lifts a queen. Returns true when the board is now a full, conflict-free set. */
  toggle(r, c) {
    if (r < 0 || r >= this.n || c < 0 || c >= this.n) return false;
    const i = this.queens.findIndex(([a, b]) => a === r && b === c);
    if (i >= 0) {
      this.queens.splice(i, 1);
      const m = this.meshes.get(r * this.n + c);
      this.group.remove(m);
      this.meshes.delete(r * this.n + c);
      this.audio.blip(2);
      return false;
    }
    if (this.queens.length >= this.n) { this.audio.bad(); return false; }
    this.queens.push([r, c]);
    const q = new THREE.Group();
    const body = cyl(0.3, 0.5, 1.1, glow(PALETTE.amber, { emissiveIntensity: 0.3 }));
    body.position.y = 0.85;
    const head = ball(0.32, glow(PALETTE.amber, { emissiveIntensity: 0.5 }));
    head.position.y = 1.65;
    q.add(body, head);
    q.position.set(c * CELL - this.off, 0.3, r * CELL - this.off);
    this.group.add(q);
    this.meshes.set(r * this.n + c, q);
    this.audio.thud();
    if (this.queens.length === this.n && conflicts(this.queens).length === 0) { this.boardDone(); return true; }
    return false;
  }

  boardDone() {
    this.solved++;
    this.timeLeft += 20;
    this.audio.good();
    this.hud.toast(`${this.n} QUEENS · SOLVED`, 1000);
    for (const q of this.meshes.values()) this.burst.burst(q.position, PALETTE.lime, 8, 7);
    this.pause = 1.2;
  }

  update(dt) {
    this.burst.update(dt);
    const bad = new Set();
    for (const [i, j] of conflicts(this.queens)) { bad.add(i); bad.add(j); }
    this.queens.forEach(([r, c], i) => {
      const q = this.meshes.get(r * this.n + c);
      q.children.forEach((m) => { m.material.color.setHex(bad.has(i) ? PALETTE.red : PALETTE.amber); m.material.emissive.setHex(bad.has(i) ? PALETTE.red : PALETTE.amber); });
    });
    // Shade the squares a placed queen attacks.
    for (const t of this.tiles) {
      const { r, c } = t.userData;
      const attacked = this.queens.some(([a, b]) => (a !== r || b !== c) && (a === r || b === c || Math.abs(a - r) === Math.abs(b - c)));
      t.material.color.setHex(attacked ? 0x7a2f4a : t.userData.base);
    }
    this.hud.stat('Board', `${this.n}×${this.n}`);
    this.hud.stat('Queens', `${this.queens.length}/${this.n}`);
    this.hud.stat('Solved', this.solved);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 20);

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        this.round++;
        if (this.round >= SIZES.length) return this.finish(true);
        this.build(SIZES[this.round]);
      }
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.finish(false);
    if (this.clickedNow()) {
      const hit = this.pickAt([...this.tiles, ...this.group.children.filter((o) => o.isGroup)], true);
      if (hit) {
        let o = hit.object;
        while (o && o.userData.r === undefined && o.parent !== this.group) o = o.parent;
        if (o?.userData.r !== undefined) this.toggle(o.userData.r, o.userData.c);
        else if (o) {
          const c = Math.round((o.position.x + this.off) / CELL);
          const r = Math.round((o.position.z + this.off) / CELL);
          this.toggle(r, c);
        }
      }
    }
  }

  finish(all) {
    this.audio[all ? 'win' : 'lose']();
    const score = this.solved * 100 + (all ? Math.max(0, Math.floor(this.timeLeft)) : 0);
    this.end(score, all ? `All four boards solved with ${Math.floor(this.timeLeft)} s left!` : `You solved ${this.solved} board${this.solved === 1 ? '' : 's'}.`);
  }
}
