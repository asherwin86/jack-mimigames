import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HALF_W = 9;
const GRAV = 30;
const BOUNCE = 17;
const SPRING = 27;
const PLAT_W = 3.2;

export default class SkyClimb extends Game {
  start() {
    sky(this.scene, '#3a8be0', '#cfeaff', 80, 260);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x6a9a5a, intensity: 1.1 });
    this.player = new THREE.Group();
    const body = box(1.1, 1.3, 0.9, glow(PALETTE.pink, { emissiveIntensity: 0.35 }));
    const eye1 = ball(0.13, mat(0x101018), { cast: false });
    const eye2 = ball(0.13, mat(0x101018), { cast: false });
    eye1.position.set(-0.22, 0.25, 0.46);
    eye2.position.set(0.22, 0.25, 0.46);
    this.player.add(body, eye1, eye2);
    this.player.position.set(0, 1.5, 0);
    this.add(this.player);

    this.vy = BOUNCE;
    this.plats = [];
    this.topY = 0;
    this.best = 0;
    this.burst = new Burst(this.scene, 60, 0.2);
    this.makePlat(0, 0, 'still');
    while (this.topY < 30) this.nextPlat();
    this.camY = 5;
    this.camera.position.set(0, this.camY, 26);
    this.camera.lookAt(0, this.camY, 0);
    this.hud.hint('A / D or arrows to steer (or move the mouse) · you bounce by yourself · land on the platforms · brown ones crumble, springs launch you, blue ones slide');
  }

  makePlat(x, y, kind) {
    const col = kind === 'break' ? 0x9a6a3a : kind === 'move' ? PALETTE.blue : PALETTE.lime;
    const m = box(PLAT_W, 0.5, 1.6, mat(col, { roughness: 0.6 }));
    m.position.set(x, y, 0);
    this.add(m);
    const p = { mesh: m, kind, x0: x, phase: rand(0, 6), broken: false, fall: 0, spring: null };
    if (kind === 'still' && y > 12 && Math.random() < 0.14) {
      const s = box(0.8, 0.5, 0.8, glow(PALETTE.amber, { emissiveIntensity: 0.8 }));
      s.position.set(rand(-1, 1), 0.5, 0);
      m.add(s);
      p.spring = s;
    }
    this.plats.push(p);
    this.topY = Math.max(this.topY, y);
  }

  nextPlat() {
    const h = this.topY;
    const gap = clamp(2.6 + h / 150, 2.6, 3.9) * rand(0.85, 1.05);
    const y = h + gap;
    const roll = Math.random();
    const kind = y > 20 && roll < 0.2 ? 'break' : y > 40 && roll < 0.42 ? 'move' : 'still';
    this.makePlat(rand(-HALF_W + 2, HALF_W - 2), y, kind);
  }

  update(dt) {
    if (this.finished) return;
    const p = this.player.position;
    // Steering: keys/stick, or the mouse's horizontal position.
    let steer = this.input.axisX();
    if (steer) this.mouseSteer = false;
    else if (this.input.delta.x || this.input.delta.y) this.mouseSteer = true;
    if (!steer && this.mouseSteer) steer = clamp((this.input.pointer.x * HALF_W - p.x) / 2.5, -1, 1);
    p.x += steer * 12 * dt;
    if (p.x > HALF_W + 0.6) p.x = -HALF_W - 0.6;
    if (p.x < -HALF_W - 0.6) p.x = HALF_W + 0.6;
    this.player.rotation.z = damp(this.player.rotation.z, -steer * 0.25, 12, dt);

    const prevY = p.y;
    this.vy -= GRAV * dt;
    p.y += this.vy * dt;

    for (const pl of this.plats) {
      const m = pl.mesh;
      if (pl.kind === 'move') { pl.phase += dt; m.position.x = pl.x0 + Math.sin(pl.phase * 1.1) * 4; }
      if (pl.broken) { pl.fall += dt; m.position.y -= (pl.fall * 14) * dt; m.rotation.z += dt * 2; continue; }
      if (this.vy < 0 && prevY - 0.65 >= m.position.y + 0.25 - 0.05 && p.y - 0.65 <= m.position.y + 0.25
        && Math.abs(p.x - m.position.x) < PLAT_W / 2 + 0.3) {
        if (pl.kind === 'break') { pl.broken = true; this.audio.bad(); this.burst.burst(m.position, 0x9a6a3a, 6, 5); continue; }
        const onSpring = pl.spring && Math.abs(p.x - (m.position.x + pl.spring.position.x)) < 0.9;
        this.vy = onSpring ? SPRING : BOUNCE;
        this.audio.blip(onSpring ? 9 : 3);
        if (onSpring) this.burst.burst(p, PALETTE.amber, 8, 6);
      }
    }

    this.best = Math.max(this.best, p.y);
    while (this.topY < this.best + 32) this.nextPlat();
    for (let i = this.plats.length - 1; i >= 0; i--) {
      if (this.plats[i].mesh.position.y < this.best - 22) { this.scene.remove(this.plats[i].mesh); this.plats.splice(i, 1); }
    }

    this.camY = Math.max(this.camY, this.best + 2);
    this.camera.position.y = damp(this.camera.position.y, this.camY, 8, dt);
    this.camera.lookAt(0, this.camera.position.y, 0);
    this.burst.update(dt);
    this.hud.stat('Height', `${Math.floor(this.best * 3)} m`);

    if (p.y < this.camY - 14) return this.fall();
  }

  fall() {
    this.audio.lose();
    const h = Math.floor(this.best * 3);
    this.end(h, `You climbed ${h} m before falling.`);
  }
}
