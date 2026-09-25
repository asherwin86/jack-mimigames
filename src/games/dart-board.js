import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, lights, sky, glow, mat, labelPlane, Burst, clamp, damp, rand, PALETTE,
} from '../engine/utils.js';

const BOARD_Z = -14;
const RINGS = [[4.8, 5, 0x1a1a24], [3.6, 10, 0xf2f6ff], [2.4, 15, 0x2fbf6a], [1.2, 25, 0xf2f6ff], [0.5, 50, 0xff4554]];   // [radius, points, colour]
const DARTS = 15;

export default class DartBoard extends Game {
  start() {
    sky(this.scene, '#3a2820', '#0d0806', 40, 90);
    lights(this.scene, { sky: 0xffe8d0, groundCol: 0x2a1c14 });

    const wall = box(30, 20, 0.5, mat(0x4a3428, { roughness: 0.9 }), { cast: false });
    wall.position.set(0, 0, BOARD_Z - 0.5);
    this.add(wall);
    // The board, from the outside in, so each ring sits on top of the bigger one.
    let z = BOARD_Z;
    for (const [r, , colour] of RINGS) {
      const disc = cyl(r, r, 0.2, mat(colour, { roughness: 0.6 }), { cast: false });
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, 0, z);
      z += 0.05;
      this.add(disc);
    }
    this.cross = this.add(new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 24), new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.95, depthTest: false })));
    this.cross.renderOrder = 10;

    this.darts = [];
    this.flying = null;
    this.burst = new Burst(this.scene, 50, 0.18);
    this.score = 0;
    this.thrown = 0;
    this.bulls = 0;
    this.last = 0;
    this.aim = new THREE.Vector2();
    this.showCursor = true;
    this.pointerXY = new THREE.Vector2();

    this.camera.position.set(0, 0, 8);
    this.camera.lookAt(0, 0, BOARD_Z);
    this.hud.hint('Move the mouse to aim (the sight wobbles — time it!) · click to throw · 15 darts · bullseye is 50');
  }

  /** Where the pointer's ray meets the board's plane. */
  boardPoint() {
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(this.input.activePointer(), this.camera);
    const { origin, direction } = this._ray.ray;
    const t = (BOARD_Z - origin.z) / direction.z;
    return { x: origin.x + direction.x * t, y: origin.y + direction.y * t };
  }

  /** Points for a dart landing at (x, y) on the board. */
  static pointsAt(x, y) {
    const d = Math.hypot(x, y);
    let pts = 0;
    for (const [r, p] of RINGS) if (d <= r) pts = p;
    return pts;
  }

  update(dt) {
    // The sight follows the pointer, plus a sway that swells and shrinks like a held breath.
    const p = this.boardPoint();
    const breath = 0.5 + 0.5 * Math.sin(this.time * 1.3);
    const amp = 0.2 + 0.95 * breath;
    this.aim.set(
      clamp(p.x, -6.5, 6.5) + Math.sin(this.time * 2.1) * amp,
      clamp(p.y, -6.5, 6.5) + Math.cos(this.time * 2.9) * amp * 0.85,
    );
    this.cross.position.set(this.aim.x, this.aim.y, BOARD_Z + 0.5);
    this.cross.scale.setScalar(1 + amp * 0.5);
    this.cross.material.color.setHex(breath < 0.3 ? PALETTE.lime : PALETTE.amber);

    if (this.clickedNow() && !this.flying && this.thrown < DARTS) this.throwDart();

    if (this.flying) {
      const f = this.flying;
      f.t += dt / 0.22;
      const k = Math.min(1, f.t);
      f.dart.position.lerpVectors(f.from, f.to, k);
      f.dart.position.y += Math.sin(k * Math.PI) * 0.6;
      if (k >= 1) this.land(f);
    }

    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Darts', DARTS - this.thrown);
    this.hud.stat('Last', this.last);
  }

  throwDart() {
    this.thrown++;
    const dart = box(0.12, 0.12, 1.1, glow(PALETTE.cyan, { emissiveIntensity: 0.6 }), { cast: false });
    const from = new THREE.Vector3(0.6, -1.4, 6);
    const to = new THREE.Vector3(this.aim.x, this.aim.y, BOARD_Z + 0.4);
    dart.position.copy(from);
    this.add(dart);
    this.darts.push(dart);
    this.flying = { dart, from, to, t: 0 };
    this.audio.tone([700, 300], 0.08, { type: 'triangle', gain: 0.08 });
  }

  land(f) {
    this.flying = null;
    const pts = DartBoard.pointsAt(f.to.x, f.to.y);
    this.score += pts;
    this.last = pts;
    if (pts === 50) this.bulls++;
    this.burst.burst(f.to, pts >= 25 ? PALETTE.amber : PALETTE.white, pts >= 25 ? 14 : 6, 5);
    (pts === 50 ? this.audio.win() : pts >= 15 ? this.audio.good() : pts ? this.audio.thud() : this.audio.bad());
    this.hud.toast(pts === 50 ? 'BULLSEYE! 50' : pts ? `+${pts}` : 'MISS', 600);
    if (this.thrown >= DARTS) this.finish();
  }

  finish() {
    this.end(this.score, `${this.bulls} bullseye${this.bulls === 1 ? '' : 's'} in ${DARTS} darts.`);
  }
}
