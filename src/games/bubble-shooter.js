import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, clamp, damp, randInt, PALETTE,
} from '../engine/utils.js';

const D = 1.5;                       // bubble diameter
const COLS = 12;
const LEFT = -COLS * D / 2;
const TOP = 11;                      // y of the top row's centres
const ROW_H = D * 0.866;
const CANNON = { x: 0, y: -11 };
const LIMIT_Y = -8.2;                // a bubble down here ends the game
const SHOT_SPEED = 32;
const COLOURS = [PALETTE.red, PALETTE.cyan, PALETTE.lime, PALETTE.amber, PALETTE.violet];
const PUSH_EVERY = 7;                // shots between new rows

export default class BubbleShooter extends Game {
  start() {
    sky(this.scene, '#1a2a66', '#050818', 60, 160);
    lights(this.scene, { sky: 0xc8d8ff, groundCol: 0x101838 });

    const wallMat = mat(0x2a3a88, { roughness: 0.6 });
    for (const s of [-1, 1]) {
      const w = box(0.5, 25, 1.2, wallMat);
      w.position.set(s * (COLS * D / 2 + 0.25), 0.5, 0);
      this.add(w);
    }
    const ceil = box(COLS * D + 1, 0.5, 1.2, wallMat);
    ceil.position.set(0, TOP + 0.9, 0);
    this.add(ceil);
    const line = box(COLS * D, 0.05, 0.1, glow(PALETTE.red, { emissiveIntensity: 0.7 }), { cast: false });
    line.position.set(0, LIMIT_Y - 0.5, 0.2);
    this.add(line);
    this.cannon = this.add(box(0.7, 2.2, 0.7, glow(PALETTE.white, { emissiveIntensity: 0.4 })));
    this.cannon.position.set(CANNON.x, CANNON.y, 0);
    this.guide = [];
    for (let i = 0; i < 14; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
      this.guide.push(this.add(dot));
    }

    this._geo = new THREE.SphereGeometry(D * 0.47, 18, 12);
    this.rows = [];
    this.meshes = [];
    for (let r = 0; r < 6; r++) this.pushRow(false);
    this.shot = null;
    this.burst = new Burst(this.scene, 90, 0.22);
    this.score = 0;
    this.shots = 0;
    this.sincePush = 0;
    this.popped = 0;
    this.angle = Math.PI / 2;
    this.loaded = this.randomColour();
    this.next = this.randomColour();
    this.loadedMesh = this.add(this.makeBubble(this.loaded));
    this.nextMesh = this.add(this.makeBubble(this.next));
    this.nextMesh.scale.setScalar(0.6);
    this.showCursor = true;

    this.camera.position.set(0, 0, 30);
    this.camera.lookAt(0, 0, 0);
    this.hud.hint('Aim with the mouse · click to fire · match three or more of a colour to pop them (and everything hanging off them) · new rows keep coming');
  }

  randomColour() {
    const present = new Set();
    for (const row of this.rows) for (const c of row.cells) if (c !== null) present.add(c);
    const pool = present.size ? [...present] : [0, 1, 2, 3, 4];
    return pool[randInt(0, pool.length - 1)];
  }

  makeBubble(colour) {
    return new THREE.Mesh(this._geo, glow(COLOURS[colour], { emissiveIntensity: 0.5 }));
  }

  cellPos(r, c) {
    const odd = this.rows[r] ? this.rows[r].odd : (r % 2 === 1);
    return { x: LEFT + D / 2 + c * D + (odd ? D / 2 : 0), y: TOP - r * ROW_H };
  }

  colsOf(row) { return row.odd ? COLS - 1 : COLS; }

  /** Adds a fresh row of random bubbles at the top and shifts the rest down. */
  pushRow(animate = true) {
    const odd = this.rows.length ? !this.rows[0].odd : false;
    const row = { odd, cells: Array.from({ length: odd ? COLS - 1 : COLS }, () => randInt(0, COLOURS.length - 1)) };
    this.rows.unshift(row);
    this.meshes.unshift(row.cells.map(() => null));
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.rows[r].cells.length; c++) {
        const m = this.meshes[r][c];
        if (m && animate) m.userData.dropFrom = true;
      }
    }
    this.syncMeshes(!animate);
  }

  neighbours(r, c) {
    const here = this.cellPos(r, c);
    const out = [];
    for (let rr = r - 1; rr <= r + 1; rr++) {
      if (rr < 0 || rr >= this.rows.length) continue;
      for (let cc = 0; cc < this.rows[rr].cells.length; cc++) {
        if (rr === r && cc === c) continue;
        const p = this.cellPos(rr, cc);
        if (Math.hypot(p.x - here.x, p.y - here.y) < D * 1.1) out.push([rr, cc]);
      }
    }
    return out;
  }

  syncMeshes(snap = false) {
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.rows[r].cells.length; c++) {
        const col = this.rows[r].cells[c];
        let m = this.meshes[r][c];
        if (col === null) { if (m) { this.scene.remove(m); this.meshes[r][c] = null; } continue; }
        const p = this.cellPos(r, c);
        if (!m) { m = this.add(this.makeBubble(col)); m.position.set(p.x, p.y, 0); this.meshes[r][c] = m; }
        m.material.color.setHex(COLOURS[col]); m.material.emissive.setHex(COLOURS[col]);
        m.userData.target = p;
        if (snap) m.position.set(p.x, p.y, 0);
      }
    }
  }

  /** Puts a bubble in a cell (growing the grid downwards if needed) and resolves matches. Returns points scored. */
  place(r, c, colour) {
    while (this.rows.length <= r) {
      const odd = this.rows.length ? !this.rows[this.rows.length - 1].odd : false;
      this.rows.push({ odd, cells: Array(odd ? COLS - 1 : COLS).fill(null) });
      this.meshes.push(Array(odd ? COLS - 1 : COLS).fill(null));
    }
    this.rows[r].cells[c] = colour;
    this.syncMeshes();
    return this.resolve(r, c);
  }

  resolve(r, c) {
    const colour = this.rows[r].cells[c];
    // same-colour cluster
    const seen = new Set([`${r},${c}`]);
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      for (const [nr, nc] of this.neighbours(cr, cc)) {
        if (seen.has(`${nr},${nc}`) || this.rows[nr].cells[nc] !== colour) continue;
        seen.add(`${nr},${nc}`);
        stack.push([nr, nc]);
      }
    }
    let pts = 0;
    if (seen.size >= 3) {
      for (const key of seen) { const [rr, cc] = key.split(',').map(Number); this.pop(rr, cc, PALETTE.white); }
      pts += seen.size * 10 + (seen.size > 3 ? (seen.size - 3) * 10 : 0);
      this.popped += seen.size;
      // anything no longer joined to the ceiling falls
      const held = new Set();
      const st = [];
      this.rows[0]?.cells.forEach((v, cc) => { if (v !== null) { held.add(`0,${cc}`); st.push([0, cc]); } });
      while (st.length) {
        const [cr, cc] = st.pop();
        for (const [nr, nc] of this.neighbours(cr, cc)) {
          if (held.has(`${nr},${nc}`) || this.rows[nr].cells[nc] === null) continue;
          held.add(`${nr},${nc}`);
          st.push([nr, nc]);
        }
      }
      let dropped = 0;
      for (let rr = 0; rr < this.rows.length; rr++) {
        for (let cc = 0; cc < this.rows[rr].cells.length; cc++) {
          if (this.rows[rr].cells[cc] !== null && !held.has(`${rr},${cc}`)) { this.pop(rr, cc, PALETTE.amber); dropped++; }
        }
      }
      if (dropped) { pts += dropped * 20; this.popped += dropped; this.hud.toast(`${dropped} DROPPED · +${dropped * 20}`, 900); }
      this.audio.good();
    }
    this.score += pts;
    return pts;
  }

  pop(r, c, colour) {
    const m = this.meshes[r][c];
    if (m) { this.burst.burst(m.position, colour, 6, 6); this.scene.remove(m); }
    this.meshes[r][c] = null;
    this.rows[r].cells[c] = null;
    this.audio.blip((r + c) % 12);
  }

  count() { return this.rows.reduce((n, row) => n + row.cells.filter((v) => v !== null).length, 0); }

  lowestY() {
    let low = Infinity;
    for (let r = 0; r < this.rows.length; r++) if (this.rows[r].cells.some((v) => v !== null)) low = Math.min(low, this.cellPos(r, 0).y);
    return low;
  }

  update(dt) {
    // Aim
    if (!this.shot) {
      const g = this.pointOnPlane();
      if (g) this.angle = clamp(Math.atan2(g.y - CANNON.y, g.x - CANNON.x), 0.2, Math.PI - 0.2);
      const kb = this.input.axisX();
      if (kb) this.angle = clamp(this.angle - kb * 1.6 * dt, 0.2, Math.PI - 0.2);
      if (this.clickedNow() || this.input.hit('Space')) this.fire();
    }
    this.cannon.rotation.z = this.angle - Math.PI / 2;
    this.loadedMesh.position.set(CANNON.x, CANNON.y + 1.4, 0);
    this.nextMesh.position.set(CANNON.x - 3, CANNON.y + 0.2, 0);
    this.drawGuide();

    if (this.shot) this.stepShot(dt);
    else if (this.lowestY() <= LIMIT_Y) return this.lose();   // (a new row can push the pile past the line by itself)

    for (let r = 0; r < this.meshes.length; r++) {
      for (const m of this.meshes[r]) {
        if (!m || !m.userData.target) continue;
        m.position.x = damp(m.position.x, m.userData.target.x, 10, dt);
        m.position.y = damp(m.position.y, m.userData.target.y, 10, dt);
      }
    }
    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Bubbles', this.count());
    this.hud.stat('Next row', Math.max(0, PUSH_EVERY - this.sincePush));
  }

  /** Pointer position on the z = 0 plane where the bubbles are. */
  pointOnPlane() {
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(this.input.activePointer(), this.camera);
    const { origin, direction } = this._ray.ray;
    if (Math.abs(direction.z) < 1e-6) return null;
    const t = -origin.z / direction.z;
    return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  }

  drawGuide() {
    let x = CANNON.x; let y = CANNON.y + 1;
    let dx = Math.cos(this.angle); const dy = Math.sin(this.angle);
    const wall = COLS * D / 2 - D / 2;
    this.guide.forEach((dot, i) => {
      x += dx * 1.4; y += dy * 1.4;
      if (Math.abs(x) > wall) { x = Math.sign(x) * wall * 2 - x; dx = -dx; }
      dot.position.set(x, y, 0);
      dot.visible = !this.shot && y < TOP;
    });
  }

  fire() {
    this.shots++;
    this.sincePush++;
    const m = this.loadedMesh;
    this.shot = { x: CANNON.x + Math.cos(this.angle) * 1.4, y: CANNON.y + 1 + Math.sin(this.angle) * 1.4, vx: Math.cos(this.angle) * SHOT_SPEED, vy: Math.sin(this.angle) * SHOT_SPEED, colour: this.loaded, mesh: m };
    this.audio.tone([400, 800], 0.08, { type: 'triangle', gain: 0.1 });
    // load the next one
    this.loaded = this.next;
    this.next = this.randomColour();
    this.loadedMesh = this.add(this.makeBubble(this.loaded));
    this.nextMesh.material.color.setHex(COLOURS[this.next]);
    this.nextMesh.material.emissive.setHex(COLOURS[this.next]);
  }

  stepShot(dt) {
    const s = this.shot;
    const wall = COLS * D / 2 - D / 2;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      s.x += s.vx * dt / steps;
      s.y += s.vy * dt / steps;
      if (Math.abs(s.x) > wall) { s.x = Math.sign(s.x) * wall; s.vx = -s.vx; }
      let hit = s.y >= TOP + D * 0.45;
      if (!hit) {
        outer: for (let r = 0; r < this.rows.length; r++) {
          for (let c = 0; c < this.rows[r].cells.length; c++) {
            if (this.rows[r].cells[c] === null) continue;
            const p = this.cellPos(r, c);
            if (Math.hypot(p.x - s.x, p.y - s.y) < D * 0.9) { hit = true; break outer; }
          }
        }
      }
      s.mesh.position.set(s.x, s.y, 0);
      if (hit) return this.land();
    }
    if (s.y < -14) { this.scene.remove(s.mesh); this.shot = null; }
  }

  /** The flying bubble stops: it takes the nearest empty cell. */
  land() {
    const s = this.shot;
    this.shot = null;
    this.scene.remove(s.mesh);
    let best = null; let bd = Infinity;
    const r0 = Math.round((TOP - s.y) / ROW_H);
    for (let r = Math.max(0, r0 - 1); r <= r0 + 1; r++) {
      const odd = this.rows[r] ? this.rows[r].odd : (this.rows.length && (r - this.rows.length) % 2 === 0 ? !this.rows[this.rows.length - 1].odd : this.rows.length ? this.rows[this.rows.length - 1].odd : r % 2 === 1);
      const cols = odd ? COLS - 1 : COLS;
      for (let c = 0; c < cols; c++) {
        if (this.rows[r] && this.rows[r].cells[c] !== null) continue;
        const px = LEFT + D / 2 + c * D + (odd ? D / 2 : 0);
        const py = TOP - r * ROW_H;
        const d = Math.hypot(px - s.x, py - s.y);
        if (d < bd) { bd = d; best = [r, c]; }
      }
    }
    if (!best) return;
    const pts = this.place(best[0], best[1], s.colour);
    if (pts) this.hud.toast(`+${pts}`, 500);
    if (this.count() === 0) {
      this.score += 500;
      this.hud.toast('CLEARED! +500', 1200);
      this.audio.win();
      for (let i = 0; i < 4; i++) this.pushRow(false);
    } else if (this.sincePush >= PUSH_EVERY && !pts) {
      this.sincePush = 0;
      this.pushRow(true);
      this.audio.tone(120, 0.2, { type: 'sawtooth', gain: 0.1 });
    }
    if (this.sincePush >= PUSH_EVERY) this.sincePush = 0;
    if (this.lowestY() <= LIMIT_Y) this.lose();
  }

  lose() {
    this.audio.lose();
    this.end(this.score, `${this.popped} bubbles popped.`);
  }
}
