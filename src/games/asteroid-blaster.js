import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import {
  torus, lights, sky, glow, mat, starfield, Burst, clamp, damp, rand, randInt, PALETTE,
} from '../engine/utils.js';

const SPAWN_Z = -170;
const TIERS = [
  { r: 0.9, hp: 1, points: 100, colour: 0xff9d6e },
  { r: 1.7, hp: 1, points: 60, colour: 0xc98f6e },
  { r: 2.9, hp: 1, points: 30, colour: 0x9c7a68 },
];

export default class AsteroidBlaster extends Game {
  start() {
    sky(this.scene, '#101a3a', '#03040a', 90, 240);
    lights(this.scene, { sky: 0x8ea8ff, groundCol: 0x0a0f20, intensity: 0.9 });
    starfield(this.scene, 900, 320);

    this.rocks = [];
    this.burst = new Burst(this.scene, 140, 0.3);

    // Reticle sits on the pointer ray so aiming reads in 3D.
    this.reticle = this.add(torus(0.55, 0.05, PALETTE.cyan, { cast: false, receive: false }));
    this.reticle.material = glow(PALETTE.cyan, { transparent: true, opacity: 0.85 });

    // Tracer beam, reused for every shot.
    this.beam = this.add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0 }),
    ));
    this.beam.castShadow = false;

    this.score = 0;
    this.hull = 5;
    this.destroyed = 0;
    this.shots = 0;
    this.cooldown = 0;
    this.nextSpawn = 1;
    this.wave = 1;
    this.shake = 0;

    this.camera.position.set(0, 0, 0);
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this._ray = new THREE.Raycaster();
    this.hud.hint('Aim with the mouse, click to fire · big rocks break into smaller ones');
  }

  spawn(tier = 2, at = null, vel = null) {
    const t = TIERS[tier];
    const geoDetail = tier === 0 ? 0 : 1;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(t.r, geoDetail),
      mat(t.colour, { roughness: 0.95, flatShading: true }),
    );
    rock.castShadow = false;
    // Rough the silhouette up so they don't read as spheres.
    const p = rock.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 1 + rand(-0.22, 0.22);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    p.needsUpdate = true;
    rock.geometry.computeVertexNormals();

    rock.position.copy(at || new THREE.Vector3(rand(-40, 40), rand(-24, 24), SPAWN_Z));
    const speed = rand(16, 24) + this.wave * 1.6;
    rock.userData = {
      tier,
      vel: vel || new THREE.Vector3(
        -rock.position.x / 12 + rand(-2, 2),
        -rock.position.y / 12 + rand(-2, 2),
        speed,
      ),
      spin: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)),
    };
    this.rocks.push(this.add(rock));
    return rock;
  }

  update(dt) {
    this.wave = 1 + this.time / 20;

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawn(randInt(1, 2));
      this.nextSpawn = clamp(1.9 - this.time * 0.02, 0.45, 1.9) * rand(0.7, 1.25);
    }

    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      const d = r.userData;
      r.position.addScaledVector(d.vel, dt);
      r.rotation.x += d.spin.x * dt;
      r.rotation.y += d.spin.y * dt;
      r.rotation.z += d.spin.z * dt;

      if (r.position.z > 2) {
        this.impact(r);
        if (this.finished) return;
      }
    }

    // Aim
    this._ray.setFromCamera(this.input.pointer, this.camera);
    this.reticle.position.copy(this._ray.ray.at(24, new THREE.Vector3()));
    this.reticle.lookAt(this.camera.position);
    this.reticle.rotation.z = this.time * 1.5;

    this.cooldown -= dt;
    if (this.input.down && this.cooldown <= 0) this.fire();

    this.beam.material.opacity = Math.max(0, this.beam.material.opacity - dt * 5);
    this.burst.update(dt);

    // Camera drifts slightly with the pointer, plus impact shake.
    this.shake = Math.max(0, this.shake - dt * 3);
    this.camera.rotation.x = damp(this.camera.rotation.x, this.input.pointer.y * 0.07, 5, dt) + rand(-1, 1) * this.shake * 0.02;
    this.camera.rotation.y = damp(this.camera.rotation.y, -this.input.pointer.x * 0.09, 5, dt) + rand(-1, 1) * this.shake * 0.02;

    this.hud.stat('Score', this.score);
    this.hud.stat('Hull', '▮'.repeat(this.hull) || '—', this.hull <= 2);
    this.hud.stat('Rocks', this.destroyed);
  }

  fire() {
    this.cooldown = 0.16;
    this.shots++;
    this.audio.tone([900, 260], 0.09, { type: 'square', gain: 0.09 });

    this._ray.setFromCamera(this.input.pointer, this.camera);
    const hits = this._ray.intersectObjects(this.rocks, false);
    const end = hits.length ? hits[0].point : this._ray.ray.at(160, new THREE.Vector3());

    // Stretch the tracer cylinder from the muzzle to the impact point.
    const from = this.camera.position.clone().add(new THREE.Vector3(0, -1.2, -1).applyQuaternion(this.camera.quaternion));
    const mid = from.clone().add(end).multiplyScalar(0.5);
    this.beam.position.copy(mid);
    this.beam.scale.set(1, from.distanceTo(end), 1);
    this.beam.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), end.clone().sub(from).normalize(),
    );
    this.beam.material.opacity = 0.9;

    if (hits.length) this.destroy(hits[0].object, hits[0].point);
  }

  destroy(rock, point) {
    const tier = rock.userData.tier;
    this.score += TIERS[tier].points;
    this.destroyed++;
    this.burst.burst(point, TIERS[tier].colour, 10 + tier * 5, 6 + tier * 2);
    this.audio.noise(0.2 + tier * 0.06, { gain: 0.16, cutoff: 900 - tier * 200 });
    this.remove(rock);

    if (tier > 0) {
      for (let i = 0; i < 2; i++) {
        const v = rock.userData.vel.clone();
        v.x += rand(-7, 7);
        v.y += rand(-7, 7);
        this.spawn(tier - 1, rock.position.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), 0)), v);
      }
    } else if (this.destroyed % 15 === 0) {
      this.hud.toast(`${this.destroyed} destroyed`, 700);
    }
  }

  impact(rock) {
    this.hull--;
    this.shake = 1;
    this.burst.burst(rock.position, PALETTE.red, 18, 9);
    this.audio.boom();
    this.remove(rock);
    if (this.hull <= 0) {
      const acc = this.shots ? Math.round((this.destroyed / this.shots) * 100) : 0;
      this.audio.lose();
      this.end(this.score, `${this.destroyed} rocks down · ${acc}% accuracy.`);
    } else {
      this.hud.toast('HULL BREACH', 700);
    }
  }

  remove(rock) {
    const i = this.rocks.indexOf(rock);
    if (i >= 0) this.rocks.splice(i, 1);
    this.scene.remove(rock);
    rock.geometry.dispose();
    rock.material.dispose();
  }
}
