import * as THREE from 'three';
import { rand, TAU } from '../engine/utils.js';

/*
 * The flock: forty odd things, each built from primitives, all flying the same
 * lane across the menu backdrop. Geometry and materials are cached by shape and
 * colour, so forty props cost a few dozen buffers rather than a few hundred.
 */

const COLOR = {
  white: 0xf4efe3, cream: 0xfff2c4, grey: 0x9aa3ad, dark: 0x2c313a, black: 0x1c1e24,
  red: 0xd9403c, orange: 0xf08b3a, yellow: 0xf2c53d, gold: 0xe8c05a,
  green: 0x5fbb62, leaf: 0x3f8f4a, blue: 0x3f8fd6, navy: 0x2a4f7d,
  purple: 0x8a63d2, pink: 0xef8fb5, brown: 0x8b5a3c, tan: 0xd9b382,
  beige: 0xd9d2bd, cyan: 0x63d4ff, silver: 0xc9d2da,
};

/** Caches geometry by shape and materials by colour for the whole flock. */
function makeKit() {
  const geos = new Map();
  const mats = new Map();
  const geo = (k, make) => {
    let v = geos.get(k);
    if (!v) { v = make(); geos.set(k, v); }
    return v;
  };
  const mat = (map, k, make) => {
    let v = map.get(k);
    if (!v) { v = make(); map.set(k, v); }
    return v;
  };

  return {
    g: {
      box: (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
      ball: (r, s = 10) => geo(`s${r},${s}`, () => new THREE.SphereGeometry(r, s, Math.max(6, s >> 1))),
      cyl: (rt, rb, h, s = 12) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
      cone: (r, h, s = 10) => geo(`n${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
      torus: (r, t, s = 8, ts = 16, arc = TAU) => geo(`t${r},${t},${s},${ts},${arc}`,
        () => new THREE.TorusGeometry(r, t, s, ts, arc)),
      plane: (w, h) => geo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
      octa: (r) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r)),
      // A slice of a cylinder — pizza, and anything else that wants a wedge.
      wedge: (r, h, arc) => geo(`w${r},${h},${arc}`,
        () => new THREE.CylinderGeometry(r, r, h, 10, 1, false, 0, arc)),
    },
    m: (color) => mat(mats, `l${color}`, () => new THREE.MeshLambertMaterial({ color })),
    lit: (color) => mat(mats, `u${color}`, () => new THREE.MeshBasicMaterial({ color })),
    map: (name, make) => mat(mats, `m${name}`, () => new THREE.MeshLambertMaterial({ map: make() })),
    glass: (color) => mat(mats, `g${color}`,
      () => new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.45 })),
  };
}

/** Nearest-filtered canvas texture from a 16x16 painter. */
function pixels(paint, w = 16, h = 16) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d'));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const stripeTex = () => pixels((g) => {
  for (let x = 0; x < 16; x++) {
    g.fillStyle = x % 4 < 2 ? '#e8433f' : '#f6f1e4';
    g.fillRect(x, 0, 1, 16);
  }
});

const nyanFaceTex = () => pixels((g) => {
  // 8x8, deliberately as chunky as the original 8-bit gif.
  g.fillStyle = '#c9c9d1';
  g.fillRect(0, 0, 8, 8);
  g.fillStyle = '#ff9ecf';
  g.fillRect(0, 3, 2, 2);
  g.fillRect(6, 3, 2, 2);
  g.fillStyle = '#1c1e24';
  g.fillRect(2, 2, 4, 1);
  g.fillRect(3, 5, 2, 1);
}, 8, 8);

const gameLogoTex = () => pixels((g) => {
  // The app's own mark: 100 / Mimi / Games in the same red-blue-red as the
  // menu heading, on a dark plate so it reads as a badge from any distance.
  g.fillStyle = '#10131c';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,.08)';
  g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 22px system-ui, sans-serif';
  g.fillStyle = '#ff4554';
  g.fillText('100', 32, 24);
  g.font = '800 11px system-ui, sans-serif';
  g.fillStyle = '#00c3e3';
  g.fillText('MIMI', 32, 40);
  g.fillStyle = '#ff4554';
  g.fillText('GAMES', 32, 51);
}, 64, 64);

const screenTex = () => pixels((g) => {
  g.fillStyle = '#10243f';
  g.fillRect(0, 0, 16, 16);
  for (let y = 2; y < 15; y += 3) {
    g.fillStyle = y % 2 ? '#63d4ff' : '#9ef7c8';
    g.fillRect(2, y, 2 + ((y * 5) % 9), 1);
  }
});

/** Adds a mesh to `parent`. Every builder below is written in terms of this. */
function add(parent, geometry, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(mesh);
  return mesh;
}

/** Marks a part as beating: `axis` swings between base-amp and base+amp. */
function beat(obj, axis, base, amp, rate = 1) {
  obj.userData.f = { axis, base, amp, rate };
  return obj;
}

/** Marks a part as turning steadily about `axis`. */
function turn(obj, axis, rate) {
  obj.userData.s = { axis, rate };
  return obj;
}

/*
 * Each builder takes the kit and returns its parts. Anything passed back in
 * `flap` beats; anything in `spin` turns. Sizes hover around one unit so the
 * flock reads at a consistent scale.
 */

/** Four wheels at the given half-track and half-wheelbase, black on dark hubs. */
function wheels(o, g, m, hx, hz, r = 0.2, w = 0.14) {
  for (const x of [-hx, hx]) {
    for (const z of [-hz, hz]) {
      add(o, g.cyl(r, r, w, 12), m(COLOR.black), [x, -r + 0.02, z], [Math.PI / 2, 0, 0]);
      add(o, g.cyl(r * 0.45, r * 0.45, w + 0.01, 8), m(COLOR.grey), [x, -r + 0.02, z], [Math.PI / 2, 0, 0]);
    }
  }
}


const BUILDERS = {
  popcorn: ({ g, m, map }, o) => {
    add(o, g.cyl(0.42, 0.3, 0.72), map('stripe', stripeTex));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      add(o, g.ball(0.11, 6), m(COLOR.cream), [Math.cos(a) * 0.24, 0.38 + (i % 3) * 0.07, Math.sin(a) * 0.24]);
    }
  },
  soda: ({ g, m }, o) => {
    add(o, g.cyl(0.3, 0.21, 0.78), m(COLOR.red));
    add(o, g.cyl(0.34, 0.34, 0.08), m(COLOR.white), [0, 0.42, 0]);
    add(o, g.cyl(0.04, 0.04, 0.62, 6), m(COLOR.white), [0.1, 0.72, 0], [0, 0, -0.28]);
  },
  chips: ({ g, m }, o) => {
    add(o, g.box(0.66, 0.92, 0.3), m(COLOR.yellow));
    add(o, g.box(0.68, 0.16, 0.32), m(COLOR.brown), [0, 0.1, 0]);
  },
  desktop: ({ g, m, map }, o) => {
    add(o, g.box(1, 0.82, 0.72), m(COLOR.beige), [0.26, 0.2, 0]);
    add(o, g.plane(0.8, 0.6), map('screen', screenTex), [0.26, 0.2, 0.37]);
    add(o, g.box(0.26, 0.18, 0.26), m(COLOR.beige), [0.26, -0.3, 0]);
    add(o, g.box(0.62, 0.09, 0.52), m(COLOR.beige), [0.26, -0.42, 0]);
    add(o, g.box(0.38, 0.9, 0.72), m(COLOR.beige), [-0.52, -0.05, 0]);
  },
  laptop: ({ g, m, map }, o, flap) => {
    add(o, g.box(0.94, 0.07, 0.64), m(COLOR.silver));
    add(o, g.box(0.74, 0.012, 0.42), m(COLOR.dark), [0, 0.04, 0.06]);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.03, -0.32);
    add(hinge, g.box(0.94, 0.6, 0.045), m(COLOR.silver), [0, 0.3, 0]);
    add(hinge, g.plane(0.82, 0.5), map('screen', screenTex), [0, 0.3, 0.025]);
    o.add(hinge);
    flap.push(beat(hinge, 'x', -0.9, 0.75, 4));
  },
  pizza: ({ g, m }, o) => {
    add(o, g.wedge(0.62, 0.07, TAU / 6), m(COLOR.tan));
    add(o, g.wedge(0.56, 0.02, TAU / 6), m(COLOR.red), [0, 0.05, 0]);
    for (let i = 0; i < 3; i++) {
      const a = TAU / 12 + (i - 1) * 0.28;
      add(o, g.cyl(0.07, 0.07, 0.02, 8), m(0xb8452c), [Math.cos(a) * 0.34, 0.07, -Math.sin(a) * 0.34]);
    }
  },
  donut: ({ g, m }, o) => {
    add(o, g.torus(0.4, 0.17), m(COLOR.brown));
    add(o, g.torus(0.4, 0.185, 6, 14), m(COLOR.pink), [0, 0.04, 0]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      add(o, g.box(0.09, 0.02, 0.03), m(i % 2 ? COLOR.cyan : COLOR.yellow),
        [Math.cos(a) * 0.4, 0.2, Math.sin(a) * 0.4], [0, -a, 0]);
    }
  },
  burger: ({ g, m }, o) => {
    add(o, g.cyl(0.42, 0.36, 0.26), m(COLOR.tan), [0, 0.28, 0]);
    add(o, g.cyl(0.44, 0.44, 0.06), m(COLOR.leaf), [0, 0.12, 0]);
    add(o, g.cyl(0.4, 0.4, 0.16), m(0x6b3f28), [0, 0, 0]);
    add(o, g.cyl(0.42, 0.42, 0.05), m(COLOR.yellow), [0, -0.11, 0]);
    add(o, g.cyl(0.38, 0.42, 0.18), m(COLOR.tan), [0, -0.24, 0]);
  },
  icecream: ({ g, m }, o) => {
    add(o, g.cone(0.28, 0.7, 10), m(COLOR.tan), [0, -0.3, 0], [Math.PI, 0, 0]);
    add(o, g.ball(0.27), m(COLOR.pink), [0, 0.12, 0]);
    add(o, g.ball(0.22), m(COLOR.cream), [0.1, 0.4, -0.05]);
  },
  banana: ({ g, m }, o) => {
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3;
      add(o, g.cyl(0.11, 0.11, 0.24, 8), m(COLOR.yellow),
        [Math.sin(a) * 0.5, Math.cos(a) * 0.5 - 0.5, 0], [0, 0, -a]);
    }
  },
  sushi: ({ g, m }, o) => {
    add(o, g.cyl(0.32, 0.32, 0.34), m(COLOR.white), [0, 0, 0], [Math.PI / 2, 0, 0]);
    add(o, g.box(0.5, 0.1, 0.36), m(COLOR.orange), [0, 0.3, 0]);
    add(o, g.box(0.16, 0.36, 0.38), m(0x27331f), [0, 0.05, 0]);
  },
  cake: ({ g, m, lit }, o) => {
    add(o, g.cyl(0.46, 0.46, 0.4), m(COLOR.pink));
    add(o, g.cyl(0.48, 0.48, 0.08), m(COLOR.white), [0, 0.22, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const x = Math.cos(a) * 0.22;
      const z = Math.sin(a) * 0.22;
      add(o, g.cyl(0.035, 0.035, 0.26, 6), m(COLOR.cyan), [x, 0.38, z]);
      add(o, g.cone(0.05, 0.13, 6), lit(0xffd27a), [x, 0.57, z]);
    }
  },
  duck: ({ g, m, lit }, o, flap) => {
    add(o, g.ball(0.36), m(COLOR.yellow));
    add(o, g.ball(0.23), m(COLOR.yellow), [0.02, 0.36, 0.14]);
    add(o, g.cone(0.09, 0.2, 6), lit(COLOR.orange), [0, 0.34, 0.34], [Math.PI / 2, 0, 0]);
    add(o, g.ball(0.035, 6), m(COLOR.black), [0.12, 0.44, 0.24]);
    add(o, g.ball(0.035, 6), m(COLOR.black), [-0.12, 0.44, 0.24]);
    flap.push(beat(add(o, g.box(0.4, 0.05, 0.3), m(0xe8b62c), [0.32, 0.06, 0]), 'z', 0.2, 0.5, 7));
    flap.push(beat(add(o, g.box(0.4, 0.05, 0.3), m(0xe8b62c), [-0.32, 0.06, 0]), 'z', -0.2, 0.5, 7));
  },
  bird: ({ g, m, lit }, o, flap) => {
    add(o, g.ball(0.3), m(COLOR.blue));
    add(o, g.ball(0.19), m(COLOR.blue), [0, 0.28, 0.12]);
    add(o, g.cone(0.07, 0.18, 6), lit(COLOR.orange), [0, 0.28, 0.3], [Math.PI / 2, 0, 0]);
    add(o, g.cone(0.16, 0.4, 6), m(COLOR.navy), [0, -0.05, -0.35], [-Math.PI / 2.4, 0, 0]);
    flap.push(beat(add(o, g.box(0.62, 0.04, 0.34), m(COLOR.cyan), [0.4, 0.08, 0]), 'z', 0, 0.9, 9));
    flap.push(beat(add(o, g.box(0.62, 0.04, 0.34), m(COLOR.cyan), [-0.4, 0.08, 0]), 'z', 0, -0.9, 9));
  },
  bee: ({ g, m, glass }, o, flap) => {
    for (let i = 0; i < 4; i++) {
      add(o, g.cyl(0.22, 0.22, 0.12, 10), m(i % 2 ? COLOR.black : COLOR.yellow),
        [0, 0, -0.18 + i * 0.12], [Math.PI / 2, 0, 0]);
    }
    add(o, g.ball(0.2), m(COLOR.black), [0, 0, 0.3]);
    add(o, g.cone(0.06, 0.16, 6), m(COLOR.black), [0, 0, -0.32], [-Math.PI / 2, 0, 0]);
    flap.push(beat(add(o, g.plane(0.42, 0.24), glass(0xdff3ff), [0.24, 0.16, 0], [Math.PI / 2, 0, 0]), 'y', 0, 0.6, 22));
    flap.push(beat(add(o, g.plane(0.42, 0.24), glass(0xdff3ff), [-0.24, 0.16, 0], [Math.PI / 2, 0, 0]), 'y', 0, -0.6, 22));
  },
  fish: ({ g, m }, o, flap) => {
    const body = add(o, g.ball(0.32), m(COLOR.orange));
    body.scale.set(1.3, 0.9, 0.7);
    add(o, g.ball(0.045, 6), m(COLOR.black), [0.3, 0.1, 0.16]);
    add(o, g.cone(0.2, 0.3, 6), m(COLOR.red), [0, 0.28, 0]);
    flap.push(beat(add(o, g.cone(0.26, 0.34, 6), m(COLOR.red), [-0.5, 0, 0], [0, 0, Math.PI / 2]), 'y', 0, 0.5, 8));
  },
  rocket: ({ g, m, lit }, o, flap) => {
    add(o, g.cyl(0.22, 0.26, 0.9), m(COLOR.white));
    add(o, g.cone(0.26, 0.4), m(COLOR.red), [0, 0.65, 0]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      add(o, g.box(0.06, 0.3, 0.26), m(COLOR.red), [Math.cos(a) * 0.24, -0.42, Math.sin(a) * 0.24], [0, -a, 0]);
    }
    flap.push(beat(add(o, g.cone(0.18, 0.5), lit(COLOR.orange), [0, -0.7, 0], [Math.PI, 0, 0]), 'x', Math.PI, 0.06, 24));
  },
  ufo: ({ g, m, lit, glass }, o, _flap, spin) => {
    const hull = add(o, g.ball(0.6, 14), m(COLOR.silver));
    hull.scale.set(1, 0.28, 1);
    add(o, g.ball(0.3, 12), glass(COLOR.cyan), [0, 0.14, 0]);
    const ring = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      add(ring, g.ball(0.06, 6), lit(i % 2 ? COLOR.yellow : COLOR.cyan), [Math.cos(a) * 0.5, -0.06, Math.sin(a) * 0.5]);
    }
    o.add(ring);
    spin.push(turn(ring, 'y', 2.4));
  },
  paperplane: ({ g, m }, o) => {
    add(o, g.box(0.9, 0.02, 0.32), m(COLOR.white), [0.18, 0, 0.2], [0.35, 0, 0]);
    add(o, g.box(0.9, 0.02, 0.32), m(COLOR.white), [0.18, 0, -0.2], [-0.35, 0, 0]);
    add(o, g.box(0.86, 0.16, 0.02), m(COLOR.white), [0.2, -0.06, 0]);
  },
  balloon: ({ g, m }, o) => {
    const b = add(o, g.ball(0.36), m(COLOR.red), [0, 0.3, 0]);
    b.scale.set(1, 1.2, 1);
    add(o, g.cone(0.09, 0.14, 6), m(COLOR.red), [0, -0.1, 0], [Math.PI, 0, 0]);
    add(o, g.cyl(0.012, 0.012, 0.7, 4), m(COLOR.white), [0, -0.5, 0]);
  },
  book: ({ g, m }, o, flap) => {
    add(o, g.box(0.1, 0.66, 0.5), m(0x7a2f2f));
    // The covers beat like a pair of wings, which is the whole joke.
    const left = new THREE.Group();
    add(left, g.box(0.04, 0.62, 0.46), m(0x7a2f2f), [0, 0, -0.24]);
    add(left, g.box(0.03, 0.56, 0.42), m(COLOR.cream), [0.03, 0, -0.24]);
    const right = left.clone();
    left.position.set(0, 0, -0.02);
    right.position.set(0, 0, 0.02);
    right.scale.z = -1;
    o.add(left, right);
    flap.push(beat(left, 'x', 0, 0.8, 6), beat(right, 'x', 0, -0.8, 6));
  },
  tv: ({ g, m, map }, o, _flap, _spin, i) => {
    // A modern flat-screen, not the old CRT: slim bezel, no depth to speak of,
    // on a stand foot. A small fleet in a few frame colours.
    const bezel = m([COLOR.black, COLOR.dark, COLOR.silver][i % 3]);
    add(o, g.box(1.5, 0.92, 0.05), bezel);
    add(o, g.plane(1.38, 0.8), map('screen', screenTex), [0, 0.02, 0.028]);
    add(o, g.cyl(0.02, 0.02, 0.3, 8), bezel, [0, -0.6, 0]);
    add(o, g.box(0.5, 0.05, 0.16), bezel, [0, -0.76, 0]);
  },
  phone: ({ g, m, map }, o) => {
    add(o, g.box(0.42, 0.82, 0.06), m(COLOR.dark));
    add(o, g.plane(0.36, 0.7), map('screen', screenTex), [0, 0, 0.032]);
  },
  clock: ({ g, m }, o, _flap, spin) => {
    add(o, g.cyl(0.42, 0.42, 0.12), m(COLOR.white), [0, 0, 0], [Math.PI / 2, 0, 0]);
    add(o, g.torus(0.42, 0.05, 6, 18), m(COLOR.gold));
    const hands = new THREE.Group();
    hands.position.z = 0.08;
    add(hands, g.box(0.04, 0.3, 0.02), m(COLOR.black), [0, 0.13, 0]);
    add(hands, g.box(0.04, 0.2, 0.02), m(COLOR.red), [0.08, 0.06, 0], [0, 0, -1.1]);
    o.add(hands);
    spin.push(turn(hands, 'z', -1.6));
  },
  dice: ({ g, m }, o) => {
    add(o, g.box(0.6, 0.6, 0.6), m(COLOR.white));
    const pip = (x, y, z) => add(o, g.ball(0.06, 6), m(COLOR.black), [x, y, z]);
    pip(0, 0, 0.31);
    for (const s of [-0.16, 0.16]) { pip(s, s, -0.31); pip(-s, s, -0.31); }
    pip(0.31, 0.16, 0.16);
    pip(0.31, -0.16, -0.16);
  },
  gem: ({ g, lit }, o) => {
    const d = add(o, g.octa(0.42), lit(COLOR.cyan));
    d.scale.set(1, 1.5, 1);
  },
  star: ({ g, lit }, o) => {
    for (let i = 0; i < 5; i++) {
      add(o, g.box(0.14, 0.9, 0.1), lit(COLOR.gold), [0, 0, 0], [0, 0, (i / 5) * Math.PI]);
    }
  },
  crown: ({ g, m, lit }, o) => {
    add(o, g.cyl(0.38, 0.38, 0.3, 12), m(COLOR.gold));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      add(o, g.cone(0.11, 0.26, 6), m(COLOR.gold), [Math.cos(a) * 0.34, 0.26, Math.sin(a) * 0.34]);
      add(o, g.ball(0.05, 6), lit(COLOR.red), [Math.cos(a) * 0.34, 0.42, Math.sin(a) * 0.34]);
    }
  },
  mushroom: ({ g, m }, o) => {
    add(o, g.cyl(0.15, 0.19, 0.5), m(COLOR.cream), [0, -0.2, 0]);
    const cap = add(o, g.ball(0.42, 12), m(COLOR.red), [0, 0.08, 0]);
    cap.scale.y = 0.62;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      add(o, g.ball(0.07, 6), m(COLOR.white), [Math.cos(a) * 0.28, 0.22, Math.sin(a) * 0.28]);
    }
  },
  cactus: ({ g, m }, o) => {
    add(o, g.cyl(0.26, 0.3, 0.3), m(0xa8532f), [0, -0.42, 0]);
    add(o, g.cyl(0.17, 0.19, 0.8, 8), m(COLOR.leaf), [0, 0.05, 0]);
    add(o, g.cyl(0.09, 0.09, 0.34, 6), m(COLOR.leaf), [0.22, 0.16, 0], [0, 0, -1.2]);
    add(o, g.cyl(0.09, 0.09, 0.3, 6), m(COLOR.leaf), [0.28, 0.36, 0]);
    add(o, g.ball(0.07, 6), m(COLOR.pink), [0, 0.5, 0]);
  },
  trophy: ({ g, m }, o) => {
    add(o, g.cyl(0.3, 0.18, 0.44, 12), m(COLOR.gold), [0, 0.16, 0]);
    add(o, g.torus(0.16, 0.035, 6, 12), m(COLOR.gold), [0.32, 0.2, 0], [0, Math.PI / 2, 0]);
    add(o, g.torus(0.16, 0.035, 6, 12), m(COLOR.gold), [-0.32, 0.2, 0], [0, Math.PI / 2, 0]);
    add(o, g.cyl(0.08, 0.08, 0.18, 8), m(COLOR.gold), [0, -0.16, 0]);
    add(o, g.box(0.42, 0.14, 0.42), m(0x50331f), [0, -0.32, 0]);
  },
  umbrella: ({ g, m }, o) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      add(o, g.cone(0.32, 0.4, 4), m(i % 2 ? COLOR.red : COLOR.white),
        [Math.cos(a) * 0.26, 0.26, Math.sin(a) * 0.26], [0.5, -a, 0]);
    }
    add(o, g.cyl(0.03, 0.03, 0.8, 6), m(COLOR.brown), [0, -0.1, 0]);
    add(o, g.torus(0.09, 0.03, 5, 10), m(COLOR.brown), [0.09, -0.5, 0], [0, Math.PI / 2, 0]);
  },
  skateboard: ({ g, m }, o) => {
    add(o, g.box(1.1, 0.06, 0.34), m(0x6b3f28));
    add(o, g.box(0.34, 0.05, 0.3), m(COLOR.purple), [0.34, 0.04, 0]);
    for (const x of [-0.36, 0.36]) {
      for (const z of [-0.17, 0.17]) {
        add(o, g.cyl(0.08, 0.08, 0.07, 8), m(COLOR.yellow), [x, -0.09, z], [0, 0, Math.PI / 2]);
      }
    }
  },
  guitar: ({ g, m }, o) => {
    const body = add(o, g.ball(0.34, 12), m(0x8b3a1f), [0, -0.3, 0]);
    body.scale.set(1, 1.1, 0.4);
    add(o, g.cyl(0.11, 0.11, 0.05, 10), m(COLOR.black), [0, -0.24, 0.12], [Math.PI / 2, 0, 0]);
    add(o, g.box(0.13, 0.8, 0.09), m(0x50331f), [0, 0.36, 0]);
    add(o, g.box(0.19, 0.22, 0.07), m(COLOR.black), [0, 0.82, 0]);
  },
  robot: ({ g, m, lit }, o, flap) => {
    add(o, g.box(0.52, 0.56, 0.4), m(COLOR.silver));
    add(o, g.box(0.4, 0.34, 0.34), m(COLOR.silver), [0, 0.48, 0]);
    add(o, g.ball(0.07, 6), lit(COLOR.red), [0.1, 0.5, 0.19]);
    add(o, g.ball(0.07, 6), lit(COLOR.red), [-0.1, 0.5, 0.19]);
    add(o, g.cyl(0.02, 0.02, 0.18, 4), m(COLOR.silver), [0, 0.72, 0]);
    add(o, g.ball(0.05, 6), lit(COLOR.yellow), [0, 0.83, 0]);
    flap.push(beat(add(o, g.box(0.12, 0.44, 0.12), m(COLOR.grey), [0.34, -0.06, 0]), 'z', 0.2, 0.55, 5));
    flap.push(beat(add(o, g.box(0.12, 0.44, 0.12), m(COLOR.grey), [-0.34, -0.06, 0]), 'z', -0.2, 0.55, 5));
  },
  ghost: ({ g, m, glass }, o) => {
    add(o, g.ball(0.34, 12), glass(COLOR.white), [0, 0.1, 0]);
    add(o, g.cyl(0.34, 0.26, 0.5, 12), glass(COLOR.white), [0, -0.24, 0]);
    add(o, g.ball(0.055, 6), m(COLOR.black), [0.13, 0.16, 0.28]);
    add(o, g.ball(0.055, 6), m(COLOR.black), [-0.13, 0.16, 0.28]);
  },
  cat: ({ g, m }, o, flap, _spin, i) => {
    // Nine strays, nine coats.
    const fur = m([COLOR.grey, COLOR.orange, COLOR.black, COLOR.white, COLOR.tan,
      0x8a6a4a, COLOR.cream, 0x4a4f57, COLOR.brown][i % 9]);
    add(o, g.box(0.62, 0.34, 0.36), fur);
    add(o, g.box(0.34, 0.32, 0.3), fur, [0.42, 0.2, 0]);
    add(o, g.cone(0.09, 0.16, 4), m(COLOR.pink), [0.42, 0.42, 0.09]);
    add(o, g.cone(0.09, 0.16, 4), m(COLOR.pink), [0.42, 0.42, -0.09]);
    add(o, g.ball(0.04, 6), m(COLOR.green), [0.58, 0.24, 0.1]);
    add(o, g.ball(0.04, 6), m(COLOR.green), [0.58, 0.24, -0.1]);
    flap.push(beat(add(o, g.cyl(0.045, 0.03, 0.5, 6), fur, [-0.4, 0.14, 0], [0, 0, 0.7]), 'x', 0, 0.5, 4));
  },
  key: ({ g, m }, o) => {
    add(o, g.torus(0.17, 0.05, 6, 12), m(COLOR.gold), [0, 0.34, 0]);
    add(o, g.cyl(0.05, 0.05, 0.62, 8), m(COLOR.gold), [0, -0.1, 0]);
    add(o, g.box(0.18, 0.07, 0.05), m(COLOR.gold), [0.1, -0.28, 0]);
    add(o, g.box(0.18, 0.07, 0.05), m(COLOR.gold), [0.1, -0.4, 0]);
  },
  bulb: ({ g, m, lit, glass }, o) => {
    add(o, g.ball(0.32, 12), glass(0xfff0b0), [0, 0.14, 0]);
    add(o, g.ball(0.1, 6), lit(0xffe9a0), [0, 0.14, 0]);
    add(o, g.cyl(0.14, 0.16, 0.24, 10), m(COLOR.grey), [0, -0.2, 0]);
    add(o, g.cyl(0.1, 0.1, 0.06, 8), m(COLOR.dark), [0, -0.34, 0]);
  },
  teacup: ({ g, m }, o) => {
    add(o, g.cyl(0.28, 0.2, 0.34, 12), m(COLOR.white));
    add(o, g.cyl(0.24, 0.24, 0.03, 12), m(0x6b4327), [0, 0.14, 0]);
    add(o, g.torus(0.11, 0.03, 5, 10), m(COLOR.white), [0.3, 0, 0], [0, Math.PI / 2, 0]);
    add(o, g.cyl(0.4, 0.4, 0.04, 14), m(COLOR.white), [0, -0.22, 0]);
  },
  cheese: ({ g, m }, o) => {
    add(o, g.wedge(0.5, 0.4, TAU / 5), m(COLOR.yellow));
    add(o, g.ball(0.09, 6), m(0xd9a72c), [0.28, 0.2, 0.14]);
    add(o, g.ball(0.07, 6), m(0xd9a72c), [0.36, -0.1, 0.05]);
  },
  cassette: ({ g, m }, o, _flap, spin) => {
    add(o, g.box(0.8, 0.5, 0.1), m(COLOR.dark));
    add(o, g.box(0.6, 0.26, 0.02), m(COLOR.cream), [0, 0.06, 0.06]);
    for (const x of [-0.16, 0.16]) {
      spin.push(turn(add(o, g.cyl(0.09, 0.09, 0.04, 8), m(COLOR.grey), [x, 0.06, 0.08], [Math.PI / 2, 0, 0]), 'y', 5));
    }
  },
  planet: ({ g, m }, o, _flap, spin) => {
    add(o, g.ball(0.38, 14), m(COLOR.purple));
    spin.push(turn(add(o, g.torus(0.6, 0.05, 6, 20), m(COLOR.tan), [0, 0, 0], [1.2, 0, 0.3]), 'z', 0.8));
  },
  sedan: ({ g, m, glass, lit }, o, _flap, _spin, i) => {
    const paint = m([0x2a4f7d, 0xb8bcc2, 0x7a1f1f][i % 3]);
    add(o, g.box(1.9, 0.36, 0.82), paint, [0, -0.1, 0]);                    // lower body
    add(o, g.box(1.0, 0.36, 0.78), paint, [-0.1, 0.24, 0]);                 // cabin
    add(o, g.box(0.9, 0.3, 0.7), glass(0x1d2430), [-0.1, 0.24, 0]);
    add(o, g.box(0.34, 0.1, 0.82), paint, [0.86, 0.02, 0]);                 // boot lip
    for (const z of [-0.24, 0.24]) add(o, g.box(0.05, 0.06, 0.16), lit(COLOR.white), [0.96, -0.02, z]);
    for (const z of [-0.24, 0.24]) add(o, g.box(0.05, 0.06, 0.16), lit(COLOR.red), [-0.96, -0.02, z]);
    wheels(o, g, m, 0.95, 0.42);
  },
  suv: ({ g, m, glass, lit }, o, _flap, _spin, i) => {
    const paint = m([0x3c3f44, 0x8b5a3c, 0x1c3a2e][i % 3]);
    add(o, g.box(1.9, 0.7, 0.9), paint, [0, 0.05, 0]);
    add(o, g.box(1.5, 0.4, 0.84), glass(0x1d2430), [-0.05, 0.32, 0]);
    add(o, g.box(1.98, 0.06, 0.94), m(COLOR.grey), [0, 0.42, 0]);           // roof rails
    for (const z of [-0.26, 0.26]) add(o, g.box(0.05, 0.07, 0.18), lit(COLOR.white), [0.96, 0.14, z]);
    for (const z of [-0.26, 0.26]) add(o, g.box(0.05, 0.07, 0.18), lit(COLOR.red), [-0.96, 0.14, z]);
    wheels(o, g, m, 0.95, 0.46, 0.26, 0.17);
  },
  pickup: ({ g, m, glass }, o) => {
    add(o, g.box(2.1, 0.4, 0.88), m(COLOR.red), [0, -0.06, 0]);
    add(o, g.box(0.8, 0.42, 0.84), m(COLOR.red), [0.55, 0.24, 0]);          // cab
    add(o, g.box(0.66, 0.3, 0.76), glass(0x1d2430), [0.6, 0.28, 0]);
    add(o, g.box(1.1, 0.05, 0.88), m(COLOR.grey), [-0.4, 0.12, 0]);         // tray floor
    add(o, g.box(1.1, 0.24, 0.06), m(COLOR.red), [-0.9, 0.22, 0]);          // tailgate
    wheels(o, g, m, 1.0, 0.46, 0.23, 0.16);
  },
  van: ({ g, m, glass }, o) => {
    add(o, g.box(2.0, 1.0, 0.92), m(COLOR.white), [0, 0.1, 0]);
    add(o, g.box(0.7, 0.5, 0.86), glass(0x1d2430), [0.58, 0.24, 0]);
    add(o, g.box(0.05, 0.6, 0.94), m(COLOR.dark), [0.02, 0.05, 0]);         // side stripe
    wheels(o, g, m, 0.92, 0.48, 0.24, 0.17);
  },
  hatchback: ({ g, m, glass }, o, _flap, _spin, i) => {
    const paint = m([0xe8433f, 0x3f8fd6, 0xf2c53d][i % 3]);
    const shell = add(o, g.ball(0.58, 12), paint, [0, 0.1, 0]);
    shell.scale.set(1.3, 0.72, 1);
    add(o, g.ball(0.5, 12), glass(0x1d2430), [0.02, 0.24, 0]).scale.set(1.05, 0.5, 0.94);
    wheels(o, g, m, 0.5, 0.42, 0.19, 0.14);
  },
  muscle: ({ g, m, glass }, o) => {
    add(o, g.box(2.1, 0.34, 0.86), m(COLOR.black), [0, -0.08, 0]);
    add(o, g.box(0.9, 0.3, 0.8), m(COLOR.black), [-0.05, 0.2, 0]);
    add(o, g.box(0.8, 0.24, 0.72), glass(0x1d2430), [-0.05, 0.24, 0]);
    add(o, g.box(0.16, 0.04, 0.86), m(0xf2c53d), [0.2, 0.12, 0]);           // racing stripe
    add(o, g.cyl(0.16, 0.2, 0.3, 8), m(COLOR.dark), [1.02, -0.02, 0], [0, 0, Math.PI / 2]); // hood scoop-ish bumper
    wheels(o, g, m, 1.0, 0.44, 0.24, 0.19);
  },
  lambo: ({ g, m, lit, glass }, o, flap, _spin, i) => {
    // Three of these fly, in the three colours you actually see them in.
    const paint = m([0xf7d000, 0x8fd400, 0xf2711c][i % 3]);
    add(o, g.box(1.8, 0.16, 0.76), paint);
    add(o, g.box(0.52, 0.1, 0.7), paint, [0.86, 0.01, 0], [0, 0, 0.13]);   // wedge nose
    add(o, g.box(1.1, 0.18, 0.8), paint, [0, 0.14, 0]);
    add(o, g.box(0.6, 0.2, 0.6), paint, [-0.14, 0.32, 0]);                 // cabin
    add(o, g.plane(0.34, 0.56), glass(0x1d2430), [0.18, 0.34, 0], [0, 1.05, 0]);
    add(o, g.box(0.55, 0.14, 0.78), paint, [-0.62, 0.16, 0]);              // rear deck
    add(o, g.box(0.1, 0.03, 0.82), m(COLOR.dark), [-0.92, 0.36, 0]);       // spoiler
    for (const z of [-0.3, 0.3]) add(o, g.box(0.06, 0.16, 0.05), m(COLOR.dark), [-0.9, 0.26, z]);
    for (const x of [-0.58, 0.6]) {
      for (const z of [-0.4, 0.4]) {
        add(o, g.cyl(0.2, 0.2, 0.14, 10), m(COLOR.black), [x, -0.07, z], [Math.PI / 2, 0, 0]);
      }
    }
    for (const z of [-0.22, 0.22]) add(o, g.box(0.06, 0.05, 0.17), lit(COLOR.white), [0.98, 0.07, z]);
    for (const z of [-0.24, 0.24]) add(o, g.box(0.05, 0.07, 0.19), lit(COLOR.red), [-1.02, 0.18, z]);
    add(o, g.box(0.08, 0.1, 0.3), lit(COLOR.orange), [-0.96, 0.04, 0]);    // exhaust glow
    // Scissor doors, hinged at the front and beating like a pair of wings.
    for (const z of [-0.42, 0.42]) {
      const hinge = new THREE.Group();
      hinge.position.set(0.32, 0.14, z);
      add(hinge, g.box(0.62, 0.28, 0.05), paint, [-0.31, 0.06, 0]);
      o.add(hinge);
      flap.push(beat(hinge, 'z', -0.6, 0.6, 3));
    }
  },
  headphones: ({ g, m, lit }, o, flap) => {
    add(o, g.torus(0.5, 0.06, 6, 18, Math.PI), m(COLOR.dark));      // band over the top
    add(o, g.torus(0.46, 0.05, 6, 14, Math.PI), m(COLOR.silver), [0, 0, 0]);
    for (const side of [-1, 1]) {
      // Each cup swivels on the band end, so the pair beats as it flies.
      const arm = new THREE.Group();
      arm.position.set(side * 0.5, 0, 0);
      add(arm, g.box(0.07, 0.22, 0.07), m(COLOR.silver), [0, -0.1, 0]);
      add(arm, g.cyl(0.19, 0.19, 0.16, 12), m(COLOR.dark), [side * 0.03, -0.24, 0], [0, 0, Math.PI / 2]);
      add(arm, g.cyl(0.21, 0.21, 0.07, 12), m(COLOR.black), [side * -0.06, -0.24, 0], [0, 0, Math.PI / 2]);
      add(arm, g.ball(0.045, 6), lit(COLOR.cyan), [side * 0.12, -0.24, 0]);
      o.add(arm);
      flap.push(beat(arm, 'z', 0, side * 0.3, 3));
    }
  },
  controller: ({ g, m, lit }, o, flap) => {
    add(o, g.box(0.86, 0.3, 0.44), m(COLOR.dark));
    for (const side of [-1, 1]) {
      add(o, g.cyl(0.12, 0.09, 0.42, 8), m(COLOR.dark), [side * 0.42, -0.14, 0.12], [0.35, 0, side * 0.4]);
      add(o, g.box(0.18, 0.07, 0.1), m(COLOR.grey), [side * 0.3, 0.13, -0.2]);   // shoulder
    }
    add(o, g.box(0.2, 0.05, 0.07), m(COLOR.grey), [-0.27, 0.17, 0.02]);          // d-pad
    add(o, g.box(0.07, 0.05, 0.2), m(COLOR.grey), [-0.27, 0.17, 0.02]);
    const face = [[0, -0.11, COLOR.green], [0.11, 0, COLOR.red], [0, 0.11, COLOR.blue], [-0.11, 0, COLOR.yellow]];
    for (const [dx, dz, col] of face) {
      add(o, g.ball(0.05, 8), lit(col), [0.29 + dx, 0.17, 0.02 + dz]);
    }
    add(o, g.box(0.1, 0.02, 0.05), lit(COLOR.white), [0, 0.16, -0.08]);          // centre light
    for (const x of [-0.1, 0.14]) {
      // Both sticks wobble, because a controller nobody is holding still would.
      const stick = new THREE.Group();
      stick.position.set(x, 0.15, 0.18);
      add(stick, g.cyl(0.09, 0.09, 0.05, 10), m(COLOR.black));
      add(stick, g.cyl(0.035, 0.035, 0.1, 8), m(COLOR.black), [0, 0.07, 0]);
      add(stick, g.ball(0.07, 8), m(COLOR.grey), [0, 0.13, 0]);
      o.add(stick);
      flap.push(beat(stick, 'x', 0, 0.35, 5));
    }
  },
  switch2: ({ g, m, lit, map }, o, flap) => {
    add(o, g.box(1.3, 0.74, 0.06), m(COLOR.black));                 // tablet
    add(o, g.plane(1.2, 0.66), map('screen', screenTex), [0, 0, 0.035]);
    add(o, g.box(1, 0.46, 0.02), m(COLOR.dark), [0, -0.1, -0.1], [0.35, 0, 0]);  // kickstand
    for (const side of [-1, 1]) {
      // The Joy-Cons stay attached at the rail and beat like a pair of wings.
      const joy = new THREE.Group();
      joy.position.set(side * 0.65, 0, 0);
      const x = side * 0.14;
      add(joy, g.box(0.28, 0.74, 0.11), m(COLOR.black), [x, 0, 0]);
      add(joy, g.box(0.05, 0.74, 0.13), lit(side < 0 ? 0x2ea3e0 : 0xff4554), [side * 0.015, 0, 0]);
      add(joy, g.box(0.26, 0.07, 0.09), m(COLOR.dark), [x, 0.4, -0.02]);         // shoulder
      add(joy, g.cyl(0.055, 0.055, 0.05, 8), m(COLOR.dark), [x, 0.17, 0.07], [Math.PI / 2, 0, 0]);
      add(joy, g.ball(0.05, 8), m(COLOR.grey), [x, 0.17, 0.09]);                 // stick
      for (const [dx, dy] of [[0, 0.06], [0, -0.06], [-0.06, 0], [0.06, 0]]) {
        add(joy, g.ball(0.032, 6), m(COLOR.grey), [x + dx, -0.16 + dy, 0.07]);
      }
      o.add(joy);
      flap.push(beat(joy, 'z', 0, side * 0.55, 5));
    }
  },
  winlogo: ({ g, m }, o) => {
    // Four panes of the flag, each its own tiny slab so the colours stay flat
    // even lit, with a hairline gap between them like the real mark.
    const panes = [
      [-0.27, 0.27, 0xf25022], [0.27, 0.27, 0x7fba00],
      [-0.27, -0.27, 0x00a4ef], [0.27, -0.27, 0xffb900],
    ];
    for (const [x, y, col] of panes) add(o, g.box(0.5, 0.5, 0.08), m(col), [x, y, 0]);
  },
  house: ({ g, m, lit }, o, _flap, _spin, i) => {
    const wall = m([0xe8dcc0, 0xd9b382, 0xc9d2da][i % 3]);
    const roof = m([0x8b3a2f, 0x4a4f57, 0x6b4a2c][i % 3]);
    add(o, g.box(1.1, 0.8, 1.0), wall, [0, -0.1, 0]);
    // A 4-sided cone makes a pyramid roof; rotated 45° so its flat faces sit
    // over the box's flat faces instead of over its corners.
    const cap = add(o, g.cone(0.86, 0.6, 4), roof, [0, 0.6, 0], [0, Math.PI / 4, 0]);
    cap.scale.z = 1.14;
    add(o, g.box(0.14, 0.34, 0.14), roof, [0.32, 0.86, 0]);                 // chimney
    add(o, g.box(0.26, 0.44, 0.03), m(COLOR.brown), [0, -0.28, 0.51]);      // door
    for (const x of [-0.32, 0.32]) add(o, g.box(0.2, 0.2, 0.03), lit(0xffe9a0), [x, 0, 0.51]);
  },
  gamelogo: ({ g, map }, o, _flap, spin) => {
    const disc = add(o, g.cyl(0.7, 0.7, 0.08, 24), map('gamelogo', gameLogoTex));
    disc.rotation.x = Math.PI / 2;
    spin.push(turn(disc, 'y', 1.1));
  },
  nyancat: ({ g, m, lit, map }, o, _flap, spin) => {
    // Pop-tart body, nose-to-tail along z so the rainbow trails behind it as
    // it rides the same +z wind as everything else.
    add(o, g.box(0.5, 0.5, 0.9), m(COLOR.tan));
    add(o, g.box(0.52, 0.22, 0.9), m(0xff8fc0), [0, 0.32, 0]);
    const sprinkle = [0xf25022, 0x7fba00, 0x00a4ef, 0xffb900];
    for (let i = 0; i < 5; i++) {
      add(o, g.box(0.05, 0.05, 0.05), lit(sprinkle[i % 4]), [rand(-0.18, 0.18), 0.42, -0.35 + i * 0.18]);
    }
    add(o, g.box(0.4, 0.4, 0.4), m(COLOR.grey), [0, 0.14, 0.65]);
    add(o, g.cone(0.09, 0.16, 4), m(COLOR.grey), [-0.13, 0.38, 0.55]);
    add(o, g.cone(0.09, 0.16, 4), m(COLOR.grey), [0.13, 0.38, 0.55]);
    add(o, g.plane(0.36, 0.36), map('nyanface', nyanFaceTex), [0, 0.14, 0.86]);
    // The rainbow, in the classic red-to-purple order, trailing off the back.
    const RAINBOW = [0xff0040, 0xff8a00, 0xffe600, 0x3fd12e, 0x2e8fff, 0x9b3fff];
    RAINBOW.forEach((col, i) => {
      add(o, g.box(0.42 - i * 0.02, 0.07, 1.5), lit(col), [0, 0.2 - i * 0.08, -1.15]);
    });
    // A couple of twinkling sparkles riding alongside.
    for (const [x, y] of [[0.35, 0.5], [-0.4, 0.1]]) {
      spin.push(turn(add(o, g.octa(0.06), lit(COLOR.white), [x, y, -0.2]), 'y', 6));
    }
  },
  anvil: ({ g, m }, o) => {
    add(o, g.box(0.8, 0.24, 0.4), m(COLOR.dark), [0, 0.22, 0]);
    add(o, g.box(0.4, 0.24, 0.3), m(COLOR.dark), [0, 0, 0]);
    add(o, g.box(0.62, 0.14, 0.42), m(COLOR.dark), [0, -0.2, 0]);
    add(o, g.cone(0.14, 0.34, 6), m(COLOR.dark), [0.52, 0.22, 0], [0, 0, -Math.PI / 2]);
  },
};

const TYPES = Object.keys(BUILDERS);

// Most props fly solo; a few earn a small fleet.
const COUNTS = { lambo: 3, tv: 3, sedan: 3, suv: 3, hatchback: 3, house: 3, cat: 9 };
const TOTAL = TYPES.reduce((n, t) => n + (COUNTS[t] ?? 1), 0);

/**
 * Builds one of every type, scatters them across the sky and flies them on the
 * wind. `update` handles drift, bob, tumble, beating parts and recycling.
 */
export function buildFlock(scene, { lane = [-70, 16], spread = 34 } = {}) {
  const kit = makeKit();
  const flyers = [];

  for (const type of TYPES) {
    for (let i = 0; i < (COUNTS[type] ?? 1); i++) {
      const group = new THREE.Group();
      const flap = [];
      const spin = [];
      BUILDERS[type](kit, group, flap, spin, i);
      group.scale.setScalar(rand(1.1, 2.6));
      group.position.set(rand(-spread, spread), rand(-15, 17), rand(lane[0], 6));
      group.userData = {
        type,
        flap,
        spin,
        drift: rand(2, 4.8),
        bob: rand(0.5, 1.5),
        phase: rand(0, TAU),
        tumble: new THREE.Vector3(rand(-0.6, 0.6), rand(-1.1, 1.1), rand(-0.5, 0.5)),
      };
      scene.add(group);
      flyers.push(group);
    }
  }

  const update = (dt, t) => {
    for (const o of flyers) {
      const d = o.userData;
      const b = t * 1.4 + d.phase;
      o.position.z += d.drift * dt;
      o.position.y += Math.sin(b * 0.6) * d.bob * dt;
      o.rotation.x += d.tumble.x * dt;
      o.rotation.y += d.tumble.y * dt;
      o.rotation.z += d.tumble.z * dt;

      for (const part of d.flap) {
        const f = part.userData.f;
        part.rotation[f.axis] = f.base + Math.sin(t * f.rate + d.phase) * f.amp;
      }
      for (const part of d.spin) {
        const s = part.userData.s;
        part.rotation[s.axis] += s.rate * dt;
      }

      if (o.position.z > lane[1]) {
        o.position.set(rand(-spread, spread), rand(-15, 17), lane[0]);
        d.drift = rand(2, 4.8);
        d.tumble.set(rand(-0.6, 0.6), rand(-1.1, 1.1), rand(-0.5, 0.5));
      }
    }
  };

  return { flyers, types: TYPES, update };
}

export { TYPES as FLYER_TYPES, COUNTS as FLYER_COUNTS, TOTAL as FLYER_TOTAL };
