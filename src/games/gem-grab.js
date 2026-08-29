import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, cyl, lights, sky, glow, mat, Burst, clamp, damp, rand,
  randInt, chase, PALETTE, COLORS,
} from '../engine/utils.js';

const ARENA = 22;         // half-extent of the playfield
const SPEED = 12;
const DASH = 30;

export default class GemGrab extends Game {
  start() {
    sky(this.scene, '#123c3a', '#050a0c', 30, 110);
    lights(this.scene, { sky: 0x9fffe4, groundCol: 0x0f2320 });

    const floor = this.add(ground(ARENA * 2, 0x11221f));
    floor.position.y = 0;

    // Perimeter wall so you can't run forever.
    for (const [x, z, w, d] of [
      [0, -ARENA, ARENA * 2, 1], [0, ARENA, ARENA * 2, 1],
      [-ARENA, 0, 1, ARENA * 2], [ARENA, 0, 1, ARENA * 2],
    ]) {
      const wall = box(w, 1.6, d, glow(0x1f4d46, { emissiveIntensity: 0.3 }), { cast: false });
      wall.position.set(x, 0.8, z);
      this.add(wall);
    }

    // Scattered pillars for cover — drones path straight, so these matter.
    this.pillars = [];
    for (let i = 0; i < 10; i++) {
      const p = cyl(1.1, 1.3, 3.4, mat(0x1b3b36));
      p.position.set(rand(-ARENA + 4, ARENA - 4), 1.7, rand(-ARENA + 4, ARENA - 4));
      if (Math.hypot(p.position.x, p.position.z) < 6) { i--; continue; }
      this.pillars.push(this.add(p));
    }

    this.player = this.add(ball(0.75, glow(PALETTE.cyan)));
    this.player.position.set(0, 0.75, 0);
    this.vel = new THREE.Vector3();

    this.gems = [];
    this.drones = [];
    this.burst = new Burst(this.scene, 110, 0.22);

    for (let i = 0; i < 6; i++) this.spawnGem();
    this.spawnDrone();

    this.collected = 0;
    this.dashCharge = 1;
    this.dashTime = 0;
    this.invuln = 1.5;
    this.lives = 3;
    this.nextDrone = 12;

    this.camera.position.set(0, 20, 18);
    this.hud.hint('WASD to run · Space to dash through danger · drones keep coming');
  }

  spawnGem() {
    const g = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.6),
      glow(COLORS[randInt(0, COLORS.length - 1)]),
    );
    g.position.set(rand(-ARENA + 3, ARENA - 3), 1, rand(-ARENA + 3, ARENA - 3));
    g.userData.spin = rand(1, 3);
    this.gems.push(this.add(g));
  }

  spawnDrone() {
    const d = box(1.2, 1.2, 1.2, glow(PALETTE.red, { emissiveIntensity: 0.6 }));
    // Always enter from an edge, never on top of the player.
    const edge = randInt(0, 3);
    const t = rand(-ARENA + 2, ARENA - 2);
    d.position.set(
      edge === 0 ? -ARENA + 2 : edge === 1 ? ARENA - 2 : t, 0.9,
      edge === 2 ? -ARENA + 2 : edge === 3 ? ARENA - 2 : t,
    );
    d.userData = { speed: 5.2 + this.drones.length * 0.5, phase: rand(0, Math.PI * 2) };
    this.drones.push(this.add(d));
    this.audio.tone([120, 300], 0.3, { type: 'sawtooth', gain: 0.1 });
    this.hud.toast('DRONE INBOUND', 800);
  }

  update(dt) {
    this.invuln -= dt;
    this.dashTime -= dt;

    // Movement
    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq() > 0) dir.normalize();

    if (this.input.hit('Space') && this.dashCharge >= 1 && dir.lengthSq() > 0) {
      this.dashCharge = 0;
      this.dashTime = 0.18;
      this.invuln = Math.max(this.invuln, 0.35);
      this.vel.copy(dir).multiplyScalar(DASH);
      this.audio.tone([700, 200], 0.16, { type: 'square', gain: 0.12 });
      this.burst.burst(this.player.position, PALETTE.cyan, 10, 5);
    } else {
      this.dashCharge = Math.min(1, this.dashCharge + dt / 2.2);
    }

    if (this.dashTime <= 0) {
      this.vel.x = damp(this.vel.x, dir.x * SPEED, 12, dt);
      this.vel.z = damp(this.vel.z, dir.z * SPEED, 12, dt);
    }

    const p = this.player.position;
    p.addScaledVector(this.vel, dt);
    p.x = clamp(p.x, -ARENA + 1.4, ARENA - 1.4);
    p.z = clamp(p.z, -ARENA + 1.4, ARENA - 1.4);
    p.y = 0.75 + Math.abs(Math.sin(this.time * 6)) * 0.12;

    for (const pil of this.pillars) this.pushOut(p, pil.position, 1.3 + 0.75);

    // Gems
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i];
      g.rotation.y += g.userData.spin * dt;
      g.position.y = 1 + Math.sin(this.time * 2 + i) * 0.2;
      if (p.distanceTo(g.position) < 1.5) {
        this.collected++;
        this.burst.burst(g.position, g.material.color.getHex(), 12, 6);
        this.audio.pickup();
        this.scene.remove(g);
        g.geometry.dispose();
        g.material.dispose();
        this.gems.splice(i, 1);
        this.spawnGem();
        if (this.collected % 8 === 0) { this.hud.toast(`${this.collected} gems`, 700); this.audio.good(); }
      }
    }

    // Drones home in; pillars block them the same way they block you.
    this.nextDrone -= dt;
    if (this.nextDrone <= 0 && this.drones.length < 7) {
      this.spawnDrone();
      this.nextDrone = clamp(16 - this.collected * 0.25, 6, 16);
    }

    for (const d of this.drones) {
      const to = p.clone().sub(d.position).setY(0);
      const dist = to.length();
      if (dist > 0.001) d.position.addScaledVector(to.divideScalar(dist), d.userData.speed * dt);
      d.position.y = 0.9 + Math.sin(this.time * 4 + d.userData.phase) * 0.1;
      d.rotation.y += dt * 3;
      for (const pil of this.pillars) this.pushOut(d.position, pil.position, 1.3 + 0.6);

      if (this.invuln <= 0 && dist < 1.5) { this.hurt(d); break; }
    }

    this.burst.update(dt);
    this.player.material.emissiveIntensity = this.invuln > 0 ? 0.4 + Math.sin(this.time * 25) * 0.4 : 0.75;

    chase(this.camera, this.player, new THREE.Vector3(0, 19, 16), dt, 3, p);

    this.hud.stat('Gems', this.collected);
    this.hud.stat('Lives', '●'.repeat(this.lives) || '—', this.lives === 1);
    this.hud.stat('Dash', this.dashCharge >= 1 ? 'READY' : `${Math.round(this.dashCharge * 100)}%`, this.dashCharge < 1);
  }

  /** Shove `pos` out of a circle centred on `centre`. */
  pushOut(pos, centre, r) {
    const dx = pos.x - centre.x;
    const dz = pos.z - centre.z;
    const d = Math.hypot(dx, dz);
    if (d < r && d > 0.0001) {
      pos.x = centre.x + (dx / d) * r;
      pos.z = centre.z + (dz / d) * r;
    }
  }

  hurt(drone) {
    this.lives--;
    this.invuln = 2;
    this.burst.burst(this.player.position, PALETTE.red, 20, 8);
    this.audio.boom();

    // Knock the offending drone back to an edge so you get breathing room.
    drone.position.multiplyScalar(-1).setY(0.9);

    if (this.lives <= 0) {
      this.audio.lose();
      this.end(this.collected, `${this.collected} gems banked before the drones got you.`);
    } else {
      this.audio.bad();
      this.hud.toast(`${this.lives} lives left`, 900);
    }
  }
}
