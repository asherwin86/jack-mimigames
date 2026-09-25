import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  box, cyl, ground, lights, sky, glow, mat, Burst, clamp, damp, rand, chance, PALETTE,
} from '../engine/utils.js';

const HALF = 15;             // arena half-size
const COVER = [[-6, -5, 3, 3], [6, -5, 3, 3], [0, 3, 4, 2], [-9, 7, 2, 4], [9, 7, 2, 4]];   // [x, z, w, d]
const PLAYER_SPEED = 8;
const HP = 5;

function makeTank(color) {
  const g = new THREE.Group();
  const hull = box(1.9, 0.7, 2.6, mat(color, { roughness: 0.6 }));
  hull.position.y = 0.55;
  g.add(hull);
  const turret = new THREE.Group();
  const dome = cyl(0.65, 0.75, 0.5, mat(color, { roughness: 0.5 }));
  dome.position.y = 1.1;
  const gun = box(0.28, 0.28, 1.7, glow(color, { emissiveIntensity: 0.25 }));
  gun.position.set(0, 1.1, 1.2);
  turret.add(dome, gun);
  g.add(turret);
  g.userData.turret = turret;
  return g;
}

export default class TankBattle extends Game {
  start() {
    sky(this.scene, '#3a4a2a', '#0a0e08', 60, 170);
    lights(this.scene, { sky: 0xe8ffd0, groundCol: 0x1c2a14 });
    this.add(ground(80, 0x2c3d22));
    for (const [x, z, w, d] of [[0, -HALF - 0.5, HALF * 2 + 2, 1], [0, HALF + 0.5, HALF * 2 + 2, 1], [-HALF - 0.5, 0, 1, HALF * 2], [HALF + 0.5, 0, 1, HALF * 2]]) {
      const wall = box(w, 1.6, d, mat(0x55603f));
      wall.position.set(x, 0.8, z);
      this.add(wall);
    }
    this.cover = COVER.map(([x, z, w, d]) => {
      const b = box(w, 1.6, d, mat(0x6b5a3a));
      b.position.set(x, 0.8, z);
      b.userData = { x, z, hw: w / 2, hd: d / 2 };
      return this.add(b);
    });

    this.player = this.add(makeTank(0x5fd0ff));
    this.player.position.set(0, 0, 11);
    this.aim = -Math.PI / 2;         // turret heading, radians about Y (0 = +Z)
    this.hp = HP;
    this.cool = 0;
    this.invuln = 0;
    this.enemies = [];
    this.shots = [];
    this.repairs = [];
    this.burst = new Burst(this.scene, 100, 0.22);
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.nextWave = 1.2;
    this.showCursor = true;

    this.camera.position.set(0, 30, 13);
    this.camera.lookAt(0, 0, 1);
    this.hud.hint('WASD to drive · aim with the mouse (or right stick) · click, Space or RT to fire · wreck every tank');
  }

  blocked(x, z, r) {
    if (Math.abs(x) > HALF - r || Math.abs(z) > HALF - r) return true;
    return this.cover.some((c) => Math.abs(x - c.userData.x) < c.userData.hw + r && Math.abs(z - c.userData.z) < c.userData.hd + r);
  }

  /** Moves `pos` by (dx, dz) one axis at a time so tanks slide along walls. */
  drive(obj, dx, dz, r = 1) {
    if (!this.blocked(obj.position.x + dx, obj.position.z, r)) obj.position.x += dx;
    if (!this.blocked(obj.position.x, obj.position.z + dz, r)) obj.position.z += dz;
  }

  spawnEnemy(heavy) {
    const e = makeTank(heavy ? 0xff5f6d : 0xffb14a);
    const side = Math.floor(rand(0, 4));
    const t = rand(-HALF + 3, HALF - 3);
    e.position.set(side === 0 ? -HALF + 2 : side === 1 ? HALF - 2 : t, 0, side === 2 ? -HALF + 2 : side === 3 ? HALF - 2 : t);
    if (Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z) < 9) e.position.z = -HALF + 2;
    e.scale.setScalar(heavy ? 1.25 : 1);
    e.userData = { ...e.userData, hp: heavy ? 3 : 1, heavy, cool: rand(1, 2.4), strafe: chance(0.5) ? 1 : -1, strafeT: rand(1, 3) };
    this.enemies.push(this.add(e));
  }

  fire(from, angle, friendly) {
    const s = box(0.35, 0.35, 0.9, glow(friendly ? PALETTE.cyan : PALETTE.red, { emissiveIntensity: 1 }), { cast: false });
    s.position.set(from.x + Math.sin(angle) * 1.9, 1.1, from.z + Math.cos(angle) * 1.9);
    s.rotation.y = angle;
    s.userData = { vx: Math.sin(angle) * (friendly ? 28 : 15), vz: Math.cos(angle) * (friendly ? 28 : 15), friendly, life: 2.5 };
    this.shots.push(this.add(s));
    this.audio.tone(friendly ? [500, 200] : [300, 140], 0.08, { type: 'square', gain: 0.08 });
  }

  update(dt) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.cool -= dt;

    // Waves: each is bigger, with heavy tanks joining in.
    this.nextWave -= dt;
    if (this.enemies.length === 0 && this.nextWave <= 0) {
      this.wave++;
      const n = Math.min(9, 2 + this.wave);
      for (let i = 0; i < n; i++) this.spawnEnemy(this.wave >= 3 && i % 3 === 2);
      this.hud.toast(`Wave ${this.wave}`, 900);
      this.nextWave = 2.5;
    }

    // Player: drive, aim, fire.
    const dir = new THREE.Vector3(this.input.axisX(), 0, -this.input.axisY());
    if (dir.lengthSq()) dir.normalize();
    this.drive(this.player, dir.x * PLAYER_SPEED * dt, dir.z * PLAYER_SPEED * dt);
    if (dir.lengthSq()) this.player.rotation.y = damp(this.player.rotation.y, Math.atan2(dir.x, dir.z), 10, dt);

    const rx = this.input.gpAxis(2);
    const ry = this.input.gpAxis(3);
    if (Math.hypot(rx, ry) > 0.35) this.aim = Math.atan2(rx, ry);
    else if (this.input.delta.lengthSq() > 0 || this.input.usingGamepadPointer || this.input.down) {
      const g = this.groundPoint(0);
      if (g) this.aim = Math.atan2(g.x - this.player.position.x, g.z - this.player.position.z);
    } else if (this.enemies.length) {   // no pointer in use (touch buttons, keyboard only): lock on to the nearest tank
      let best = Infinity;
      for (const e of this.enemies) {
        const d = Math.hypot(e.position.x - this.player.position.x, e.position.z - this.player.position.z);
        if (d < best) { best = d; this.aim = Math.atan2(e.position.x - this.player.position.x, e.position.z - this.player.position.z); }
      }
    }
    const turret = this.player.userData.turret;
    turret.rotation.y = this.aim - this.player.rotation.y;

    if ((this.input.down || this.input.key('Space') || this.input.gpButton(7) || this.input.gpButton(0)) && this.cool <= 0) {
      this.cool = 0.36;
      this.fire(this.player.position, this.aim, true);
    }

    // Enemies: close in to a firing distance, strafe, shoot.
    for (const e of this.enemies) {
      const u = e.userData;
      const dx = this.player.position.x - e.position.x;
      const dz = this.player.position.z - e.position.z;
      const dist = Math.hypot(dx, dz);
      const speed = u.heavy ? 2.6 : 4.2;
      const face = Math.atan2(dx, dz);
      e.rotation.y = damp(e.rotation.y, face, 6, dt);
      e.userData.turret.rotation.y = 0;
      u.strafeT -= dt;
      if (u.strafeT <= 0) { u.strafe *= -1; u.strafeT = rand(1.2, 3.2); }
      const toward = dist > 10 ? 1 : dist < 6 ? -0.6 : 0;
      this.drive(e, (dx / dist * toward + (dz / dist) * u.strafe * 0.7) * speed * dt, (dz / dist * toward - (dx / dist) * u.strafe * 0.7) * speed * dt);
      u.cool -= dt;
      if (u.cool <= 0 && dist < 20) {
        u.cool = rand(1.6, 3) * (u.heavy ? 0.8 : 1);
        this.fire(e.position, face + rand(-0.12, 0.12), false);
      }
    }

    // Shots
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const u = s.userData;
      s.position.x += u.vx * dt;
      s.position.z += u.vz * dt;
      u.life -= dt;
      let gone = u.life <= 0 || this.blocked(s.position.x, s.position.z, 0.1);
      if (!gone && u.friendly) {
        for (let k = this.enemies.length - 1; k >= 0; k--) {
          const e = this.enemies[k];
          if (Math.hypot(e.position.x - s.position.x, e.position.z - s.position.z) < (e.userData.heavy ? 1.7 : 1.35)) {
            this.hitEnemy(e, k);
            gone = true;
            break;
          }
        }
      } else if (!gone && this.invuln <= 0 && Math.hypot(this.player.position.x - s.position.x, this.player.position.z - s.position.z) < 1.3) {
        this.hurt();
        gone = true;
        if (this.finished) return;
      }
      if (gone) { this.scene.remove(s); this.shots.splice(i, 1); }
    }

    // Repair kits
    for (let i = this.repairs.length - 1; i >= 0; i--) {
      const r = this.repairs[i];
      r.rotation.y += dt * 2;
      if (Math.hypot(r.position.x - this.player.position.x, r.position.z - this.player.position.z) < 1.6) {
        this.hp = Math.min(HP, this.hp + 1);
        this.hud.toast('REPAIRED', 600);
        this.audio.good();
        this.scene.remove(r);
        this.repairs.splice(i, 1);
      }
    }

    this.player.visible = this.invuln <= 0 || Math.sin(this.time * 30) > 0;
    this.burst.update(dt);
    this.hud.stat('Score', this.score);
    this.hud.stat('Armour', '▮'.repeat(this.hp) || '—', this.hp <= 2);
    this.hud.stat('Wave', this.wave);
  }

  hitEnemy(e, index) {
    e.userData.hp--;
    this.burst.burst(e.position, PALETTE.amber, 8, 5);
    if (e.userData.hp > 0) { this.audio.thud(); return; }
    this.score += e.userData.heavy ? 200 : 100;
    this.kills++;
    this.burst.burst(e.position, PALETTE.red, 22, 9);
    this.audio.boom();
    if (chance(0.22)) {
      const kit = box(0.8, 0.8, 0.8, glow(PALETTE.lime, { emissiveIntensity: 0.9 }));
      kit.position.set(e.position.x, 0.6, e.position.z);
      this.repairs.push(this.add(kit));
    }
    this.scene.remove(e);
    this.enemies.splice(index, 1);
  }

  hurt() {
    this.hp--;
    this.invuln = 1.2;
    this.burst.burst(this.player.position, PALETTE.cyan, 16, 7);
    this.audio.boom();
    if (this.hp <= 0) {
      this.audio.lose();
      this.end(this.score, `${this.kills} tank${this.kills === 1 ? '' : 's'} wrecked, wave ${this.wave}.`);
    } else this.hud.toast(`${this.hp} armour left`, 700);
  }
}
