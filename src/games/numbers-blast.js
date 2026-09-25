import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, lights, sky, glow, mat, labelPlane, setLabel, Burst, clamp, damp, rand, PALETTE, COLORS,
} from '../engine/utils.js';

const HALF_W = 10;
const FLOOR_Y = 1.5;
const TOP_Y = 26;
const MAX_CANNONS = 4;

/** The number a new block shows: grows with time so the blocks need more hits. */
export const blockValue = (t, rng = Math.random) => {
  const base = 2 + Math.floor(t / 9);
  return Math.max(1, Math.round(base * (0.6 + rng() * 1.1)));
};

export default class NumbersBlast extends Game {
  start() {
    sky(this.scene, '#132a3a', '#060d14', 60, 200);
    lights(this.scene, { sky: 0xd6ecff, groundCol: 0x0c1a24 });
    for (const x of [-HALF_W - 0.6, HALF_W + 0.6]) {
      const wall = box(0.5, TOP_Y + 4, 2, glow(PALETTE.blue, { emissiveIntensity: 0.5 }), { cast: false });
      wall.position.set(x, TOP_Y / 2, 0);
      this.add(wall);
    }
    const floor = box(HALF_W * 2 + 2, 0.6, 3, mat(0x24384a));
    floor.position.set(0, 0.3, 0);
    this.add(floor);

    this.cannon = new THREE.Group();
    const base = cyl(0.9, 1.1, 0.8, mat(0x6a7488));
    this.barrels = [];
    this.cannon.add(base);
    this.cannon.position.set(0, 1.0, 0);
    this.add(this.cannon);

    this.blocks = [];
    this.shots = [];
    this.pickups = [];
    this.burst = new Burst(this.scene, 90, 0.25);
    this.px = 0;
    this.guns = 1;
    this.fireCd = 0;
    this.spawnT = 0.6;
    this.score = 0;
    this.broken = 0;
    this.camera.position.set(0, 12, 26);
    this.camera.lookAt(0, 10.5, 0);
    this.buildBarrels();
    this.hud.hint('Slide the cannon with the mouse or A / D · it fires by itself · each hit takes 1 off a block\'s number · pop them before they reach the floor · green + adds a barrel');
  }

  buildBarrels() {
    for (const b of this.barrels) this.cannon.remove(b);
    this.barrels = [];
    for (let i = 0; i < this.guns; i++) {
      const b = box(0.35, 1.4, 0.35, glow(PALETTE.cyan, { emissiveIntensity: 0.5 }));
      b.position.set((i - (this.guns - 1) / 2) * 0.55, 1, 0);
      this.cannon.add(b);
      this.barrels.push(b);
    }
  }

  spawnBlock() {
    const v = blockValue(this.time);
    const size = clamp(1.6 + Math.log2(v) * 0.4, 1.7, 3.4);
    const col = COLORS[Math.floor(Math.random() * COLORS.length)];
    const m = box(size, size, size, mat(col, { roughness: 0.45 }));
    const lp = labelPlane(String(v), size * 0.9, size * 0.9, { size: 128, fg: '#0b0e17', scale: 0.55 });
    lp.position.set(0, 0, size / 2 + 0.02);
    m.add(lp);
    m.position.set(rand(-HALF_W + size / 2, HALF_W - size / 2), TOP_Y + size, 0);
    this.add(m);
    this.blocks.push({ mesh: m, value: v, start: v, size, label: lp, speed: rand(1.3, 2.2) + Math.min(2.4, this.time / 50) });
  }

  spawnPickup() {
    const m = box(1, 1, 1, glow(PALETTE.lime, { emissiveIntensity: 0.9 }));
    const lp = labelPlane('+', 0.9, 0.9, { size: 96, fg: '#06140a' });
    lp.position.z = 0.52;
    m.add(lp);
    m.position.set(rand(-HALF_W + 1, HALF_W - 1), TOP_Y + 1, 0);
    this.add(m);
    this.pickups.push(m);
  }

  update(dt) {
    if (this.finished) return;
    // Cannon: A / D, or follow the mouse.
    const key = this.input.axisX();
    if (key) { this.px += key * 16 * dt; this.mouseAim = false; }
    else if (this.input.delta.x || this.input.delta.y) this.mouseAim = true;
    if (!key && this.mouseAim) this.px = damp(this.px, clamp(this.input.pointer.x * 14, -HALF_W, HALF_W), 18, dt);
    this.px = clamp(this.px, -HALF_W + 0.8, HALF_W - 0.8);
    this.cannon.position.x = this.px;

    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = 0.16;
      this.barrels.forEach((b) => {
        const s = ball(0.2, glow(PALETTE.amber, { emissiveIntensity: 1 }), { cast: false });
        s.position.set(this.px + b.position.x, 2.2, 0);
        this.add(s);
        this.shots.push(s);
      });
    }

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      if (Math.random() < 0.06 && this.guns < MAX_CANNONS) this.spawnPickup(); else this.spawnBlock();
      this.spawnT = clamp(1.6 - this.time / 100, 0.55, 1.6) * rand(0.8, 1.2);
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.position.y += 34 * dt;
      let gone = s.position.y > TOP_Y + 4;
      if (!gone) {
        for (const b of this.blocks) {
          if (b.value <= 0) continue;
          const h = b.size / 2;
          if (Math.abs(s.position.x - b.mesh.position.x) < h + 0.15 && Math.abs(s.position.y - b.mesh.position.y) < h + 0.2) {
            b.value--;
            gone = true;
            this.burst.burst(s.position, 0xffffff, 1, 4);
            this.score += 1;
            if (b.value <= 0) this.pop(b); else setLabel(b.label, String(b.value), { size: 128, fg: '#0b0e17', scale: 0.55 });
            break;
          }
        }
      }
      if (gone) { this.scene.remove(s); this.shots.splice(i, 1); }
    }
    this.blocks = this.blocks.filter((b) => b.value > 0);

    for (const b of this.blocks) {
      b.mesh.position.y -= b.speed * dt;
      b.mesh.rotation.z = Math.sin(this.time * 2 + b.size) * 0.03;
      if (b.mesh.position.y - b.size / 2 <= FLOOR_Y) return this.lose(b);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.position.y -= 3 * dt;
      p.rotation.y += dt * 2;
      if (Math.abs(p.position.x - this.px) < 1.6 && p.position.y < 3.5) {
        this.guns = Math.min(MAX_CANNONS, this.guns + 1);
        this.buildBarrels();
        this.audio.good?.();
        this.hud.toast('EXTRA BARREL', 800);
        this.scene.remove(p);
        this.pickups.splice(i, 1);
      } else if (p.position.y < 0) { this.scene.remove(p); this.pickups.splice(i, 1); }
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Blocks popped', this.broken);
    this.hud.stat('Barrels', this.guns);
  }

  pop(b) {
    this.broken++;
    this.score += b.start * 2;
    this.burst.burst(b.mesh.position, b.mesh.material.color.getHex(), 14, 8);
    this.audio.thud();
    this.scene.remove(b.mesh);
  }

  lose() {
    this.audio.boom();
    this.audio.lose();
    this.end(this.score, `A block hit the floor — ${this.broken} blocks popped for ${this.score} points.`);
  }
}
