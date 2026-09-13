/**
 * Headless logic smoke test.
 *
 * Boots every catalogued game with stubbed input/audio/HUD and runs it for a
 * simulated stretch of play, driving random-but-legal input. Catches thrown
 * errors, NaN leaking into transforms, and games that never end. No browser or
 * GPU required — rendering itself is plain three.js and is not exercised here.
 *
 *   node scripts/smoke.mjs [seconds]
 */
import * as THREE from 'three';
import { CATALOG } from '../src/games/catalog.js';

installDomShims();

const SECONDS = Number(process.argv[2] || 20);
const DT = 1 / 60;
const FRAMES = Math.round(SECONDS / DT);

let failures = 0;

for (const entry of CATALOG) {
  const result = await run(entry);
  const tag = result.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${entry.id.padEnd(18)} ${result.note}`);
  if (!result.ok) {
    failures++;
    if (result.error) console.log(`      ${result.error.stack?.split('\n').slice(0, 3).join('\n      ')}`);
  }
}

console.log(failures
  ? `\n\x1b[31m${failures} of ${CATALOG.length} games failed.\x1b[0m`
  : `\n\x1b[32mAll ${CATALOG.length} games ran clean for ${SECONDS}s each.\x1b[0m`);
process.exit(failures ? 1 : 0);

async function run(entry) {
  let mod;
  try {
    mod = await import(`../src/games/${entry.id}.js`);
  } catch (error) {
    return { ok: false, note: 'module failed to load', error };
  }

  const scene = new THREE.Scene();
  const size = { w: 1280, h: 800 };
  let camera = new THREE.PerspectiveCamera(60, size.w / size.h, 0.1, 500);
  let ended = null;

  const input = makeInput(scene);
  const ctx = {
    scene, camera, renderer: null, input, size,
    audio: makeAudio(), hud: makeHud(),
    setCamera: (c) => { camera = c; },
    end: (score, detail) => { ended ??= { score, detail }; },
  };

  const game = new mod.default(ctx);
  let frame = 0;
  try {
    game.start();
    for (; frame < FRAMES && !ended; frame++) {
      input.step(game, camera);
      game.time += DT;
      game.update(DT, game.time);
      input.endFrame();
    }
    game.dispose();
  } catch (error) {
    return { ok: false, note: `threw on frame ${frame}`, error };
  }

  const bad = findNaN(game.scene);
  if (bad) return { ok: false, note: `NaN transform on "${bad}" at frame ${frame}` };

  if (ended && !Number.isFinite(ended.score)) {
    return { ok: false, note: `ended with a non-finite score (${ended.score})` };
  }

  const secs = (frame * DT).toFixed(1);
  return {
    ok: true,
    note: ended
      ? `ended after ${secs}s with ${ended.score} ${entry.unit || 'pts'}`
      : `survived ${secs}s, still running`,
  };
}

/* ---------------------------------------------------------------- stubs */

function makeInput(scene) {
  const KEYS = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'ShiftLeft', 'KeyF',
    'Digit1', 'Digit4', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const held = new Set();
  const pressed = new Set();
  const buttons = new Set();
  const clickedButtons = new Set();
  let clicked = false;
  let t = 0;

  const api = {
    pointer: new THREE.Vector2(),
    pixel: new THREE.Vector2(640, 400),
    delta: new THREE.Vector2(),
    down: false,
    wheel: 0,
    locked: false,
    get clicked() { return clicked; },
    key: (...c) => c.some((k) => held.has(k)),
    hit: (...c) => c.some((k) => pressed.has(k)),
    let_go: () => false,
    axisX: () => (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0),
    axisY: () => (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0),
    button: (n) => buttons.has(n),
    clickedButton: (n) => clickedButtons.has(n),
    requestLock() { api.locked = true; },
    exitLock() { api.locked = false; },
    gpAxis: () => 0, gpButton: () => false, gpHit: () => false,

    // Pretend the pointer sometimes lands on something clickable, so click
    // handlers (whack-a-cube, simon-cubes) actually get exercised.
    pick(camera, objects) {
      const list = (Array.isArray(objects) ? objects : [objects]).filter(Boolean);
      if (!list.length || Math.random() < 0.3) return null;
      const object = list[(Math.random() * list.length) | 0];
      return { object, point: object.position.clone(), distance: 10, face: null };
    },
    pickPlane(camera, plane, target = new THREE.Vector3()) {
      return target.set(api.pointer.x * 10, 0, api.pointer.y * 10);
    },

    step() {
      t += DT;
      pressed.clear();
      // Sweep the pointer around and churn the keyboard.
      api.pointer.set(Math.sin(t * 1.7) * 0.8, Math.cos(t * 1.1) * 0.7);
      api.delta.set(Math.cos(t * 1.7) * 6, -Math.sin(t * 1.1) * 6);
      if (Math.random() < 0.06) {
        const k = KEYS[(Math.random() * KEYS.length) | 0];
        if (held.has(k)) held.delete(k);
        else { held.add(k); pressed.add(k); }
      }
      clicked = Math.random() < 0.05;
      api.down = clicked || Math.random() < 0.2;

      // Mouse buttons and pointer lock, for first-person games.
      clickedButtons.clear();
      for (const b of [0, 2]) {
        if (Math.random() < 0.05) {
          if (buttons.has(b)) buttons.delete(b);
          else { buttons.add(b); clickedButtons.add(b); }
        }
      }
      if (clicked) api.locked = true;
      api.wheel = Math.random() < 0.03 ? (Math.random() < 0.5 ? -100 : 100) : 0;
    },
    endFrame() { clicked = false; clickedButtons.clear(); api.wheel = 0; },
  };
  return api;
}

function makeAudio() {
  return {
    tone() {}, noise() {}, blip() {}, pickup() {}, good() {}, bad() {},
    thud() {}, boom() {}, win() {}, lose() {}, meow() {}, ambientChime() {}, setMuted() {}, muted: true,
  };
}

function makeHud() {
  return {
    stat() {}, toast() {}, hint() {}, mount() {}, clear() {},
    panel() { return null; }, stats: new Map(),
  };
}

function findNaN(root) {
  let bad = null;
  root?.traverse?.((o) => {
    if (bad) return;
    const { x, y, z } = o.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      bad = o.name || o.type;
    }
  });
  return bad;
}

/** Just enough DOM for `sky()` to build its gradient CanvasTexture. */
function installDomShims() {
  if (globalThis.document) return;
  const ctx2d = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, clearRect() {}, drawImage() {},
    set fillStyle(_) {}, get fillStyle() { return '#000'; },
  };
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }),
    createElementNS: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.self = globalThis;
}
