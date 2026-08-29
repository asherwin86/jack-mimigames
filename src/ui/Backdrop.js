import * as THREE from 'three';
import { box, lights, sky, glow, rand, COLORS } from '../engine/utils.js';

/** Slowly tumbling cubes behind the arcade menu, so the canvas is never dead. */
export function buildBackdrop(size) {
  const scene = new THREE.Scene();
  sky(scene, '#1b2a52', '#080b14', 30, 160);
  lights(scene, { sky: 0xa9c8ff, groundCol: 0x141b30, intensity: 0.7 });

  const camera = new THREE.PerspectiveCamera(55, size.w / size.h, 0.1, 300);
  camera.position.set(0, 2, 26);

  const cubes = [];
  for (let i = 0; i < 46; i++) {
    const s = rand(0.8, 3.4);
    const c = box(s, s, s, glow(COLORS[i % COLORS.length], {
      emissiveIntensity: 0.28, transparent: true, opacity: 0.5,
    }), { cast: false, receive: false });
    c.position.set(rand(-38, 38), rand(-20, 20), rand(-70, 8));
    c.userData = { spin: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)), drift: rand(0.6, 2.4) };
    scene.add(c);
    cubes.push(c);
  }

  let t = 0;
  const update = (dt) => {
    t += dt;
    for (const c of cubes) {
      const d = c.userData;
      c.rotation.x += d.spin.x * dt;
      c.rotation.y += d.spin.y * dt;
      c.position.y += Math.sin(t * 0.4 + c.position.x) * dt * 0.3;
      c.position.z += d.drift * dt;
      if (c.position.z > 14) { c.position.z = -70; c.position.x = rand(-38, 38); }
    }
    camera.position.x = Math.sin(t * 0.12) * 3;
    camera.lookAt(0, 0, -20);
  };

  return { scene, camera, update };
}
