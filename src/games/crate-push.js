import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, PALETTE,
} from '../engine/utils.js';

const S = 1.6;
const TIME = 300;

// # wall   . goal   $ crate   * crate on goal   @ you   + you on a goal
export const LEVELS = [
  ['#######', '#@ $ .#', '#######'],
  ['#######', '#  .  #', '# $@$ #', '#  .  #', '#######'],
  ['####  ', '# .#  ', '#  ###', '#*@  #', '#  $ #', '#  ###', '####  '],
  ['######', '#    #', '# #@ #', '# $* #', '# .* #', '#    #', '######'],
  ['  ####', '###  ####', '#     $ #', '# #  #$ #', '# . .#@ #', '#########'],
  ['########', '#      #', '# .**$@#', '#      #', '#####  #', '    ####'],
  [' #######', ' #     #', ' # .$. #', '## $@$ #', '#  .$. #', '#      #', '########'],
];

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Parses a level into a plain state: { w, h, walls, goals, crates, player }; sets of "x,y". */
export function parseLevel(rows) {
  const st = { w: Math.max(...rows.map((r) => r.length)), h: rows.length, walls: new Set(), goals: new Set(), crates: new Set(), player: null };
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const k = `${x},${y}`;
    if (ch === '#') st.walls.add(k);
    if (ch === '.' || ch === '*' || ch === '+') st.goals.add(k);
    if (ch === '$' || ch === '*') st.crates.add(k);
    if (ch === '@' || ch === '+') st.player = [x, y];
  }));
  return st;
}

/** Tries a step; returns a new { player, crates } or null when blocked. */
export function stepState(st, player, crates, dx, dy) {
  const nx = player[0] + dx;
  const ny = player[1] + dy;
  const k = `${nx},${ny}`;
  if (st.walls.has(k)) return null;
  if (crates.has(k)) {
    const bk = `${nx + dx},${ny + dy}`;
    if (st.walls.has(bk) || crates.has(bk)) return null;
    const next = new Set(crates);
    next.delete(k);
    next.add(bk);
    return { player: [nx, ny], crates: next, pushed: true };
  }
  return { player: [nx, ny], crates, pushed: false };
}

export const isSolved = (st, crates) => [...crates].every((k) => st.goals.has(k));

export default class CratePush extends Game {
  start() {
    sky(this.scene, '#3a2c1e', '#100b07', 30, 90);
    lights(this.scene, { sky: 0xffe2b8, groundCol: 0x2a1c10 });
    this.add(ground(80, 0x1a120b));
    this.burst = new Burst(this.scene, 60, 0.2);
    this.level = 0;
    this.cleared = 0;
    this.timeLeft = TIME;
    this.moves = 0;
    this.holdT = 0;
    this.holdDir = null;
    this.group = null;
    this.loadLevel(0);
    this.camera.position.set(0, 14, 8);
    this.camera.lookAt(0, 0, 0.5);
    this.hud.hint('Arrows / WASD to move · push every crate onto a glowing goal (you can only push, never pull) · Z undoes a move · R restarts the level');
  }

  loadLevel(i) {
    if (this.group) this.scene.remove(this.group);
    this.state = parseLevel(LEVELS[i]);
    this.crates = new Set(this.state.crates);
    this.player = [...this.state.player];
    this.undo = [];
    this.moves = 0;
    this.group = this.add(new THREE.Group());
    this.crateMeshes = new Map();
    const offX = ((this.state.w - 1) * S) / 2;
    const offZ = ((this.state.h - 1) * S) / 2;
    this.pos = (x, y) => [x * S - offX, y * S - offZ];
    for (let y = 0; y < this.state.h; y++) {
      for (let x = 0; x < this.state.w; x++) {
        const k = `${x},${y}`;
        const [px, pz] = this.pos(x, y);
        if (this.state.walls.has(k)) {
          const w = box(S, 1.3, S, mat(0x6b5a48, { roughness: 0.8 }));
          w.position.set(px, 0.65, pz);
          this.group.add(w);
        } else if (this.reachable(x, y)) {
          const f = box(S, 0.1, S, mat(0x2a2016));
          f.position.set(px, 0.05, pz);
          this.group.add(f);
        }
        if (this.state.goals.has(k)) {
          const g = cyl(0.45, 0.45, 0.05, glow(PALETTE.lime, { emissiveIntensity: 0.9 }), { cast: false });
          g.position.set(px, 0.12, pz);
          this.group.add(g);
        }
        if (this.crates.has(k)) {
          const c = box(S * 0.8, S * 0.8, S * 0.8, mat(0xc98b3c, { roughness: 0.6 }));
          c.position.set(px, S * 0.4 + 0.1, pz);
          this.group.add(c);
          this.crateMeshes.set(k, c);
        }
      }
    }
    this.playerMesh = box(S * 0.6, S * 0.9, S * 0.6, glow(PALETTE.cyan, { emissiveIntensity: 0.35 }));
    const [px, pz] = this.pos(...this.player);
    this.playerMesh.position.set(px, S * 0.45 + 0.1, pz);
    this.group.add(this.playerMesh);
    this.paintCrates();
    const camY = clamp(5 + Math.max(this.state.w * 1.0, this.state.h * 1.7), 8, 16);
    this.camera.position.set(0, camY, camY * 0.55);
    this.camera.lookAt(0, 0, 0.3);
  }

  /** Empty floor inside the walls: a cell is floor if it is not a wall and is enclosed (flood from the player). */
  reachable(x, y) {
    if (!this._floor) this._floor = new Map();
    const key = this.level;
    if (!this._floor.has(key)) {
      const seen = new Set();
      const stack = [[...this.state.player]];
      while (stack.length) {
        const [a, b] = stack.pop();
        const k = `${a},${b}`;
        if (seen.has(k) || this.state.walls.has(k) || a < 0 || b < 0 || a >= this.state.w || b >= this.state.h) continue;
        seen.add(k);
        stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
      }
      this._floor.set(key, seen);
    }
    return this._floor.get(key).has(`${x},${y}`);
  }

  paintCrates() {
    for (const [k, m] of this.crateMeshes) m.material.color.setHex(this.state.goals.has(k) ? 0x7ee081 : 0xc98b3c);
  }

  /** One step in a direction; returns true when it moved. */
  move(dir) {
    const [dx, dy] = DIRS[dir];
    const res = stepState(this.state, this.player, this.crates, dx, dy);
    if (!res) { this.audio.bad?.(); return false; }
    this.undo.push({ player: this.player, crates: this.crates, meshes: new Map(this.crateMeshes) });
    if (res.pushed) {
      const from = `${res.player[0]},${res.player[1]}`;
      const m = this.crateMeshes.get(from);
      this.crateMeshes.delete(from);
      this.crateMeshes.set(`${res.player[0] + dx},${res.player[1] + dy}`, m);
    }
    this.player = res.player;
    this.crates = res.crates;
    this.moves++;
    this.syncMeshes();
    this.audio[res.pushed ? 'thud' : 'blip'](res.pushed ? undefined : 1);
    if (isSolved(this.state, this.crates)) this.levelDone();
    return true;
  }

  takeBack() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.player = prev.player;
    this.crates = prev.crates;
    this.crateMeshes = prev.meshes;
    this.moves = Math.max(0, this.moves - 1);
    this.syncMeshes();
  }

  syncMeshes() {
    for (const [k, m] of this.crateMeshes) {
      const [x, y] = k.split(',').map(Number);
      m.userData.target = this.pos(x, y);
    }
    const [px, pz] = this.pos(...this.player);
    this.playerMesh.userData.target = [px, pz];
    this.paintCrates();
  }

  levelDone() {
    this.cleared++;
    this.audio.good();
    this.burst.burst(this.playerMesh.position, PALETTE.lime, 24, 8);
    this.hud.toast(`LEVEL ${this.level + 1} CLEARED`, 900);
    this.pause = 0.9;
  }

  update(dt) {
    this.timeLeft -= dt;
    this.hud.stat('Level', `${Math.min(this.level + 1, LEVELS.length)}/${LEVELS.length}`);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)), this.timeLeft < 30);
    this.hud.stat('Moves', this.moves);
    this.burst.update(dt);

    for (const m of [...this.crateMeshes.values(), this.playerMesh]) {
      const t = m.userData.target;
      if (t) { m.position.x = damp(m.position.x, t[0], 22, dt); m.position.z = damp(m.position.z, t[1], 22, dt); }
    }

    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0) {
        this.pause = 0;
        if (this.level + 1 >= LEVELS.length) return this.finish(true);
        this.level++;
        this.loadLevel(this.level);
      }
      return;
    }
    if (this.timeLeft <= 0) return this.finish(false);

    let dir = null;
    if (this.input.hit('ArrowUp', 'KeyW')) dir = 'up';
    else if (this.input.hit('ArrowDown', 'KeyS')) dir = 'down';
    else if (this.input.hit('ArrowLeft', 'KeyA')) dir = 'left';
    else if (this.input.hit('ArrowRight', 'KeyD')) dir = 'right';
    else if (this.input.gpHit(12)) dir = 'up';
    else if (this.input.gpHit(13)) dir = 'down';
    else if (this.input.gpHit(14)) dir = 'left';
    else if (this.input.gpHit(15)) dir = 'right';
    if (dir) { this.move(dir); this.holdDir = dir; this.holdT = 0.28; }
    else if (this.holdDir) {
      const held = { up: this.input.key('ArrowUp', 'KeyW'), down: this.input.key('ArrowDown', 'KeyS'), left: this.input.key('ArrowLeft', 'KeyA'), right: this.input.key('ArrowRight', 'KeyD') }[this.holdDir];
      if (!held) this.holdDir = null;
      else if ((this.holdT -= dt) <= 0) { this.move(this.holdDir); this.holdT = 0.14; }
    }
    if (this.input.hit('KeyZ') || this.input.gpHit(1)) this.takeBack();
    if (this.input.hit('KeyR') || this.input.gpHit(3)) this.loadLevel(this.level);
  }

  finish(all) {
    this.audio[all ? 'win' : 'lose']();
    const score = this.cleared * 100 + (all ? Math.max(0, Math.floor(this.timeLeft)) : 0);
    this.end(score, all ? `Every level cleared with ${Math.floor(this.timeLeft)} s to spare!` : `${this.cleared} level${this.cleared === 1 ? '' : 's'} cleared before time ran out.`);
  }
}
