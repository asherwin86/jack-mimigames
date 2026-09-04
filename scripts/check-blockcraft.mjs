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
  held: null,          // which mouse button the test is holding down
  key: () => false, hit: () => false, axisX: () => 0, axisY: () => 0,
  button(n) { return this.held === n; },
  clickedButton: () => false,
  requestLock() {}, exitLock() {}, pick: () => null,
};
const game = new Blockcraft({
  scene, camera: new THREE.PerspectiveCamera(), renderer: null, input,
  audio: new Proxy({}, { get: () => () => {} }),
  hud: { stat() {}, toast() {}, hint() {}, panel: () => null, stats: new Map() },
  size: { w: 1280, h: 800 }, setCamera() {}, end() {},
});

const checks = [];
/** Shallowest y at which a block id appears, for the ore-layering check. */
const deepest = (id) => {
  for (let y = 39; y >= 0; y--) {
    for (let z = 0; z < 96; z++) {
      for (let x = 0; x < 96; x++) if (game.voxels[(y * 96 + z) * 96 + x] === id) return y;
    }
  }
  return -1;
};
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
// Banded, not just non-zero: the height curve is fitted to each world's own
// spread so that every seed gets a coastline, and this is what proves it.
check('has a sea on every seed', counts[7] > 4000 && counts[7] < 40000, `${counts[7] || 0} water`);
check('has trees (logs + leaves)', counts[5] > 20 && counts[6] > 100,
  `${counts[5] || 0} logs, ${counts[6] || 0} leaves`);
check('has gold ore', (counts[12] || 0) > 0, `${counts[12] || 0} gold`);
check('has coal ore', (counts[15] || 0) > 200, `${counts[15] || 0} coal`);
check('has iron ore', (counts[16] || 0) > 100, `${counts[16] || 0} iron`);
check('ore is layered by depth', deepest(15) >= deepest(16) && deepest(16) >= deepest(12),
  `coal to y${deepest(15)}, iron to y${deepest(16)}, gold to y${deepest(12)}`);

// Caves: air with rock directly overhead, which open sky can never produce.
let roofed = 0;
for (let y = 2; y < 30; y++) {
  for (let z = 0; z < 96; z++) {
    for (let x = 0; x < 96; x++) {
      if (game.get(x, y, z) !== 0) continue;
      const above = game.get(x, y + 1, z);
      if (above === 3 || above === 2 || above === 12 || above === 15 || above === 16) roofed++;
    }
  }
}
check('the world has caves', roofed > 500, `${roofed} roofed air cells`);
check('caves do not breach the surface', roofed < 40000, `${roofed} roofed air cells`);

check('clouds overhead', game.clouds.children.length > 0, `${game.clouds.children.length} clouds`);
const cloudX = game.clouds.children[0].position.x;

// --- meshing ---
for (let i = 0; i < 40; i++) game.update(1 / 60);
check('all chunks meshed', game.chunks.size === 36, `${game.chunks.size}/36`);
let tris = 0;
for (const meshes of game.chunks.values()) {
  for (const m of meshes) tris += m.geometry.index.count / 3;
}
check('geometry generated', tris > 20000, `${tris.toLocaleString()} triangles`);
check('interior faces culled', tris < 400000, `${tris.toLocaleString()} triangles`);

check('clouds drift', game.clouds.children[0].position.x !== cloudX);

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

// --- hold to mine ---
game.pitch = -1.2;
input.locked = true;
input.held = 0;
const dig = game.raycast();
check('something to dig at', !!dig);
if (dig) {
  const at = { x: dig.x, y: dig.y, z: dig.z };
  const timeToBreak = (id) => {
    game.set(at.x, at.y, at.z, id);
    game.mineKey = null;
    input.held = 0;
    let f = 0;
    while (game.get(at.x, at.y, at.z) === id && f < 900) { game.update(1 / 60); f++; }
    return f / 60;
  };

  game.set(at.x, at.y, at.z, 3);
  game.mineKey = null;
  game.update(1 / 60);
  check('one frame of clicking does not break a block', game.get(at.x, at.y, at.z) === 3);
  check('digging shows progress', game.crack.visible && game.crack.material.opacity > 0,
    `opacity ${game.crack.material.opacity.toFixed(2)}`);

  input.held = null;
  game.update(1 / 60);
  check('letting go resets the dig', game.mineT === 0 && !game.crack.visible);

  const leaves = timeToBreak(6);
  const stone = timeToBreak(3);
  const obsidian = timeToBreak(14);
  check('holding breaks the block', stone > 0 && stone < 3, `stone took ${stone.toFixed(2)}s`);
  check('hardness is respected', obsidian > stone && stone > leaves,
    `leaves ${leaves.toFixed(2)}s < stone ${stone.toFixed(2)}s < obsidian ${obsidian.toFixed(2)}s`);
  check('breaking throws debris', game.debris.live.length > 0, `${game.debris.live.length} pieces`);
  input.held = null;
  input.locked = false;
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
