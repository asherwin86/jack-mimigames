import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, ground, lights, sky, glow, mat, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const LIVES = 5;
const BEAM_R = 1.6;
const SPAWN_Z = -55;

export default class GhostHunt extends Game {
  start() {
    sky(this.scene, '#1a2444', '#070a14', 25, 95);
    lights(this.scene, { sky: 0x9fb2e8, groundCol: 0x1a2a20, intensity: 0.9 });
    this.add(ground(160, 0x24352a));
    // A few dead trees and gravestones for atmosphere.
    for (let i = 0; i < 26; i++) {
      const stone = box(rand(0.8, 1.4), rand(1.2, 2.4), 0.4, mat(0x6a7486));
      stone.position.set(rand(-30, 30), 0.9, rand(-50, -6));
      stone.rotation.y = rand(-0.3, 0.3);
      this.add(stone);
    }
    this.ghosts = [];
    this.burst = new Burst(this.scene, 80, 0.2);
    this.beamGlow = new THREE.PointLight(0xfff2b0, 2.4, 14, 1.5);
    this.add(this.beamGlow);
    this.ring = this.add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 32), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.6, depthTest: false })));
    this.ring.renderOrder = 10;
    this.ray = new THREE.Raycaster();
    this.lives = LIVES;
    this.score = 0;
    this.kills = 0;
    this.spawnT = 1;
    this.charge = 1;   // flashlight battery
    this.showCursor = true;
    this.camera.position.set(0, 2.2, 6);
    this.camera.lookAt(0, 2, -20);
    this.hud.hint('Move the mouse to aim your torch · hold click (or A) to shine it on the ghosts — they fade and pop · the battery drains while lit · 5 ghosts reaching you ends it');
  }

  spawn() {
    const kind = Math.random() < 0.18 + Math.min(0.25, this.time / 240) ? 'big' : 'small';
    const size = kind === 'big' ? 2.1 : 1.3;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(size * 0.5, 14, 10), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.55 }));
    body.scale.y = 1.3;
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, size * 0.8, 10), body.material);
    skirt.position.y = -size * 0.55;
    skirt.rotation.x = Math.PI;
    const eyes = [-1, 1].map((s) => { const e = ball(size * 0.08, mat(0x101018), { cast: false }); e.position.set(s * size * 0.16, size * 0.1, size * 0.42); return e; });
    g.add(body, skirt, ...eyes);
    g.position.set(rand(-13, 13), rand(1.4, 4.6), SPAWN_Z);
    g.userData = {
      hp: kind === 'big' ? 2.2 : 1, max: kind === 'big' ? 2.2 : 1, speed: (kind === 'big' ? 3 : 4.6) + Math.min(4, this.time / 30),
      wobble: rand(0, 6), r: size * 0.7, kind, mat: body.material, baseY: g.position.y,
    };
    this.add(g);
    this.ghosts.push(g);
  }

  update(dt) {
    if (this.finished) return;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawn();
      this.spawnT = clamp(1.6 - this.time / 70, 0.45, 1.6) * rand(0.7, 1.2);
    }

    // The torch: a ray through the pointer, lit while the button is held and the battery lasts.
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.input.activePointer(), this.camera);
    const lit = (this.input.down || this.input.gpButton(0) || this.input.key('Space')) && this.charge > 0;
    this.charge = clamp(this.charge + (lit ? -0.16 : 0.22) * dt, 0, 1);
    if (this.charge <= 0.001) this.charge = 0;
    const aimPoint = this.ray.ray.origin.clone().addScaledVector(this.ray.ray.direction, 22);
    this.beamGlow.position.copy(aimPoint);
    this.beamGlow.intensity = lit ? 3 : 0.5;
    this.ring.position.copy(this.ray.ray.origin).addScaledVector(this.ray.ray.direction, 20);
    this.ring.scale.setScalar(lit ? 3.2 : 1.6);
    this.ring.material.opacity = lit ? 0.7 : 0.25;

    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      const u = g.userData;
      u.wobble += dt;
      g.position.z += u.speed * dt;
      g.position.x += Math.sin(u.wobble * 1.5) * 0.9 * dt;
      g.position.y = u.baseY + Math.sin(u.wobble * 2) * 0.35;
      const dist = this.ray.ray.distanceToPoint(g.position);
      if (lit && dist < BEAM_R + u.r * 0.4) {
        u.hp -= dt * 1.5;
        g.scale.setScalar(0.85 + 0.15 * Math.max(0, u.hp / u.max));
        if (u.hp <= 0) {
          this.score += u.kind === 'big' ? 40 : 15;
          this.kills++;
          this.burst.burst(g.position, 0xcfe8ff, 12, 7);
          this.audio.good?.();
          this.scene.remove(g);
          this.ghosts.splice(i, 1);
          continue;
        }
      }
      u.mat.opacity = 0.35 + 0.35 * Math.max(0, u.hp / u.max);
      if (g.position.z > 4) {
        this.lives--;
        this.burst.burst(g.position, PALETTE.red, 12, 8);
        this.audio.bad();
        this.hud.toast('A GHOST GOT THROUGH', 700);
        this.scene.remove(g);
        this.ghosts.splice(i, 1);
        if (this.lives <= 0) return this.finish();
      }
    }
    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Lives', '♥'.repeat(Math.max(0, this.lives)), this.lives <= 1);
    this.hud.stat('Torch', `${Math.round(this.charge * 100)}%`, this.charge < 0.2);
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `You banished ${this.kills} ghost${this.kills === 1 ? '' : 's'} for ${this.score} points.`);
  }
}
