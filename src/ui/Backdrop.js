import * as THREE from 'three';
import { box, lights, glow, rand, Burst, TAU, COLORS } from '../engine/utils.js';
import { buildFlock } from './flyers.js';
import { Settings } from '../engine/Settings.js';

const GRAD_H = 256;
const STOPS = 12;

/** Paints a vertical rainbow, offset by `shift` degrees of hue. */
function paintRainbow(ctx, shift) {
  const grad = ctx.createLinearGradient(0, 0, 0, GRAD_H);
  for (let i = 0; i <= STOPS; i++) {
    const t = i / STOPS;
    const hue = (t * 360 + shift) % 360;
    // Held back from full saturation so the menu text stays readable on top.
    const light = 34 + Math.sin(t * Math.PI) * 16;
    grad.addColorStop(t, `hsl(${hue.toFixed(1)}, 64%, ${light.toFixed(1)}%)`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, GRAD_H);
}

/** 16x16 of mottled creeper green, drawn once and shared by every creeper. */
function skinTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Two-tone dither: the real skin is just noise between these greens.
      const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const v = 0.5 + Math.abs(n) * 0.5;
      g.fillStyle = `rgb(${(58 * v) | 0}, ${(150 * v) | 0}, ${(52 * v) | 0})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The face, one character per pixel of an 8x8 grid.
const FACE = [
  '........',
  '........',
  '.##..##.',
  '.##..##.',
  '...##...',
  '..####..',
  '..#..#..',
  '........',
];

/** The green skin with the black face burned into it, for the head's front. */
function faceTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 8;
  const g = cv.getContext('2d');
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const n = (Math.sin(x * 25.9 + y * 61.4) * 43758.5453) % 1;
      const v = 0.5 + Math.abs(n) * 0.5;
      g.fillStyle = FACE[y][x] === '#'
        ? '#0d1a12'
        : `rgb(${(58 * v) | 0}, ${(150 * v) | 0}, ${(52 * v) | 0})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A creeper in Minecraft's own proportions (head 8, body 8x12x4, legs 4x6x4),
 * measured in pixel units and scaled at the end. The legs are returned so the
 * update loop can flap them like wings.
 */
function makeCreeper(skin, face, scale) {
  const u = 0.075 * scale;
  const group = new THREE.Group();
  const legs = [];

  const skinMat = new THREE.MeshLambertMaterial({ map: skin });
  const faceMat = new THREE.MeshLambertMaterial({ map: face });
  // Box material order is +x, -x, +y, -y, +z, -z: only +z carries the face.
  const headMats = [skinMat, skinMat, skinMat, skinMat, faceMat, skinMat];

  const part = (w, h, d, mats) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * u, h * u, d * u), mats);
    m.castShadow = m.receiveShadow = false;
    return m;
  };

  const head = part(8, 8, 8, headMats);
  head.position.y = 22 * u;
  group.add(head);

  const body = part(8, 12, 4, skinMat);
  body.position.y = 12 * u;
  group.add(body);

  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    // Pivot at the hip, so the flap swings the foot and not the whole leg box.
    const hip = new THREE.Group();
    hip.position.set(dx * u, 6 * u, dz * u);
    const leg = part(4, 6, 4, skinMat);
    leg.position.y = -3 * u;
    hip.add(leg);
    group.add(hip);
    legs.push(hip);
  }

  // Sit the pivot at the creeper's middle so it banks about its own centre.
  group.children.forEach((c) => { c.position.y -= 13 * u; });
  // The materials are per-creeper so one can flash white without the rest.
  return { group, legs, mats: [skinMat, faceMat] };
}

const SKY_TOP = 26;    // where bombs are released
const SKY_FLOOR = -17; // and where they go off, just under the frame

const CLAUDE_ORANGE = 0xd97757;
const SPOKES = 11;

/**
 * The Claude mark: a burst of tapered spokes, alternating long and short, built
 * as flat shapes and extruded so it still reads as it tumbles edge-on.
 */
function claudeGeometry() {
  const shapes = [];
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Two points either side of the spoke's centre line, `w` from it.
    const edge = (r, w) => [
      [cos * r - sin * w, sin * r + cos * w],
      [cos * r + sin * w, sin * r - cos * w],
    ];
    const [inA, inB] = edge(0.05, 0.085);        // fat at the hub
    const [outA, outB] = edge(i % 2 ? 0.78 : 1, 0.03); // tapered at the tip
    const s = new THREE.Shape();
    s.moveTo(...inA);
    s.lineTo(...outA);
    s.lineTo(...outB);
    s.lineTo(...inB);
    s.closePath();
    shapes.push(s);
  }
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 0.11, bevelEnabled: false });
  geo.center();
  return geo;
}

/** A cannonball bomb: dark ball, stub of fuse, and a spark that flickers. */
function makeBomb(bodyMat, fuseMat, sparkMat, scale) {
  const group = new THREE.Group();
  const r = 0.55 * scale;

  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), bodyMat);
  group.add(body);

  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.12, r * 0.9, 6), fuseMat);
  fuse.position.set(r * 0.14, r * 1.2, 0);
  fuse.rotation.z = -0.35;
  group.add(fuse);

  const spark = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 6), sparkMat);
  spark.position.set(r * 0.44, r * 1.6, 0);
  group.add(spark);

  return { group, spark };
}

/** Creepers flying over slowly tumbling cubes and a cycling rainbow sky. */
export function buildBackdrop(size, audio) {
  const scene = new THREE.Scene();

  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = GRAD_H;
  const ctx = canvas.getContext('2d');
  paintRainbow(ctx, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
  scene.fog = new THREE.Fog(0x2a2340, 70, 240);

  lights(scene, { sky: 0xffffff, groundCol: 0x2a2340, intensity: 0.85 });

  const camera = new THREE.PerspectiveCamera(55, size.w / size.h, 0.1, 300);
  camera.position.set(0, 2, 26);

  // Every prop hangs off this group: one flag hides the lot and leaves the sky.
  const props = new THREE.Group();
  scene.add(props);

  const cubes = [];
  for (let i = 0; i < 46; i++) {
    const s = rand(0.8, 3.4);
    const c = box(s, s, s, glow(COLORS[i % COLORS.length], {
      emissiveIntensity: 0.32, transparent: true, opacity: 0.55,
    }), { cast: false, receive: false });
    c.position.set(rand(-38, 38), rand(-20, 20), rand(-70, 8));
    c.userData = {
      spin: new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4)),
      drift: rand(0.6, 2.4),
    };
    props.add(c);
    cubes.push(c);
  }

  const skin = skinTexture();
  const face = faceTexture();
  const creepers = [];
  for (let i = 0; i < 14; i++) {
    const { group, legs, mats } = makeCreeper(skin, face, rand(1.6, 4.2));
    group.position.set(rand(-34, 34), rand(-14, 16), rand(-70, 6));
    group.userData = {
      legs,
      mats,
      drift: rand(2.2, 5.4),
      bob: rand(0.5, 1.3),
      phase: rand(0, Math.PI * 2),
      yaw: rand(-0.5, 0.5),
      fuse: 0,     // >0 while primed and swelling, counts down to the bang
      respawn: 0,  // >0 while blown up and waiting off-screen
    };
    props.add(group);
    creepers.push(group);
  }

  /** Sends one creeper back to the far edge for another pass. */
  const recycle = (c) => {
    c.position.set(rand(-34, 34), rand(-14, 16), -70);
    c.userData.drift = rand(2.2, 5.4);
    c.userData.yaw = rand(-0.5, 0.5);
  };

  const shards = new Burst(props, 200, 0.34);

  // One material set for the whole flight of bombs; the spark flickers by
  // scaling the mesh, so nothing here needs to be per-bomb.
  const bombMats = [
    new THREE.MeshLambertMaterial({ color: 0x14151b }),
    new THREE.MeshLambertMaterial({ color: 0x6b5636 }),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }),
  ];
  const bombs = [];
  for (let i = 0; i < 8; i++) {
    const { group, spark } = makeBomb(...bombMats, rand(0.9, 2.1));
    group.userData = { spark, vy: 0, drift: 0, spin: 0, wait: 0 };
    props.add(group);
    bombs.push(group);
  }

  /** Drops one bomb from the top of frame, after an optional delay. */
  const drop = (b, wait = 0) => {
    b.position.set(rand(-32, 32), SKY_TOP, rand(-56, 4));
    b.rotation.set(rand(0, 6.2), rand(0, 6.2), 0);
    b.userData.vy = rand(-1.5, 0);
    b.userData.drift = rand(0.8, 2.6);
    b.userData.spin = rand(-1.6, 1.6);
    b.userData.wait = wait;
    b.visible = wait <= 0;
  };
  bombs.forEach((b, i) => drop(b, i * rand(0.4, 1.6)));

  // Pointer tracking is on the window, so it still reads through the menu
  // overlay that sits on top of the canvas.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointing = false;
  const onMove = (e) => {
    pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    pointing = true;
  };
  // Also stops a held jingle: if the pointer leaves the window mid-drag, the
  // matching pointerup can land outside it and never reach this listener.
  const onLeave = () => { pointing = false; meowLooping = false; };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave);
  // Press and hold Nyan Cat and its little jingle loops for as long as you
  // hold — synthesized, not a recording, the same way every other sound in
  // this game is. Length of Audio.meow()'s own note sequence, plus a hair of
  // breathing room so repeats don't overlap.
  const JINGLE_LEN = 0.7;
  let ambientT = 0;   // fires immediately on the first frame, then every JINGLE_LEN
  let meowLooping = false;
  let meowT = 0;
  const onDown = (e) => {
    if (!audio) return;
    const nyan = flock.flyers.find((o) => o.userData.type === 'nyancat');
    if (!nyan) return;
    pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    nyan.updateMatrixWorld();
    if (raycaster.intersectObject(nyan, true).length) {
      audio.meow();
      meowLooping = true;
      meowT = JINGLE_LEN;
    }
  };
  const onUp = () => { meowLooping = false; };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  const dispose = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
  };

  /** Arms whichever creeper is under the pointer. Already-lit ones stay lit. */
  const checkHover = () => {
    if (!pointing) return;
    const live = creepers.filter((c) => c.userData.fuse === 0 && c.userData.respawn === 0);
    if (!live.length) return;
    // Raycasting reads world matrices, and the renderer has not refreshed them
    // for this frame's movement yet, so bring the few we care about up to date.
    camera.updateMatrixWorld();
    for (const c of live) c.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(live, true)[0];
    if (!hit) return;
    let o = hit.object;
    while (o && !live.includes(o)) o = o.parent;
    if (o) o.userData.fuse = 0.4;
  };

  /** The bang: shards outward, creeper gone until its respawn timer runs out. */
  const detonate = (c) => {
    const d = c.userData;
    shards.burst(c.position, 0x54a34a, 16, 11);
    shards.burst(c.position, 0x2c3f2a, 8, 8);
    shards.burst(c.position, 0xffd8a0, 6, 14);
    c.visible = false;
    d.fuse = 0;
    d.respawn = rand(1.4, 3.2);
    for (const m of d.mats) m.color.setHex(0xffffff);
    c.scale.setScalar(1);
  };

  // Claude marks drift down like leaves rather than dropping like the bombs,
  // so they read as falling colour instead of another hazard.
  const markGeo = claudeGeometry();
  const markMat = glow(CLAUDE_ORANGE, { emissiveIntensity: 0.5, roughness: 0.5 });
  const marks = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(markGeo, markMat);
    m.userData = { fall: 0, drift: 0, sway: 0, spin: new THREE.Vector3(), wait: 0 };
    props.add(m);
    marks.push(m);
  }

  /** Releases one Claude mark above the top of frame, after an optional delay. */
  const dropMark = (m, wait = 0) => {
    m.position.set(rand(-30, 30), SKY_TOP + rand(0, 10), rand(-48, 4));
    m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    m.scale.setScalar(rand(1.1, 2.8));
    m.userData.fall = rand(2.4, 4.8);
    m.userData.drift = rand(0.6, 2.2);
    m.userData.sway = rand(0, TAU);
    m.userData.spin.set(rand(-0.7, 0.7), rand(-0.9, 0.9), rand(-0.5, 0.5));
    m.userData.wait = wait;
    m.visible = wait <= 0;
  };
  marks.forEach((m, i) => dropMark(m, i * rand(0.5, 2.4)));

  // One of everything, flying the same lane as the creepers.
  const flock = buildFlock(props);

  /** A bomb going off: fire, smoke, and a shockwave that lights nearby fuses. */
  const blast = (pos) => {
    shards.burst(pos, 0xffe08a, 14, 16);
    shards.burst(pos, 0xff7a2f, 12, 12);
    shards.burst(pos, 0x2b2b33, 8, 7);
    for (const c of creepers) {
      const d = c.userData;
      if (d.fuse > 0 || d.respawn > 0) continue;
      if (c.position.distanceTo(pos) < 9) d.fuse = 0.25;
    }
  };

  /** The slow lateral sway; runs whether or not the props are showing. */
  const aimCamera = () => {
    camera.position.x = Math.sin(t * 0.12) * 3;
    camera.lookAt(0, 0, -20);
  };

  let t = 0;
  let shift = 0;
  let repaint = 0;

  const update = (dt) => {
    t += dt;

    // Cycle the hue. The gradient canvas is 2x256, so redrawing is cheap, but
    // there is no point doing it more often than the eye can tell.
    shift = (shift + dt * 16) % 360;
    repaint -= dt;
    if (repaint <= 0) {
      repaint = 1 / 24;
      paintRainbow(ctx, shift);
      tex.needsUpdate = true;
      scene.fog.color.setHSL(((shift + 180) % 360) / 360, 0.35, 0.16);
    }

    // Nyan Cat's jingle loops softly as ambient menu music, independent of
    // the props toggle — it's music, not one of the visible things in the sky.
    if (audio) {
      ambientT -= dt;
      if (ambientT <= 0) { audio.meow(0.45); ambientT = JINGLE_LEN; }
    }

    // With the props hidden there is nothing left to animate but the sky.
    if (!props.visible) { aimCamera(); return; }

    for (const c of cubes) {
      const d = c.userData;
      c.rotation.x += d.spin.x * dt;
      c.rotation.y += d.spin.y * dt;
      c.position.y += Math.sin(t * 0.4 + c.position.x) * dt * 0.3;
      c.position.z += d.drift * dt;
      if (c.position.z > 14) { c.position.z = -70; c.position.x = rand(-38, 38); }
    }

    checkHover();
    shards.update(dt);

    flock.update(dt, t);
    if (meowLooping) {
      meowT -= dt;
      if (meowT <= 0) { audio.meow(); meowT = JINGLE_LEN; }
    }

    for (const m of marks) {
      const d = m.userData;
      if (d.wait > 0) {
        d.wait -= dt;
        if (d.wait <= 0) m.visible = true;
        continue;
      }
      m.position.y -= d.fall * dt;
      m.position.x += Math.sin(t * 0.8 + d.sway) * dt * 1.4;
      m.position.z += d.drift * dt;
      m.rotation.x += d.spin.x * dt;
      m.rotation.y += d.spin.y * dt;
      m.rotation.z += d.spin.z * dt;
      if (m.position.y < SKY_FLOOR - 5) dropMark(m, rand(0.3, 2.4));
    }

    for (const b of bombs) {
      const d = b.userData;
      if (d.wait > 0) {
        d.wait -= dt;
        if (d.wait <= 0) b.visible = true;
        continue;
      }
      d.vy -= 8 * dt;
      b.position.y += d.vy * dt;
      b.position.z += d.drift * dt;   // same wind that carries everything else
      b.rotation.z += d.spin * dt;
      b.rotation.x += d.spin * 0.6 * dt;
      // The spark gutters as the fuse burns down.
      d.spark.scale.setScalar(0.7 + Math.abs(Math.sin(t * 22 + b.position.x)) * 0.9);

      const struck = creepers.some((c) =>
        c.userData.respawn === 0 && c.position.distanceTo(b.position) < 2.2);
      if (struck || b.position.y <= SKY_FLOOR) {
        blast(b.position);
        drop(b, rand(0.5, 2.6));
      }
    }

    for (const c of creepers) {
      const d = c.userData;

      if (d.respawn > 0) {
        d.respawn -= dt;
        if (d.respawn <= 0) { d.respawn = 0; recycle(c); c.visible = true; }
        continue;
      }

      if (d.fuse > 0) {
        // Swell and flash white, the way a creeper does before it goes off.
        d.fuse -= dt;
        const k = 1 - d.fuse / 0.4;
        c.scale.setScalar(1 + k * 0.45);
        const flash = Math.sin(k * Math.PI * 5) > 0 ? 0xffffff : 0x8f8f8f;
        for (const m of d.mats) m.color.setHex(flash);
        if (d.fuse <= 0) { detonate(c); continue; }
      }

      const beat = t * 5 + d.phase;
      c.position.z += d.drift * dt;
      c.position.y += Math.sin(beat * 0.35) * d.bob * dt;
      // Face roughly forwards, with a lazy bank in the direction of the drift.
      c.rotation.set(Math.sin(beat * 0.3) * 0.14, Math.PI + d.yaw, Math.sin(beat * 0.22) * 0.2);
      const flap = Math.sin(beat) * 0.9;
      d.legs[0].rotation.x = flap;
      d.legs[1].rotation.x = flap;
      d.legs[2].rotation.x = -flap;
      d.legs[3].rotation.x = -flap;
      if (c.position.z > 16) recycle(c);
    }

    aimCamera();
  };

  /** Shows or hides every prop in the sky. Persisted by the menu toggle. */
  const setProps = (on) => { props.visible = !!on; };
  setProps(Settings.get('bgProps', true));

  return { scene, camera, update, dispose, setProps };
}
