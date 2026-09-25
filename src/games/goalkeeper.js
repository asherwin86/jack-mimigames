import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ball, ground, lights, sky, glow, mat, Burst, clamp, lerp, rand, PALETTE,
} from '../engine/utils.js';

const START_Z = -20;
const GOAL_HALF = 6;
const GOAL_H = 4;
const LIVES = 5;
const GLOVE_R = 1.45;

/** Time a shot takes and how far it bends, by how many shots have been faced. */
export function shotParams(n, rng = Math.random) {
  return {
    dur: clamp(1.15 - n * 0.018, 0.55, 1.15) * (0.9 + rng() * 0.2),
    curve: (rng() - 0.5) * Math.min(4, 0.5 + n * 0.15),
    arc: rng() * 1.2,
  };
}

/** The ball's (x, y) as it crosses the goal line (u = 1) or anywhere along its flight (0..1). */
export function ballAt(from, to, params, u) {
  return {
    x: lerp(from.x, to.x, u) + params.curve * Math.sin(Math.PI * u) * (1 - u),
    y: lerp(from.y, to.y, u) + params.arc * 4 * u * (1 - u),
    z: lerp(START_Z, 0, u),
  };
}

export default class Goalkeeper extends Game {
  start() {
    sky(this.scene, '#2b6fd0', '#cfe6ff', 60, 200);
    lights(this.scene, { sky: 0xffffff, groundCol: 0x3f7a3a, intensity: 1.1 });
    this.add(ground(200, 0x2f7a30));
    const postMat = mat(0xf2f2f2);
    for (const s of [-1, 1]) {
      const p = cyl(0.14, 0.14, GOAL_H, postMat);
      p.position.set(s * GOAL_HALF, GOAL_H / 2, 0);
      this.add(p);
    }
    const bar = cyl(0.14, 0.14, GOAL_HALF * 2, postMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, GOAL_H, 0);
    this.add(bar);
    this.striker = box(1, 1.8, 0.6, glow(PALETTE.pink, { emissiveIntensity: 0.3 }));
    this.striker.position.set(0, 0.9, START_Z - 1);
    this.add(this.striker);

    this.ball = this.add(ball(0.42, mat(0xf6f6f6, { roughness: 0.4 })));
    this.ball.visible = false;
    this.gloves = new THREE.Group();
    for (const s of [-1, 1]) {
      const g = ball(0.55, glow(PALETTE.amber, { emissiveIntensity: 0.5 }), { cast: false });
      g.position.x = s * 0.7;
      this.gloves.add(g);
    }
    this.gloves.position.set(0, 1.8, 0.2);
    this.add(this.gloves);
    this.glove = { x: 0, y: 1.8 };
    this.burst = new Burst(this.scene, 60, 0.2);

    this.faced = 0;
    this.saves = 0;
    this.conceded = 0;
    this.score = 0;
    this.streak = 0;
    this.shot = null;
    this.wait = 1.2;
    this.showCursor = true;
    this.camera.position.set(0, 3.2, 10);
    this.camera.lookAt(0, 1.8, -8);
    this.hud.hint('Move your gloves with the mouse (or WASD / stick) to meet each shot before it crosses the line · streaks score more · 5 goals conceded ends the match');
  }

  launch() {
    const wide = Math.random() < 0.08;   // occasionally a shot that misses the goal completely
    const to = { x: wide ? (Math.random() < 0.5 ? -1 : 1) * rand(GOAL_HALF + 0.8, GOAL_HALF + 2.5) : rand(-GOAL_HALF + 0.7, GOAL_HALF - 0.7), y: rand(0.4, GOAL_H - 0.4) };
    const from = { x: rand(-4, 4), y: 0.4 };
    this.shot = { from, to, params: shotParams(this.faced), u: 0, wide };
    this.faced++;
    this.striker.position.x = from.x;
    this.ball.visible = true;
    this.audio.thud();
  }

  /** What happens at the goal line: 'save' | 'goal' | 'wide'. */
  static outcome(ball, glove) {
    if (Math.abs(ball.x) > GOAL_HALF || ball.y > GOAL_H || ball.y < 0) return 'wide';
    return Math.hypot(ball.x - glove.x, ball.y - glove.y) <= GLOVE_R ? 'save' : 'goal';
  }

  resolve() {
    const s = this.shot;
    const pos = ballAt(s.from, s.to, s.params, 1);
    const out = Goalkeeper.outcome(pos, this.glove);
    this.shot = null;
    this.wait = 1;
    if (out === 'save') {
      this.saves++;
      this.streak++;
      const pts = 10 + Math.min(10, this.streak - 1) * 2;
      this.score += pts;
      this.hud.toast(`SAVE! +${pts}`, 800);
      this.audio.good();
      this.burst.burst(this.ball.position, PALETTE.amber, 12, 7);
    } else if (out === 'goal') {
      this.conceded++;
      this.streak = 0;
      this.hud.toast('GOAL CONCEDED', 900);
      this.audio.bad();
    } else {
      this.hud.toast('WIDE', 600);
    }
    this.ball.visible = false;
    if (this.conceded >= LIVES) this.finish();
  }

  update(dt) {
    if (this.finished) return;
    this.burst.update(dt);
    // Gloves follow the pointer at a limited speed, or move with the keys / stick.
    const p = this.planePoint(0);
    const kx = this.input.axisX();
    const ky = this.input.axisY();
    if (kx || ky) this.mouseMode = false;
    else if (this.input.delta.x || this.input.delta.y) this.mouseMode = true;
    let tx = this.glove.x;
    let ty = this.glove.y;
    if (kx || ky) { tx += kx * 14 * dt; ty += ky * 14 * dt; }
    else if (this.mouseMode !== false && p) { tx = p.x; ty = p.y; }
    const maxStep = 26 * dt;
    const dx = tx - this.glove.x;
    const dy = ty - this.glove.y;
    const d = Math.hypot(dx, dy);
    const k = d > maxStep ? maxStep / d : 1;
    this.glove.x = clamp(this.glove.x + dx * k, -GOAL_HALF - 1, GOAL_HALF + 1);
    this.glove.y = clamp(this.glove.y + dy * k, 0.5, GOAL_H + 1);
    this.gloves.position.set(this.glove.x, this.glove.y, 0.2);

    if (this.shot) {
      const s = this.shot;
      s.u += dt / s.params.dur;
      const pos = ballAt(s.from, s.to, s.params, clamp(s.u, 0, 1));
      this.ball.position.set(pos.x, pos.y, pos.z);
      this.ball.rotation.x += dt * 14;
      if (s.u >= 1) this.resolve();
    } else if ((this.wait -= dt) <= 0) {
      this.launch();
    }
    this.hud.stat('Saves', this.saves);
    this.hud.stat('Score', this.score);
    this.hud.stat('Conceded', `${this.conceded}/${LIVES}`, this.conceded >= LIVES - 1);
    this.hud.stat('Streak', this.streak);
  }

  finish() {
    this.audio.lose();
    this.end(this.score, `${this.saves} saves for ${this.score} points before the fifth goal.`);
  }
}
