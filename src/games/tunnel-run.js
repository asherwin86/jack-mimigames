import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const W = 11;         // tunnel half-width
const H = 7;          // tunnel half-height
const SPAWN_Z = -170;

export default class TunnelRun extends Game {
  start() {
    sky(this.scene, '#3d1b52', '#07040c', 40, 170);
    lights(this.scene, { sky: 0xdba8ff, groundCol: 0x1e0f2b });

    // Tunnel shell.
    const shell = mat(0x1d1230, { roughness: 0.9 });
    for (const [x, y, w, h] of [[0, -H, W * 2, 0.4], [0, H, W * 2, 0.4], [-W, 0, 0.4, H * 2], [W, 0, 0.4, H * 2]]) {
      const s = box(w, h, 380, shell, { cast: false });
      s.position.set(x, y, -170);
      this.add(s);
    }

    // Light strips streaming past for speed reference.
    this.strips = [];
    for (let i = 0; i < 34; i++) {
      const s = box(W * 2, H * 2, 0.14, glow(PALETTE.violet, {
        emissiveIntensity: 0.5, wireframe: true, transparent: true, opacity: 0.22,
      }), { cast: false, receive: false });
      s.position.z = -i * 10;
      this.strips.push(this.add(s));
    }

    this.ship = this.add(box(1.4, 0.9, 2.2, glow(PALETTE.lime)));
    this.ship.position.set(0, 0, 0);

    this.walls = [];
    this.burst = new Burst(this.scene, 80, 0.24);
    this.speed = 34;
    this.passed = 0;
    this.nextWall = 1.2;

    this.camera.position.set(0, 0.6, 9);
    this.hud.hint('WASD or arrows to fly · thread the gap in each wall');
  }

  /** A wall is four slabs framing a rectangular hole. */
  spawnWall() {
    const gapW = clamp(5.2 - this.passed * 0.045, 3.2, 5.2);
    const gapH = clamp(4.0 - this.passed * 0.035, 2.6, 4.0);
    const cx = rand(-W + gapW / 2 + 0.5, W - gapW / 2 - 0.5);
    const cy = rand(-H + gapH / 2 + 0.5, H - gapH / 2 - 0.5);
    const colour = COLORS[this.passed % COLORS.length];

    const parts = [];
    const left = cx - gapW / 2 + W;      // width of the slab on the -X side
    const right = W - (cx + gapW / 2);
    const below = cy - gapH / 2 + H;
    const above = H - (cy + gapH / 2);
    if (left > 0.05) parts.push([-W + left / 2, 0, left, H * 2]);
    if (right > 0.05) parts.push([W - right / 2, 0, right, H * 2]);
    if (below > 0.05) parts.push([cx, -H + below / 2, gapW, below]);
    if (above > 0.05) parts.push([cx, H - above / 2, gapW, above]);

    const group = [];
    for (const [x, y, w, h] of parts) {
      const slab = box(w, h, 1.1, glow(colour, { emissiveIntensity: 0.35 }), { cast: false });
      slab.position.set(x, y, SPAWN_Z);
      group.push(this.add(slab));
    }
    this.walls.push({ parts: group, gap: { cx, cy, gapW, gapH }, z: SPAWN_Z, scored: false });
  }

  update(dt) {
    this.speed = 34 + Math.min(40, this.passed * 1.1);
    const dz = this.speed * dt;

    const p = this.ship.position;
    p.x = clamp(p.x + this.input.axisX() * 22 * dt, -W + 1, W - 1);
    p.y = clamp(p.y + this.input.axisY() * 18 * dt, -H + 1, H - 1);
    this.ship.rotation.z = damp(this.ship.rotation.z, -this.input.axisX() * 0.5, 9, dt);
    this.ship.rotation.x = damp(this.ship.rotation.x, -this.input.axisY() * 0.25, 9, dt);

    for (const s of this.strips) {
      s.position.z += dz;
      if (s.position.z > 12) s.position.z -= 340;
    }

    this.nextWall -= dt;
    if (this.nextWall <= 0) {
      this.spawnWall();
      this.nextWall = clamp(70 / this.speed, 0.55, 1.6);
    }

    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.z += dz;
      for (const part of w.parts) part.position.z = w.z;

      if (!w.scored && w.z > p.z - 0.8) {
        w.scored = true;
        const g = w.gap;
        const inside = Math.abs(p.x - g.cx) < g.gapW / 2 - 0.5
          && Math.abs(p.y - g.cy) < g.gapH / 2 - 0.35;
        if (!inside) return this.crash();
        this.passed++;
        this.audio.blip(clamp(this.passed, 0, 20));
        if (this.passed % 10 === 0) { this.hud.toast(`${this.passed} walls`); this.audio.good(); }
      }

      if (w.z > 14) {
        for (const part of w.parts) {
          this.scene.remove(part);
          part.geometry.dispose();
          part.material.dispose();
        }
        this.walls.splice(i, 1);
      }
    }

    this.burst.update(dt);
    this.camera.position.x = damp(this.camera.position.x, p.x * 0.5, 6, dt);
    this.camera.position.y = damp(this.camera.position.y, p.y * 0.5 + 0.6, 6, dt);
    this.camera.lookAt(p.x * 0.3, p.y * 0.3, -30);

    this.hud.stat('Walls', this.passed);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
  }

  crash() {
    this.burst.burst(this.ship.position, PALETTE.lime, 24, 9);
    this.ship.visible = false;
    this.audio.boom();
    this.audio.lose();
    this.end(this.passed, `You cleared ${this.passed} wall${this.passed === 1 ? '' : 's'}.`);
  }
}
