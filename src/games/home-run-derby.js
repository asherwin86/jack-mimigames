import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, clamp, lerp, rand, PALETTE,
} from '../engine/utils.js';

const PITCHES = 10;
const PITCH_Z = -18;
const REACH = 1.4;       // how close (in the plate plane) the bat must be to the ball
const BAT_DELAY = 0.07;  // seconds from click to bat meeting ball

export const PITCH_TYPES = {
  fastball: { dur: 0.72, curve: 0 },
  curve: { dur: 0.98, curve: 1.6 },
  changeup: { dur: 1.2, curve: -0.6 },
};

/**
 * Quality of contact 0..1 from how early/late the swing was (seconds; 0 is perfect) and how far the bat was from the ball (units).
 * Returns 0 for a miss.
 */
export function contact(timingErr, distance) {
  const t = Math.abs(timingErr);
  if (t > 0.16 || distance > REACH) return 0;
  return clamp(1 - (t / 0.16) * 0.6 - (distance / REACH) * 0.4, 0.01, 1);
}

/** The result of a swing with quality q: label, points, and how far the ball flies in metres. */
export function hitResult(q) {
  if (q <= 0) return { label: 'STRIKE', pts: 0, dist: 0 };
  if (q >= 0.8) return { label: 'HOME RUN', pts: 100, dist: 110 + q * 60 };
  if (q >= 0.6) return { label: 'DEEP HIT', pts: 50, dist: 70 + q * 40 };
  if (q >= 0.4) return { label: 'SINGLE', pts: 25, dist: 40 + q * 30 };
  return { label: 'FOUL', pts: 5, dist: 15 + q * 20 };
}

export default class HomeRunDerby extends Game {
  start() {
    sky(this.scene, '#4aa0ee', '#e0f2ff', 90, 320);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x4a7a3a, intensity: 1.1 });
    this.add(ground(600, 0x3f8f3a));
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(9, 28), new THREE.MeshStandardMaterial({ color: 0xa5794a }));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(0, 0.02, 0);
    this.add(dirt);
    const plate = box(1.2, 0.05, 1.2, mat(0xf6f6f6));
    plate.position.set(0, 0.06, 0);
    this.add(plate);
    const pitcher = box(0.9, 1.7, 0.6, mat(0x3a4fb0));
    pitcher.position.set(0, 0.9, PITCH_Z - 1);
    this.add(pitcher);
    // a fence far away
    const fence = box(160, 4, 0.5, mat(0x1f4a2a), { cast: false });
    fence.position.set(0, 2, -160);
    this.add(fence);

    this.ball = this.add(ball(0.24, mat(0xffffff, { roughness: 0.4 })));
    this.ball.visible = false;
    this.bat = new THREE.Group();
    const barrel = cyl(0.14, 0.09, 2.2, glow(PALETTE.amber, { emissiveIntensity: 0.4 }));
    this.bat.add(barrel);
    this.bat.position.set(-1, 1.2, 0.5);
    this.add(this.bat);
    this.zone = this.add(new THREE.Mesh(new THREE.RingGeometry(REACH - 0.1, REACH, 28), new THREE.MeshBasicMaterial({ color: PALETTE.lime, transparent: true, opacity: 0.75, depthTest: false })));
    this.zone.renderOrder = 10;
    this.burst = new Burst(this.scene, 60, 0.2);

    this.pitch = 0;
    this.score = 0;
    this.homers = 0;
    this.state = 'wait';     // wait | pitch | fly | done
    this.wait = 1.2;
    this.cursor = { x: 0, y: 1.2 };
    this.swingT = 0;
    this.longest = 0;
    this.showCursor = true;
    this.camera.position.set(-4, 2.4, 7);
    this.camera.lookAt(0, 1.6, -9);
    this.hud.hint('Move the mouse to put the ring where the ball will cross the plate · click to swing (there is a split-second delay!) · time it right for a home run · 10 pitches');
  }

  throwPitch() {
    const kinds = Object.keys(PITCH_TYPES);
    const type = kinds[Math.floor(Math.random() * Math.min(kinds.length, 1 + Math.floor(this.pitch / 2.5)))];
    const t = PITCH_TYPES[type];
    this.p = {
      type, t: 0, dur: t.dur * rand(0.95, 1.05),
      x: rand(-0.9, 0.9), y: rand(0.7, 2.1), curve: t.curve * (Math.random() < 0.5 ? -1 : 1),
      swung: false,
    };
    this.state = 'pitch';
    this.ball.visible = true;
    this.hud.toast(type.toUpperCase(), 500);
  }

  /** Swings with the bat ring at (cx, cy) now. Returns the hit result (and starts the ball flying if it connected). */
  swing(cx = this.cursor.x, cy = this.cursor.y) {
    if (this.state !== 'pitch' || this.p.swung) return null;
    this.p.swung = true;
    this.swingT = 0.2;
    const remaining = (1 - this.p.t) * this.p.dur;   // seconds until the ball reaches the plate
    const err = BAT_DELAY - remaining;               // positive = late
    const q = contact(err, Math.hypot(this.p.x - cx, this.p.y - cy));
    const res = hitResult(q);
    this.result = { ...res, err, q };
    if (q > 0) {
      this.state = 'fly';
      this.fly = { t: 0, dur: 1.4 + res.dist / 90, dist: res.dist, side: clamp(err / 0.16, -1, 1) * 40 };
      this.score += res.pts;
      if (res.label === 'HOME RUN') this.homers++;
      this.longest = Math.max(this.longest, Math.round(res.dist));
      this.audio[res.pts >= 50 ? 'win' : 'blip'](...(res.pts >= 50 ? [] : [5]));
      this.burst.burst(new THREE.Vector3(this.p.x, this.p.y, 0), PALETTE.amber, 14, 9);
      this.hud.toast(`${res.label}! +${res.pts}`, 1200);
    } else {
      this.audio.bad();
      this.hud.toast('STRIKE', 800);
      this.state = 'pitch';   // the ball carries on to the catcher
    }
    return res;
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    const p = this.planePoint(0);
    if (this.input.delta.x || this.input.delta.y) this.mouse = true;
    if (p) { this.cursor.x = clamp(p.x, -3, 3); this.cursor.y = clamp(p.y, 0.3, 3.2); }
    this.zone.position.set(this.cursor.x, this.cursor.y, 0.5);
    this.zone.visible = this.state === 'pitch' || this.state === 'wait';

    // bat animation
    this.swingT = Math.max(0, this.swingT - dt);
    this.bat.position.set(this.cursor.x - 1.2, this.cursor.y, 0.5);
    this.bat.rotation.z = this.swingT > 0 ? lerp(0.4, -1.4, 1 - this.swingT / 0.2) : 0.4;

    if (this.state === 'wait') {
      if ((this.wait -= dt) <= 0) this.throwPitch();
    } else if (this.state === 'pitch') {
      const q = this.p;
      q.t += dt / q.dur;
      const u = clamp(q.t, 0, 1.3);
      this.ball.position.set(lerp(0, q.x, u) + q.curve * Math.sin(Math.PI * Math.min(u, 1)) * (1 - Math.min(u, 1)) * 1.5, lerp(1.6, q.y, u) + (1 - u) * 0.6 * Math.sin(u * 2), lerp(PITCH_Z, 0, u));
      if (this.clickedNow()) this.swing();
      if (q.t >= 1.3) this.nextPitch();
    } else if (this.state === 'fly') {
      const f = this.fly;
      f.t += dt / f.dur;
      const u = clamp(f.t, 0, 1);
      this.ball.position.set(f.side * u, 1 + Math.sin(u * Math.PI) * Math.min(38, f.dist * 0.3), -f.dist * u);
      if (f.t >= 1.15) this.nextPitch();
    }
    this.hud.stat('Pitch', `${Math.min(this.pitch + 1, PITCHES)}/${PITCHES}`);
    this.hud.stat('Score', this.score);
    this.hud.stat('Home runs', this.homers);
    this.hud.stat('Longest', this.longest ? `${this.longest} m` : '—');
  }

  nextPitch() {
    this.pitch++;
    this.ball.visible = false;
    if (this.pitch >= PITCHES) return this.finish();
    this.state = 'wait';
    this.wait = 1.1;
  }

  finish() {
    this.state = 'done';
    this.audio[this.homers >= 3 ? 'win' : 'lose']();
    this.end(this.score, `${this.homers} home run${this.homers === 1 ? '' : 's'} — ${this.score} points, longest hit ${this.longest} m.`);
  }
}
