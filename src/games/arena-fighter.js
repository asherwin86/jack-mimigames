import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, ball, cyl, lights, sky, glow, mat, Burst, rand, PALETTE,
} from '../engine/utils.js';

const ARENA_R = 8;
const MOVE_SPEED = 7;
const MIN_SEP = 1.3;   // fighters can close to punching range, but not through each other
const RECOVER = 0.15;   // seconds of "cool down" after a swing lands, before another can start
const PUNCH = { name: 'punch', windup: 0.1, reach: 0.9, arm: 0.55, dmg: 6, knock: 3, cd: 0.35 };
const KICK = { name: 'kick', windup: 0.22, reach: 1.15, arm: 0.85, dmg: 12, knock: 6, cd: 0.7 };

/** A small blocky fighter: torso, head, a lunging arm, simple legs. */
function fighter(color) {
  const g = new THREE.Group();
  g.add(box(0.9, 1.0, 0.55, mat(color)));
  const head = ball(0.32, mat(color));
  head.position.y = 0.78;
  g.add(head);
  const legs = box(0.8, 0.55, 0.5, mat(color, { roughness: 0.7 }));
  legs.position.y = -0.78;
  g.add(legs);
  const arm = box(0.26, 0.26, 0.5, glow(color, { emissiveIntensity: 0.3 }));
  arm.position.set(0, 0.1, 0.5);
  g.add(arm);
  g.userData.arm = arm;
  g.userData.armBase = 0.5;
  g.position.y = 1.3;
  return g;
}

export default class ArenaFighter extends Game {
  start() {
    sky(this.scene, '#3a1030', '#0a0508', 26, 90);
    lights(this.scene, { sky: 0xffc0d0, groundCol: 0x2a1018 });

    this.disc = this.add(cyl(1, 1, 1, mat(0x241018, { roughness: 0.9 }), { cast: false }));
    this.disc.scale.set(ARENA_R + 1, 0.4, ARENA_R + 1);
    this.disc.position.y = -0.5;
    this.rim = this.add(cyl(1, 1, 1, glow(PALETTE.pink, { emissiveIntensity: 0.55 }), { cast: false }));
    this.rim.scale.set(ARENA_R + 1.3, 0.15, ARENA_R + 1.3);
    this.rim.position.y = -0.72;

    // Spread along X, not Z: side-on to the fixed camera below so the two
    // fighters read as separated on screen instead of lining up behind
    // each other as they close the distance.
    this.player = this.add(fighter(PALETTE.cyan));
    this.player.position.set(4, 1.3, 0);
    this.cpu = this.add(fighter(PALETTE.red));
    this.cpu.position.set(-4, 1.3, 0);

    this.playerHP = 100;
    this.cpuHP = 100;
    this.dealt = 0;
    this.punchCd = 0;
    this.kickCd = 0;
    this.cpuCd = rand(0.4, 1.2);
    this.cpuAttack = null;
    this.playerAttack = null;
    this.playerBlocking = false;
    this.cpuBlocking = false;
    this.timeLeft = 60;
    this.burst = new Burst(this.scene, 90, 0.2);

    this.camera.position.set(0, 6, 9);
    this.camera.lookAt(0, 1, 0);
    this.hud.hint('WASD to move · click or J to punch · K to kick · hold Shift to block');
  }

  update(dt) {
    this.timeLeft -= dt;
    this.punchCd = Math.max(0, this.punchCd - dt);
    this.kickCd = Math.max(0, this.kickCd - dt);

    // Player movement, clamped to the disc.
    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq()) dir.normalize();
    this.player.position.addScaledVector(dir, MOVE_SPEED * dt);
    this.clampToArena(this.player.position);

    this.playerBlocking = this.input.key('ShiftLeft', 'ShiftRight');
    if (!this.playerBlocking && !this.playerAttack) {
      if ((this.input.hit('KeyJ') || this.input.clicked) && this.punchCd <= 0) {
        this.playerAttack = { kind: PUNCH, t: 0, dealt: false };
        this.punchCd = PUNCH.cd;
      } else if (this.input.hit('KeyK') && this.kickCd <= 0) {
        this.playerAttack = { kind: KICK, t: 0, dealt: false };
        this.kickCd = KICK.cd;
      }
    }

    this.face(this.player, this.cpu.position);
    this.face(this.cpu, this.player.position);

    // CPU: close the distance, throw attacks on its own cooldown, sometimes block.
    const toPlayer = this.player.position.clone().sub(this.cpu.position).setY(0);
    const dist = toPlayer.length();
    if (!this.cpuAttack) {
      if (dist > KICK.reach + 0.6) {
        this.cpu.position.addScaledVector(toPlayer.normalize(), MOVE_SPEED * 0.8 * dt);
        this.cpuBlocking = false;
      } else {
        this.cpuBlocking = Math.sin(this.time * 2.3 + 1) > 0.85;
        this.cpuCd -= dt;
        if (this.cpuCd <= 0 && !this.cpuBlocking) {
          this.cpuAttack = { kind: Math.random() < 0.6 ? PUNCH : KICK, t: 0, dealt: false };
          this.cpuCd = rand(0.6, 1.6);
        }
      }
    }

    this.playerAttack = this.stepAttack(this.player, this.cpu, this.playerAttack, dt, true);
    this.cpuAttack = this.stepAttack(this.cpu, this.player, this.cpuAttack, dt, false);
    this.separate();

    this.burst.update(dt);
    this.hud.stat('You', Math.max(0, Math.round(this.playerHP)), this.playerHP < 30);
    this.hud.stat('Rival', Math.max(0, Math.round(this.cpuHP)), this.cpuHP < 30);
    this.hud.stat('Time', Math.ceil(Math.max(0, this.timeLeft)));

    if (this.playerHP <= 0) return this.finish(false);
    if (this.cpuHP <= 0) return this.finish(true);
    if (this.timeLeft <= 0) return this.finish(this.playerHP >= this.cpuHP);
  }

  face(f, target) {
    const dx = target.x - f.position.x;
    const dz = target.z - f.position.z;
    if (Math.hypot(dx, dz) > 0.01) f.rotation.y = Math.atan2(dx, dz);
  }

  /** Confines a fighter to the disc — scaling x/z only, never y, or a fighter
   *  pushed out here would visually sink as its whole vector got shrunk. */
  clampToArena(pos) {
    const r = Math.hypot(pos.x, pos.z);
    if (r <= ARENA_R) return;
    const s = ARENA_R / r;
    pos.x *= s;
    pos.z *= s;
  }

  /** Keeps the two fighters from standing inside one another. */
  separate() {
    const dx = this.cpu.position.x - this.player.position.x;
    const dz = this.cpu.position.z - this.player.position.z;
    const d = Math.hypot(dx, dz);
    if (d >= MIN_SEP || d < 0.0001) return;
    const push = (MIN_SEP - d) / 2;
    const nx = dx / d;
    const nz = dz / d;
    this.player.position.x -= nx * push;
    this.player.position.z -= nz * push;
    this.cpu.position.x += nx * push;
    this.cpu.position.z += nz * push;
  }

  /**
   * Advances one fighter's in-progress swing: the arm lunges out over the
   * windup, the hit resolves the instant the windup completes, then the arm
   * eases back over a short recovery before another swing can start. Returns
   * the (possibly now null) attack state.
   */
  stepAttack(attacker, defender, attack, dt, isPlayer) {
    const arm = attacker.userData.arm;
    const base = attacker.userData.armBase;
    if (!attack) {
      arm.position.z = base;
      return null;
    }

    const before = attack.t;
    attack.t += dt;
    const { kind } = attack;
    const total = kind.windup + RECOVER;
    const swing = attack.t < kind.windup
      ? attack.t / kind.windup
      : Math.max(0, 1 - (attack.t - kind.windup) / RECOVER);
    arm.position.z = base + kind.arm * swing;

    if (!attack.dealt && before < kind.windup && attack.t >= kind.windup) {
      attack.dealt = true;
      const dist = attacker.position.distanceTo(defender.position);
      if (dist <= kind.reach + 1.1) {
        const blocked = isPlayer ? this.cpuBlocking : this.playerBlocking;
        const dmg = kind.dmg * (blocked ? 0.25 : 1);
        if (isPlayer) { this.cpuHP -= dmg; this.dealt += dmg; } else { this.playerHP -= dmg; }
        if (!blocked) {
          const push = defender.position.clone().sub(attacker.position).setY(0).normalize()
            .multiplyScalar(kind.knock);
          defender.position.add(push);
          this.clampToArena(defender.position);
        }
        this.burst.burst(defender.position.clone().setY(1.3), isPlayer ? PALETTE.cyan : PALETTE.red, 12, 6);
        this.audio[kind === KICK ? 'thud' : 'blip'](kind === KICK ? undefined : 4);
      } else {
        this.audio.tone([500, 300], 0.05, { type: 'sine', gain: 0.04 });
      }
    }

    return attack.t >= total ? null : attack;
  }

  finish(won) {
    this.audio[won ? 'win' : 'lose']();
    this.burst.burst((won ? this.cpu : this.player).position, won ? PALETTE.red : PALETTE.cyan, 26, 10);
    this.end(Math.round(this.dealt), won
      ? `You won! ${Math.round(this.playerHP)} HP left, ${Math.round(this.dealt)} damage dealt.`
      : `The rival won. You dealt ${Math.round(this.dealt)} damage.`);
  }
}
