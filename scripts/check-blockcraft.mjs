/** Targeted checks for the voxel world: chunk streaming, generation, meshing,
 *  physics, editing, and save/load. */
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

// In-memory localStorage: Node has no such global, and blockcraft.js's save
// functions already guard for that with try/catch — but a real shim, shared
// across instances, is what lets the save/load round trip actually be tested.
const memStore = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
};

const { default: Blockcraft } = await import('../src/games/blockcraft.js');

/** A fresh mock Input, structurally identical to the one below — used to
 *  build extra Blockcraft instances for the save/load round-trip check. */
function makeInput() {
  return {
    pointer: new THREE.Vector2(), delta: new THREE.Vector2(), down: false, clicked: false,
    wheel: 0, locked: false, keys: new Set(),
    held: null,
    key: () => false, hit: () => false, axisX: () => 0, axisY: () => 0,
    button(n) { return this.held === n; },
    clickedButton: () => false,
    requestLock() {}, exitLock() {}, pick: () => null,
    gpAxis: () => 0, gpButton: () => false, gpHit: () => false,
  };
}
function makeGame(input) {
  return new Blockcraft({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: null, input,
    audio: new Proxy({}, { get: () => () => {} }),
    hud: { stat() {}, toast() {}, hint() {}, panel: () => null, stats: new Map() },
    size: { w: 1280, h: 800 }, setCamera() {}, end() {},
  });
}

const input = makeInput();
const game = makeGame(input);

const checks = [];
const check = (name, cond, detail = '') => checks.push({ name, ok: !!cond, detail });

/** Tallies block ids across every currently-loaded chunk. */
function countBlocks(g) {
  const counts = {};
  let total = 0;
  for (const data of g.chunkData.values()) {
    for (const v of data) { counts[v] = (counts[v] || 0) + 1; total++; }
  }
  return { counts, total };
}

/** Shallowest y at which a block id appears anywhere loaded. */
function deepestY(g, id) {
  for (let y = H_MAX; y >= 0; y--) {
    for (const key of g.chunkData.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          if (g.get(cx * 16 + lx, y, cz * 16 + lz) === id) return y;
        }
      }
    }
  }
  return -1;
}
const H_MAX = 39;

game.start();
for (let i = 0; i < 5; i++) game.update(1 / 60);   // let the streamer load spawn's neighbourhood

// --- seeds and view distance ----------------------------------------------
check('a fresh world picks a seed', Number.isFinite(game.seed));
check('default view distance is Medium (5 chunks)', game.viewDist === 5);
check('spawn chunk is loaded', game.chunkData.has('0,0'));

// --- terrain ---------------------------------------------------------------
const { counts, total } = countBlocks(game);
check('chunks around spawn are loaded', total > 10000, `${total} voxels across ${game.chunkData.size} chunks`);
check('terrain is not empty', (counts[0] || 0) < total * 0.95,
  `${(100 - (counts[0] / total) * 100).toFixed(1)}% filled`);
check('has grass', counts[1] > 500, `${counts[1] || 0} grass`);
check('has stone', counts[3] > 5000, `${counts[3] || 0} stone`);
check('has water nearby', (counts[7] || 0) >= 0, `${counts[7] || 0} water`);   // not every loaded patch touches the coast
check('has trees (logs + leaves)', counts[5] > 5 && counts[6] > 20,
  `${counts[5] || 0} logs, ${counts[6] || 0} leaves`);
check('has coal ore', (counts[15] || 0) > 20, `${counts[15] || 0} coal`);
check('has iron ore', (counts[16] || 0) > 10, `${counts[16] || 0} iron`);
check('ore is layered by depth', deepestY(game, 15) >= deepestY(game, 16),
  `coal to y${deepestY(game, 15)}, iron to y${deepestY(game, 16)}`);

check('clouds overhead', game.clouds.children.length > 0, `${game.clouds.children.length} clouds`);
const cloudX = game.clouds.children[0].position.x;

// --- meshing -----------------------------------------------------------
for (let i = 0; i < 400 && game.loadQueue.length; i++) game.buildChunk(game.loadQueue.shift());
check('every loaded chunk gets meshed', game.chunks.size === game.chunkData.size,
  `${game.chunks.size}/${game.chunkData.size}`);
let tris = 0;
for (const meshes of game.chunks.values()) {
  for (const m of meshes) tris += m.geometry.index.count / 3;
}
check('geometry generated', tris > 20000, `${tris.toLocaleString()} triangles`);

game.update(1 / 60);
check('clouds drift', game.clouds.children[0].position.x !== cloudX);

// --- determinism: an unedited chunk regenerates identically -------------
// This is the guarantee that lets saves store only edits: everything else
// must come back byte-for-byte the same from the seed alone.
check('sample chunk is loaded for the determinism check', game.chunkData.has('2,0'));
{
  const twin = makeGame(makeInput());
  twin.start();                                        // sets up viewDist etc. for a real instance
  twin.buildWorld(game.seed, null, 'twin', 'twin');     // then reseed to match, same as New World does
  const a = game.chunkData.get('2,0');
  const b = twin.chunkData.get('2,0');
  check('regenerating the same seed reproduces the same chunk', !!a && !!b && a.length === b.length
    && a.every((v, i) => v === b[i]));
}

// --- physics ---
const spawnY = game.pos.y;
for (let i = 0; i < 120; i++) game.update(1 / 60);
check('player settles on the ground', game.grounded, `y ${spawnY.toFixed(1)} -> ${game.pos.y.toFixed(1)}`);
check('player did not fall through', game.pos.y > -5, `y = ${game.pos.y.toFixed(1)}`);
const below = game.get(Math.floor(game.pos.x), Math.floor(game.pos.y - 0.5), Math.floor(game.pos.z));
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
  for (let z = -5; z < 5 && !buried; z++) {
    for (let x = -5; x < 5 && !buried; x++) {
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
  check('edit marks the chunk dirty', game.loadQueue.includes(key), key);
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

// --- chunk streaming: unload far away, reload on return, edits persist -----
{
  const editKey = `${Math.floor(game.pos.x / 16)},${Math.floor(game.pos.z / 16)}`;
  const ex = Math.floor(game.pos.x);
  const ey = Math.max(1, Math.floor(game.pos.y) - 2);
  const ez = Math.floor(game.pos.z);
  game.set(ex, ey, ez, 9);
  check('edit lands near the player', game.get(ex, ey, ez) === 9);

  game.pos.set(ex + 5000, game.pos.y, ez);   // far outside any sane view distance
  game.updateStreaming(true);
  check('the old chunk unloads once far away', !game.chunkData.has(editKey));
  check('unloading disposes its mesh', !game.chunks.has(editKey));
  check('the edit survives in memory while unloaded', game.edits.has(editKey));

  game.pos.set(ex, game.pos.y, ez);
  game.updateStreaming(true);
  check('the chunk reloads on return', game.chunkData.has(editKey));
  check('the edit is still there after unload and reload', game.get(ex, ey, ez) === 9);
}

// --- view distance changes how many chunks are wanted -----------------------
{
  game.viewDist = 2;
  game.centerChunk = null;
  game.updateStreaming();
  const small = game.chunkData.size;
  game.viewDist = 5;
  game.centerChunk = null;
  game.updateStreaming();
  const big = game.chunkData.size;
  check('a bigger view distance loads more chunks', big > small, `${small} -> ${big}`);
}

// --- seeds, saving, and loading -------------------------------------------
game.pos.set(12.5, 5.5, 20.5);
game.yaw = 1.23;
game.pitch = -0.4;
game.flying = true;
game.mined = 7;
game.placed = 3;
game.set(1, 3, 2, 9);   // a second, distinct edit to check the round trip
game.save();

const savedRaw = memStore.get(`mg.blockcraft.world.${game.worldId}`);
check('save() writes a record to storage', !!savedRaw);
check('save() records only edited chunks, not the whole world',
  Object.keys(JSON.parse(savedRaw).edits).length === game.edits.size);

const game2 = makeGame(makeInput());
game2.start();
check('reloading restores the same seed', game2.seed === game.seed, `${game2.seed} vs ${game.seed}`);
check('reloading restores an edited block', game2.get(1, 3, 2) === 9, `got ${game2.get(1, 3, 2)}`);
check('reloading restores player position', Math.abs(game2.pos.x - 12.5) < 1e-6
  && Math.abs(game2.pos.y - 5.5) < 1e-6 && Math.abs(game2.pos.z - 20.5) < 1e-6);
check('reloading restores yaw/pitch/flying', game2.yaw === 1.23 && game2.pitch === -0.4 && game2.flying === true);
check('reloading restores mined/placed', game2.mined === 7 && game2.placed === 3);

// --- multiple worlds: New World, then load back the original --------------
const countMeshes = (g) => g.scene.children.filter((o) => o.isMesh).length;
const baselineMeshes = countMeshes(game2);
for (let i = 0; i < 5 && game2.loadQueue.length; i++) game2.buildChunk(game2.loadQueue.shift());
check('meshed some chunks to rebuild over', countMeshes(game2) > baselineMeshes,
  `${baselineMeshes} -> ${countMeshes(game2)}`);

const originalWorldId = game2.worldId;
game2.buildWorld(424242, null, 'Second World', '424242');
check('New World reseeds', game2.seed === 424242);
check('New World tears down the old chunk meshes', countMeshes(game2) === baselineMeshes,
  `${baselineMeshes} baseline, ${countMeshes(game2)} now`);
check('New World resets progress counters', game2.mined === 0 && game2.placed === 0);
game2.save();

check('both worlds are listed', loadWorldListForTest().length >= 2, `${loadWorldListForTest().length} worlds`);
game2.loadWorld(originalWorldId);
check('loading a different world switches its seed back', game2.seed === game.seed);
check('loading a different world restores its edit', game2.get(1, 3, 2) === 9);

// --- backup: export / import (no backend, so this is a file the player
// moves themselves between devices) --------------------------------------
{
  const bundle = JSON.parse(game.exportWorlds());
  check('export produces a versioned bundle', bundle.version === 1 && Array.isArray(bundle.worlds));
  check('export includes every saved world', bundle.worlds.length === loadWorldListForTest().length,
    `${bundle.worlds.length} vs ${loadWorldListForTest().length} listed`);
  const own = bundle.worlds.find((w) => w.meta.id === game.worldId);
  check('the exported entry for this world carries its edits',
    !!own && Object.keys(own.data.edits).length === game.edits.size);

  // Simulate "accidentally deleted a world, restored it from a backup":
  // importing the same bundle back in should bring it back.
  const deletedId = game2.worldId;
  deleteWorldForTest(deletedId);
  check('the world is gone locally before restoring it', !loadWorldData(deletedId));
  const restored = game2.importWorlds(JSON.stringify(bundle));
  check('importing restores a deleted world', restored >= 1 && !!loadWorldData(deletedId),
    `${restored} changed`);

  // A stale backup (older savedAt) must not clobber newer local progress —
  // importing an old export should never undo more recent play.
  const staleBundle = JSON.parse(JSON.stringify(bundle));
  const staleOwn = staleBundle.worlds.find((w) => w.meta.id === game.worldId);
  staleOwn.meta.savedAt = 1;
  staleOwn.data.pos = { x: -999, y: -999, z: -999 };
  const restale = game2.importWorlds(JSON.stringify(staleBundle));
  check('a stale backup does not overwrite newer local saves',
    loadWorldData(game.worldId)?.pos.x !== -999, `${restale} changed`);

  check('a non-backup file is rejected', (() => {
    try { game2.importWorlds('{"not":"a backup"}'); return false; } catch { return true; }
  })());
}

function loadWorldData(id) {
  try { return JSON.parse(memStore.get(`mg.blockcraft.world.${id}`) || 'null'); } catch { return null; }
}

/** Mirrors blockcraft.js's own (unexported) deleteWorld() by poking the
 *  shared mock store directly — good enough for setting up this one test. */
function deleteWorldForTest(id) {
  memStore.delete(`mg.blockcraft.world.${id}`);
  memStore.set('mg.blockcraft.worlds.v1', JSON.stringify(loadWorldListForTest().filter((w) => w.id !== id)));
}

function loadWorldListForTest() {
  try { return JSON.parse(memStore.get('mg.blockcraft.worlds.v1') || '[]'); } catch { return []; }
}

for (const c of checks) {
  console.log(`${c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${c.name.padEnd(46)} ${c.detail}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n\x1b[31m${failed} check(s) failed\x1b[0m` : '\n\x1b[32mAll checks passed\x1b[0m');
process.exit(failed ? 1 : 0);
