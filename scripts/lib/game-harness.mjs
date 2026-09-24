/**
 * A tiny, scriptable harness for testing one game's rules: boot a game with a
 * controllable input, step it frame by frame, and poke at its state. (smoke.mjs
 * is the opposite — random input over every game.) No browser or GPU needed.
 */
import * as THREE from 'three';
import { seeded } from '../../src/engine/utils.js';

installDomShims();

export const DT = 1 / 60;

export async function boot(id, seed = 1) {
  Math.random = seeded(seed);
  const mod = await import(`../../src/games/${id}.js`);
  const scene = new THREE.Scene();
  const size = { w: 1280, h: 800 };
  const camera = new THREE.PerspectiveCamera(60, size.w / size.h, 0.1, 500);
  const input = makeInput();
  const hud = makeHud();
  const audio = new Proxy({ muted: true }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  const result = { ended: null };
  const ctx = {
    scene, camera, renderer: null, input, size, audio, hud,
    setCamera: () => {},
    end: (score, detail) => { result.ended ??= { score, detail }; },
  };
  const game = new mod.default(ctx);
  game.start();
  game.beginPlay?.();
  /** Runs `n` frames. */
  const step = (n = 1) => {
    for (let i = 0; i < n && !result.ended; i++) {
      game.time += DT;
      game.update(DT, game.time);
      input.endFrame();
    }
  };
  return { game, ctx, input, hud, result, step, THREE };
}

function makeInput() {
  const held = new Set();
  const pressed = new Set();
  const pointer = new THREE.Vector2();
  const api = {
    pointer, pixel: new THREE.Vector2(640, 400), delta: new THREE.Vector2(), gpPointer: new THREE.Vector2(),
    usingGamepadPointer: false, down: false, wheel: 0, locked: false, clicked: false,
    key: (...c) => c.some((k) => held.has(k)),
    hit: (...c) => c.some((k) => pressed.has(k)),
    let_go: () => false,
    axisX: () => (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0),
    axisY: () => (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0) - (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0),
    button: () => false, clickedButton: () => false,
    requestLock() {}, exitLock() {},
    gpAxis: () => 0, gpButton: () => false, gpHit: () => false,
    activePointer: () => pointer,
    pick: () => null,
    pickPlane: (c, p, target = new THREE.Vector3()) => target.set(pointer.x * 10, 0, pointer.y * 10),
    endFrame() { pressed.clear(); api.clicked = false; },
    // --- scripting ---
    hold(...k) { k.forEach((x) => held.add(x)); },
    release(...k) { (k.length ? k : [...held]).forEach((x) => held.delete(x)); },
    press(...k) { k.forEach((x) => { held.add(x); pressed.add(x); }); },
  };
  return api;
}

function makeHud() {
  const hud = {
    stats: new Map(), toasts: [], hints: [],
    stat(label, value) { hud.stats.set(label, value); },
    removeStat(label) { hud.stats.delete(label); },
    toast(t) { hud.toasts.push(t); },
    hint(t) { hud.hints.push(t); },
    coins() {}, mount() {}, clear() {}, panel() { return null; },
  };
  return hud;
}

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

let failed = 0;
export const check = (cond, msg, detail = '') => {
  if (!cond) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${msg} ${detail}`); } else console.log(`\x1b[32mok\x1b[0m   ${msg}`);
};
export const finish = (what) => {
  console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : `\n\x1b[32mAll ${what} checks passed.\x1b[0m`);
  process.exit(failed ? 1 : 0);
};
