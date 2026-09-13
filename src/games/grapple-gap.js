import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, lights, sky, glow, Burst, clamp, rand, PALETTE,
} from '../engine/utils.js';

const GROUND_Y = 1;
const GRAV = 20;
const GRAPPLE_RANGE = 4.2;
const ZIP_SPEED = 15;
const BOOST_SPEED = 10;
const GAPS = 22;

export default class GrappleGap extends Game {
  start() {
    sky(this.scene, '#1a2a4a', '#05070d', 40, 140);
    lights(this.scene, { sky: 0xbcd0ff, groundCol: 0x14203a });

    this.platforms = [];
    this.anchors = [];
    let x = 0;
    this.makePlatform(x, 5);
    x += 5;
    for (let i = 0; i < GAPS; i++) {
      const gap = clamp(5 + i * 0.16, 5, 9);
      const midX = x + gap / 2;
      const a = this.add(ball(0.4, glow(PALETTE.amber, { emissiveIntensity: 0.6 })));
      a.position.set(midX, GROUND_Y + rand(2, 3.4), 0);
      this.anchors.push(a);
      x += gap;
      this.makePlatform(x, clamp(4.5 - i * 0.06, 2.2, 4.5));
      x += this.platforms[this.platforms.length - 1].userData.len;
    }
    this.finishX = x;

    this.player = this.add(ball(0.5, glow(PALETTE.cyan)));
    this.player.position.set(1.5, GROUND_Y, 0);
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.grapple = null;
    this.bestX = this.player.position.x;

    this.burst = new Burst(this.scene, 90, 0.2);
    this.camera.position.set(this.player.position.x, 5, 9);
    this.hud.hint('A / D to move · Space near a glowing anchor to grapple across the gap');
  }

  makePlatform(x0, len) {
    const p = box(len, 1, 3, PALETTE.violet);
    p.position.set(x0 + len / 2, GROUND_Y - 0.5, 0);
    p.userData = { x0, x1: x0 + len, len };
    this.platforms.push(this.add(p));
  }

  isOverPlatform(x) {
    return this.platforms.some((p) => x >= p.userData.x0 && x <= p.userData.x1);
  }

  nearestAnchor(pos) {
    let best = null;
    let bestD = GRAPPLE_RANGE;
    for (const a of this.anchors) {
      const d = a.position.distanceTo(pos);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  update(dt) {
    const steer = this.input.axisX();
    if (!this.grapple) {
      this.vel.x = this.grounded ? steer * 6 : this.vel.x + steer * 4 * dt;

      if ((this.input.hit('Space') || this.input.clicked) && !this.grounded) {
        const anchor = this.nearestAnchor(this.player.position);
        if (anchor) {
          this.grapple = { anchor, dir: null };
          this.audio.tone([300, 700], 0.12, { type: 'sawtooth', gain: 0.1 });
        }
      }

      if (!this.grounded) this.vel.y -= GRAV * dt;
      this.player.position.addScaledVector(this.vel, dt);
    } else {
      const to = this.grapple.anchor.position.clone().sub(this.player.position);
      const d = to.length();
      if (d < 0.35) {
        this.grapple.dir = this.grapple.dir || to.clone().normalize();
        this.vel.copy(this.grapple.dir).multiplyScalar(BOOST_SPEED);
        this.vel.y = Math.max(this.vel.y, 2);
        this.grapple = null;
      } else {
        to.normalize();
        this.grapple.dir = to;
        this.player.position.addScaledVector(to, ZIP_SPEED * dt);
      }
    }

    // Landing / falling off the edge.
    const overPlat = this.isOverPlatform(this.player.position.x);
    if (!this.grapple) {
      if (this.player.position.y <= GROUND_Y && overPlat && this.vel.y <= 0) {
        this.player.position.y = GROUND_Y;
        this.vel.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    }

    this.bestX = Math.max(this.bestX, this.player.position.x);
    if (this.player.position.y < -10) return this.fall();
    if (this.player.position.x >= this.finishX) return this.win();

    this.burst.update(dt);
    this.camera.position.x = this.player.position.x;
    this.camera.lookAt(this.player.position.x, this.player.position.y, 0);

    this.hud.stat('Distance', `${Math.floor(this.bestX)} m`);
    this.hud.stat('Status', this.grapple ? 'GRAPPLING' : this.grounded ? 'on ground' : 'airborne');
  }

  fall() {
    this.burst.burst(this.player.position, PALETTE.cyan, 20, 8);
    this.audio.lose();
    this.end(Math.floor(this.bestX), `You made it ${Math.floor(this.bestX)} metres across.`);
  }

  win() {
    this.audio.win();
    this.end(Math.floor(this.bestX), `You crossed every gap! ${Math.floor(this.bestX)} metres.`);
  }
}
