import { Game } from '../engine/Game.js';
import {
  box, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const HALF = 4;          // the corridor is 2*HALF tall
const SPAWN_X = 48;

export default class GravityFlip extends Game {
  start() {
    sky(this.scene, '#2a1450', '#07030f', 40, 130);
    lights(this.scene, { sky: 0xd0b8ff, groundCol: 0x1a0d30 });

    // Floor and ceiling rails, plus streaming dashes for a sense of speed.
    for (const y of [-HALF - 0.3, HALF + 0.3]) {
      const rail = box(400, 0.4, 6, mat(0x241a45), { cast: false });
      rail.position.set(0, y, 0);
      this.add(rail);
      const edge = box(400, 0.1, 0.2, glow(PALETTE.violet, { emissiveIntensity: 0.9 }), { cast: false });
      edge.position.set(0, y + (y < 0 ? 0.25 : -0.25), 2.9);
      this.add(edge);
    }
    this.dashes = [];
    for (let i = 0; i < 24; i++) {
      const d = box(2.4, 0.08, 0.08, glow(0x6a55b0, { emissiveIntensity: 0.5 }), { cast: false });
      d.position.set(-20 + i * 4, rand(-HALF, HALF), -2.5);
      this.dashes.push(this.add(d));
    }

    this.player = this.add(box(1.2, 1.2, 1.2, glow(PALETTE.lime)));
    this.player.position.set(-8, -HALF + 0.6, 0);
    this.side = -1;            // -1 = on the floor, +1 = on the ceiling
    this.speed = 14;
    this.distance = 0;
    this.obstacles = [];
    this.nextSpawn = 0.6;
    this.burst = new Burst(this.scene, 70, 0.2);

    this.camera.position.set(-2, 0, 15);
    this.camera.lookAt(-2, 0, 0);
    this.hud.hint('Space, click or tap flips gravity · slip between the blocks on the floor and the ceiling');
  }

  spawn() {
    const onCeiling = Math.random() < 0.5;
    const h = rand(1.8, 4.2);
    const b = box(1.6, h, 2.4, glow(onCeiling ? PALETTE.pink : PALETTE.cyan, { emissiveIntensity: 0.5 }));
    b.position.set(SPAWN_X, onCeiling ? HALF - h / 2 : -HALF + h / 2, 0);
    this.obstacles.push(this.add(b));
    // Sometimes a second block right behind it on the other side, so a single flip isn't enough.
    if (Math.random() < 0.3) {
      const h2 = rand(1.8, 3.4);
      const b2 = box(1.6, h2, 2.4, glow(onCeiling ? PALETTE.cyan : PALETTE.pink, { emissiveIntensity: 0.5 }));
      b2.position.set(SPAWN_X + rand(5, 8), onCeiling ? -HALF + h2 / 2 : HALF - h2 / 2, 0);
      this.obstacles.push(this.add(b2));
    }
  }

  update(dt) {
    this.speed = 14 + Math.min(16, this.distance / 80);
    this.distance += this.speed * dt;

    if (this.input.hit('Space', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS') || this.input.clicked || this.input.gpHit(0)) {
      this.side *= -1;
      this.audio.tone(this.side > 0 ? [300, 700] : [700, 300], 0.08, { type: 'triangle', gain: 0.1 });
    }
    // The cube snaps across to whichever side is "down".
    const targetY = this.side > 0 ? HALF - 0.6 : -HALF + 0.6;
    this.player.position.y = damp(this.player.position.y, targetY, 22, dt);
    this.player.rotation.z += dt * 4 * this.side * -1;

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawn();
      this.nextSpawn = clamp(11 / this.speed, 0.42, 1.1) * rand(0.9, 1.5);
    }

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.position.x -= this.speed * dt;
      if (o.position.x < -18) { this.scene.remove(o); this.obstacles.splice(i, 1); continue; }
      const h = o.geometry.parameters.height;
      if (Math.abs(o.position.x - this.player.position.x) < 1.35
        && Math.abs(o.position.y - this.player.position.y) < h / 2 + 0.5) return this.crash(o);
    }
    for (const d of this.dashes) {
      d.position.x -= this.speed * 1.4 * dt;
      if (d.position.x < -26) { d.position.x += 100; d.position.y = rand(-HALF, HALF); }
    }

    this.burst.update(dt);
    this.hud.stat('Distance', `${Math.floor(this.distance)} m`);
    this.hud.stat('Speed', `${Math.round(this.speed * 3.6)} kph`);
  }

  crash(o) {
    this.burst.burst(this.player.position, PALETTE.lime, 22, 9);
    this.burst.burst(o.position, o.material.color.getHex(), 12, 6);
    this.player.visible = false;
    this.audio.boom();
    this.audio.lose();
    this.end(Math.floor(this.distance), `You covered ${Math.floor(this.distance)} metres.`);
  }
}
