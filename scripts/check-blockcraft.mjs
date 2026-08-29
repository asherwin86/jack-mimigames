/** Targeted checks for the voxel world: generation, meshing, physics, editing. */
import * as THREE from 'three';

globalThis.document ??= {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect() {}, clearRect() {}, set fillStyle(_) {}, get fillStyle() { return '#000'; },
    }),
  }),
};
globalThis.addEventListener ??= () => {};

const { default: Blockcraft } = await import('../src/games/blockcraft.js');

const scene = new THREE.Scene();
const input = {
  pointer: new THREE.Vector2(), delta: new THREE.Vector2(), down: false, clicked: false,
  wheel: 0, locked: false, keys: new Set(),
  key: () => false, hit: () => false, axisX: () => 0, axisY: () => 0,
  button: () => false, clickedButton: () => false,
  requestLock() {}, exitLock() {}, pick: () => null,
};
const game = new Blockcraft({
  scene, camera: new THREE.PerspectiveCamera(), renderer: null, input,
  audio: new Proxy({}, { get: () => () => {} }),
  hud: { stat() {}, toast() {}, hint() {}, panel: () => null, stats: new Map() },
  size: { w: 1280, h: 800 }, setCamera() {}, end() {},
});

const checks = [];
const check = (name, cond, detail = '') => checks.push({ name, ok: !!cond, detail });

game.start();

// --- terrain ---
const counts = {};
for (const v of game.voxels) counts[v] = (counts[v] || 0) + 1;
const total = game.voxels.length;
check('world allocated', total === 96 * 40 * 96, `${total} voxels`);
check('terrain is not empty', (counts[0] || 0) < total * 0.95,
  `${(100 - (counts[0] / total) * 100).toFixed(1)}% filled`);
check('has grass', counts[1] > 1000, `${counts[1] || 0} grass`);
check('has stone', counts[3] > 10000, `${counts[3] || 0} stone`);
check('has water', counts[7] > 500, `${counts[7] || 0} water`);
check('has trees (logs + leaves)', counts[5] > 20 && counts[6] > 100,
  `${counts[5] || 0} logs, ${counts[6] || 0} leaves`);
check('has ore', (counts[12] || 0) > 0, `${counts[12] || 0} gold ore`);

// --- meshing ---
for (let i = 0; i < 40; i++) game.update(1 / 60);
check('all chunks meshed', game.chunks.size === 36, `${game.chunks.size}/36`);
let tris = 0;
for (const meshes of game.chunks.values()) {
  for (const m of meshes) tris += m.geometry.index.count / 3;
}
check('geometry generated', tris > 20000, `${tris.toLocaleString()} triangles`);
check('interior faces culled', tris < 400000, `${tris.toLocaleString()} triangles`);

// --- physics ---
const spawnY = game.pos.y;
for (let i = 0; i < 120; i++) game.update(1 / 60);
check('player settles on the ground', game.grounded, `y ${spawnY.toFixed(1)} -> ${game.pos.y.toFixed(1)}`);
check('player did not fall through', game.pos.y > 0, `y = ${game.pos.y.toFixed(1)}`);
const below = game.get(game.pos.x, game.pos.y - 0.5, game.pos.z);
check('solid block underfoot', below !== 0, `block id ${below}`);

// --- targeting / editing ---
game.pitch = -1.2;                       // look down at our own feet
const hit = game.raycast();
check('raycast finds a block', !!hit, hit ? `id ${hit.id} at ${hit.x},${hit.y},${hit.z}` : 'no hit');

if (hit) {
  const before = game.get(hit.x, hit.y, hit.z);
  game.set(hit.x, hit.y, hit.z, 0);
  check('mining clears the voxel', game.get(hit.x, hit.y, hit.z) === 0, `was ${before}`);
  game.set(hit.x, hit.y, hit.z, 9);
  check('placing sets the voxel', game.get(hit.x, hit.y, hit.z) === 9);
}

// Hollowing out buried stone must expose the cavity walls. Counting faces on a
// single surface block is unreliable — removing a corner block can lose exactly
// as many faces as it exposes — so dig a fully enclosed pocket instead.
let buried = null;
for (let y = 6; y < 14 && !buried; y++) {
  for (let z = 34; z < 44 && !buried; z++) {
    for (let x = 50; x < 60 && !buried; x++) {
      const enclosed = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
        .every(([dx, dy, dz]) => game.get(x + dx, y + dy, z + dz) !== 0);
      if (game.get(x, y, z) !== 0 && enclosed) buried = { x, y, z };
    }
  }
}
check('found buried stone to mine', !!buried, buried ? `${buried.x},${buried.y},${buried.z}` : '');

if (buried) {
  const key = `${Math.floor(buried.x / 16)},${Math.floor(buried.z / 16)}`;
  const count = () => game.chunks.get(key).reduce((n, m) => n + m.geometry.index.count, 0);
  const meshesBefore = game.chunks.get(key);
  const facesBefore = count();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) game.set(buried.x + dx, buried.y + dy, buried.z + dz, 0);
    }
  }
  check('edit marks the chunk dirty', game.queue.includes(key), key);
  for (let i = 0; i < 10; i++) game.update(1 / 60);
  check('chunk mesh is rebuilt', game.chunks.get(key) !== meshesBefore);
  check('cavity walls become visible', count() > facesBefore,
    `${facesBefore} -> ${count()} indices`);
}

// --- can't place a block inside yourself ---
check('placement is blocked inside the player',
  game.intersectsPlayer(Math.floor(game.pos.x), Math.floor(game.pos.y), Math.floor(game.pos.z)));

let bad = 0;
for (const key of ['x', 'y', 'z']) if (!Number.isFinite(game.pos[key])) bad++;
check('player position is finite', bad === 0);

for (const c of checks) {
  console.log(`${c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${c.name.padEnd(36)} ${c.detail}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n\x1b[31m${failed} check(s) failed\x1b[0m` : '\n\x1b[32mAll checks passed\x1b[0m');
process.exit(failed ? 1 : 0);
