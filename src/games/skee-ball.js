import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, lights, sky, glow, mat, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const BALLS = 9;
const LIP_Z = -13;
const START_Z = 5;
const K = 0.034;              // how far a ball flies past the lip: distance = K * speed^2
// Holes on the target board, by how far past the lip they are and how far off the middle
const HOLES = [
  { d: 11.2, x: 0, r: 0.85, pts: 100, colour: 0xffd23f },
  { d: 9.4, x: -2.7, r: 0.8, pts: 40, colour: 0xff4554 },
  { d: 9.4, x: 2.7, r: 0.8, pts: 40, colour: 0xff4554 },
  { d: 8.2, x: 0, r: 0.9, pts: 30, colour: 0x3a8fe0 },
  { d: 6.6, x: -3.1, r: 0.85, pts: 20, colour: 0x2fbf6a },
  { d: 6.6, x: 3.1, r: 0.85, pts: 20, colour: 0x2fbf6a },
  { d: 5.3, x: 0, r: 0.95, pts: 10, colour: 0xf2f6ff },
];

export default class SkeeBall extends Game {
  start() {
    sky(this.scene, '#3a1c4a', '#0d0614', 40, 110);
    lights(this.scene, { sky: 0xffd8f0, groundCol: 0x2a1030 });

    const lane = box(6, 0.4, 20, mat(0x6a3a1c, { roughness: 0.4 }));
    lane.position.set(0, -0.2, -4);
    this.add(lane);
    // The ramp's lip and the raised board beyond it
    const lip = box(6, 0.8, 1.5, mat(0x8a5a2c));
    lip.position.set(0, 0.2, LIP_Z + 0.4);
    this.add(lip);
    const board = box(9, 0.4, 14, mat(0x241030, { roughness: 0.6 }));
    board.position.set(0, -0.1, LIP_Z - 8.2);
    board.rotation.x = -0.05;
    this.add(board);
    for (const h of HOLES) {
      const hole = cyl(h.r, h.r, 0.06, glow(h.colour, { emissiveIntensity: 0.55 }), { cast: false });
      hole.position.set(h.x, 0.14, LIP_Z - h.d);
      this.add(hole);
      const rim = cyl(h.r + 0.12, h.r + 0.12, 0.04, mat(0xf2f6ff), { cast: false });
      rim.position.set(h.x, 0.1, LIP_Z - h.d);
      this.add(rim);
    }
    const back = box(9, 5, 0.5, mat(0x3a1c4a));
    back.position.set(0, 2.5, LIP_Z - 15.5);
    this.add(back);

    this.ball = this.add(ball(0.5, glow(0xffb14a, { emissiveIntensity: 0.35 })));
    this.marker = this.add(new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 20), new THREE.MeshBasicMaterial({ color: PALETTE.amber, side: THREE.DoubleSide })));
    this.marker.rotation.x = -Math.PI / 2;
    this.burst = new Burst(this.scene, 70, 0.2);

    this.score = 0;
    this.shots = 0;
    this.state = 'aim';           // aim -> charge -> roll -> fly
    this.power = 0;
    this.aimX = 0;
    this.last = 0;
    this.showCursor = true;
    this.placeBall();

    this.camera.position.set(0, 5.5, 12);
    this.camera.lookAt(0, 0.5, -8);
    this.hud.hint('Move the mouse to aim left and right · hold click to charge the throw, release to roll · rolled hard it flies far: aim for the 100');
  }

  placeBall() {
    this.ball.position.set(0, 0.5, START_Z);
    this.ball.visible = true;
  }

  update(dt) {
    if (this.state === 'aim' || this.state === 'charge') {
      const g = this.groundPoint(0);
      if (g) this.aimX = clamp(g.x, -3.6, 3.6);
      const kb = this.input.axisX();
      if (kb) this.aimX = clamp(this.aimX + kb * 4 * dt, -3.6, 3.6);
      this.ball.position.x = damp(this.ball.position.x, this.aimX * 0.6, 12, dt);
      this.marker.position.set(this.aimX, 0.06, LIP_Z - 8);
      this.marker.visible = true;
      const held = this.input.down || this.input.gpButton(0) || this.input.key('Space');
      if (held) { this.state = 'charge'; this.power = Math.min(1, this.power + dt / 1.1); }
      else if (this.state === 'charge') this.launch();
      else this.power = 0;
    } else if (this.state === 'roll') {
      this.marker.visible = false;
      this.t += dt / this.rollTime;
      const k = Math.min(1, this.t);
      this.ball.position.z = START_Z + (LIP_Z - START_Z) * k;
      this.ball.position.x = this.x0 + (this.xLip - this.x0) * k;
      this.ball.rotation.x -= dt * 12;
      if (k >= 1) { this.state = 'fly'; this.t = 0; this.flyTime = 0.8; }
    } else if (this.state === 'fly') {
      this.t += dt / this.flyTime;
      const k = Math.min(1, this.t);
      this.ball.position.x = this.xLip + (this.land.x - this.xLip) * k;
      this.ball.position.z = LIP_Z + (this.land.z - LIP_Z) * k;
      this.ball.position.y = 0.5 + Math.sin(k * Math.PI) * (1.5 + this.dist * 0.18);
      if (k >= 1) this.landed();
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Balls', BALLS - this.shots);
    this.hud.stat('Power', this.state === 'charge' ? `${Math.round(this.power * 100)}%` : '—');
    this.hud.stat('Last', this.last);
  }

  /** Where a ball thrown with `power` (0-1) from aim `aimX` comes down: [x, distance past the lip]. */
  static landing(power, aimX, scatter = 0) {
    const speed = 6 + power * 16;
    return { speed, d: K * speed * speed, x: clamp(aimX + scatter, -4.3, 4.3) };
  }

  /** Points for a ball that came down `d` past the lip, `x` off the middle. */
  static pointsAt(d, x) {
    let pts = 0;
    for (const h of HOLES) if (Math.hypot(h.x - x, h.d - d) < h.r) pts = Math.max(pts, h.pts);
    return pts;
  }

  launch() {
    this.shots++;
    const scatter = rand(-1, 1) * (0.15 + Math.abs(this.power - 0.6) * 0.5);
    const l = SkeeBall.landing(this.power, this.aimX, scatter);
    this.dist = l.d;
    this.land = new THREE.Vector3(l.x, 0.14, LIP_Z - l.d);
    this.x0 = this.ball.position.x;
    this.xLip = this.aimX * 0.25 + this.x0 * 0.75;
    this.rollTime = clamp(1.6 - this.power * 0.9, 0.6, 1.6);
    this.t = 0;
    this.state = 'roll';
    this.audio.tone([250, 450], 0.15, { type: 'triangle', gain: 0.08 });
  }

  landed() {
    const pts = SkeeBall.pointsAt(this.dist, this.land.x);
    this.score += pts;
    this.last = pts;
    this.burst.burst(this.land, pts ? PALETTE.amber : PALETTE.white, pts ? 16 : 5, 6);
    this.hud.toast(pts === 100 ? 'JACKPOT! 100' : pts ? `+${pts}` : 'NO HOLE', 800);
    (pts >= 40 ? this.audio.win() : pts ? this.audio.good() : this.audio.bad());
    this.ball.visible = false;
    this.power = 0;
    if (this.shots >= BALLS) { this.end(this.score, `${this.score} points from ${BALLS} balls.`); return; }
    this.state = 'aim';
    this.placeBall();
  }
}
