/** Targeted checks for the voxel world: chunk streaming, generation, meshing,
 *  physics, editing, and save/load. */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

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

// A fixed random stream: the world's seed (and everything else that rolls dice)
// is then the same every run, so a check can only fail because of a real change,
// never because this run happened to draw a terrain with no buried stone near spawn.
{
  let a = 0x2f6e2b1;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
game.beginPlay();   // past the landing screen — otherwise update() ignores all input
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
check('has iron ore', (counts[16] || 0) > 10, `${counts[16] || 0} iron, ${counts[12] || 0} gold, ${counts[17] || 0} glowstone`);
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

// --- the sword ---
{
  const at = game.raycast();
  const before = { mined: game.mined, placed: game.placed };
  game.selectSlot(0);
    game.update(1 / 60);
  check('the sword is shown while selected', game.sword.visible);
  input.locked = true;
  input.held = 0;
  const blockBefore = at && game.get(at.x, at.y, at.z);
  for (let i = 0; i < 5; i++) game.update(1 / 60);
  check('holding attack swings the sword', game.swingT > 0, `swingT ${game.swingT.toFixed(2)}`);
  const swingPose = game.sword.userData.model.rotation.x;
  check('the swing moves the blade', swingPose < -0.3, `rotation.x ${swingPose.toFixed(2)}`);
  for (let i = 0; i < 115; i++) game.update(1 / 60);
  check('a sword in hand never digs', !at || game.get(at.x, at.y, at.z) === blockBefore, `mined ${game.mined - before.mined}`);
  input.held = null;
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  check('the swing finishes and rests', game.swingT === 0);
  input.held = 2;   // right click would place a block with any other slot
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  check('a sword in hand never places', game.placed === before.placed);
  input.held = null;
  input.locked = false;
  game.selectSlot(2);
  game.update(1 / 60);
  check('the sword hides when another slot is selected', !game.sword.visible);
}

// --- the bow ---
{
  const before = { mined: game.mined, placed: game.placed };
  game.pitch = 0.05;
  game.yaw = 0;
  game.selectSlot(1);
  game.update(1 / 60);
  check('slot 2 is the bow and it is shown', game.bow.visible && !game.sword.visible);
  input.locked = true;

  // A quick tap never draws far enough to shoot.
  const arrows0 = game.arrows.length;
  input.held = 0;
  for (let i = 0; i < 4; i++) game.update(1 / 60);
  input.held = null;
  game.update(1 / 60);
  check('a quick tap does not loose an arrow', game.arrows.length === arrows0, `${game.arrows.length} arrows`);

  // Hold to a full draw, then let go.
  input.held = 0;
  for (let i = 0; i < 70; i++) game.update(1 / 60);
  check('holding draws the bow to full', game.bowCharge === 1, `charge ${game.bowCharge.toFixed(2)}`);
  input.held = null;
  game.update(1 / 60);
  check('letting go looses one arrow', game.arrows.length === arrows0 + 1 && game.bowCharge === 0);
  const arrow = game.arrows[game.arrows.length - 1];
  check('a full draw is fast (about 60 blocks/second)', Math.abs(arrow.vel.length() - 60) < 3, `${arrow.vel.length().toFixed(1)}`);
  const y0 = arrow.pos.y;
  const vy0 = arrow.vel.y;
  for (let i = 0; i < 10; i++) game.update(1 / 60);
  check('arrows drop under gravity', arrow.vel.y < vy0, `vy ${vy0.toFixed(1)} → ${arrow.vel.y.toFixed(1)}`);
  for (let i = 0; i < 300 && !arrow.stuck && game.arrows.includes(arrow); i++) game.update(1 / 60);
  check('an arrow sticks in the first block it hits', arrow.stuck || !game.arrows.includes(arrow), `stuck ${arrow.stuck}`);
  check('a bow never digs or places', game.mined === before.mined && game.placed === before.placed);

  // PvP: an arrow that passes through a player reports a hit, with its draw.
  const sent = [];
  game.net = { readyState: 1, send: (m) => sent.push(JSON.parse(m)) };
  game.pvp = true;
  game.addNetPeer('victim', { name: 'V', color: '#fff', x: game.pos.x, y: game.pos.y, z: game.pos.z - 9, yaw: 0 });
  for (let z = 1; z <= 10; z++) for (let dy = 0; dy <= 3; dy++) {   // clear a straight corridor so terrain can't be in the way
    for (const dx of [-1, 0, 1]) game.set(Math.floor(game.pos.x) + dx, Math.floor(game.pos.y) + dy, Math.floor(game.pos.z) - z, 0);
  }
  game.bowCool = 0;
  input.held = 0;
  for (let i = 0; i < 70; i++) game.update(1 / 60);
  input.held = null;
  game.update(1 / 60);
  for (let i = 0; i < 40; i++) game.update(1 / 60);
  const hit = sent.find((m) => m.t === 'hit');
  check('an arrow that meets a player sends a bow hit for them', hit && hit.target === 'victim' && hit.w === 'bow' && hit.c > 0.95, JSON.stringify(hit));
  check('the shot is announced to others too', sent.some((m) => m.t === 'shoot'));
  check('that arrow is used up', !game.arrows.some((a) => a.own && !a.stuck));
  game.removeNetPeer('victim');
  game.net = null;
  game.pvp = false;

  // Someone else's arrow flies for show and never reports a hit.
  const n0 = game.arrows.length;
  game.handleNetMessage(JSON.stringify({ t: 'arrow', id: 'x', x: 0, y: 30, z: 0, vx: 10, vy: 0, vz: 0 }));
  check('another player\'s arrow appears', game.arrows.length === n0 + 1 && game.arrows[game.arrows.length - 1].own === false);
  game.handleNetMessage(JSON.stringify({ t: 'arrow', id: 'x', x: 0, y: 30, z: 0, vx: 900, vy: 0, vz: 0 }));
  check('an impossibly fast arrow is ignored', game.arrows.length === n0 + 1);
  input.locked = false;
  game.selectSlot(2);
  game.update(1 / 60);
  check('the bow hides when another slot is selected', !game.bow.visible);
}

// --- loot: armour and golden apples (PvP) ---
{
  game.pvp = true;
  game.netId = 'me';
  game.handleNetMessage(JSON.stringify({ t: 'drop', id: 'd1', kind: 'golden', x: 4, y: 20, z: 4 }));
  game.handleNetMessage(JSON.stringify({ t: 'drop', id: 'd2', kind: 'enchanted', x: 6, y: 20, z: 4 }));
  game.handleNetMessage(JSON.stringify({ t: 'drop', id: 'd3', kind: 'armor', x: 8, y: 20, z: 4 }));
  check('drops appear in the world', game.drops.size === 3);
  game.handleNetMessage(JSON.stringify({ t: 'drop', id: 'd1', kind: 'golden', x: 4, y: 20, z: 4 }));
  check('the same drop is not added twice', game.drops.size === 3);
  game.handleNetMessage(JSON.stringify({ t: 'drop', id: 'bad', kind: 'armor', x: 'NaN', y: 1, z: 1 }));
  check('a malformed drop is ignored', game.drops.size === 3);
  const y0 = game.drops.get('d1').item.position.y;
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  check('drops bob and spin', game.drops.get('d1').item.position.y !== y0 && game.drops.get('d1').item.rotation.y > 0);
  game.handleNetMessage(JSON.stringify({ t: 'gear', hp: 20, ab: 4, ar: 2 }));
  check('gear updates armour and absorption', game.armor === 2 && game.absorb === 4);
  game.handleNetMessage(JSON.stringify({ t: 'gear', hp: 20, ab: 999, ar: 99 }));
  check('gear values are clamped to their maximums', game.armor === 4 && game.absorb === 20);
  game.handleNetMessage(JSON.stringify({ t: 'hurt', id: 'me', by: 'x', hp: 18, ab: 3, ar: 1, kx: 0, kz: 0 }));
  check('a hit reports the new absorption and armour', game.absorb === 3 && game.armor === 1 && game.hp === 18);
  game.handleNetMessage(JSON.stringify({ t: 'pickup', id: 'd1', by: 'me', kind: 'golden' }));
  check('a picked-up drop vanishes', !game.drops.has('d1') && game.drops.size === 2);
  game.handleNetMessage(JSON.stringify({ t: 'respawn', id: 'me', hp: 20, ab: 0, ar: 0 }));
  check('dying loses armour and absorption', game.armor === 0 && game.absorb === 0);
  game.resetPvp();
  check('leaving PvP clears the loot', game.drops.size === 0);
  game.pvp = false;
  game.netId = undefined;
}

// --- no flying in PvP ---
{
  const hitF = input.hit;
  game.pvp = false;
  game.flying = false;
  input.hit = (k) => k === 'KeyF';
  game.update(1 / 60);
  check('F toggles flying outside PvP', game.flying === true);
  game.pvp = true;
  game.update(1 / 60);
  check('flying is switched off the moment PvP is on', game.flying === false);
  for (let i = 0; i < 10; i++) game.update(1 / 60);   // F "pressed" every frame
  check('F cannot turn flying on in PvP', game.flying === false);
  input.hit = hitF;
  game.pvp = false;
  game.flying = false;
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

// --- multiplayer: remote edits land (now or later), local edits notify a
// connected server, remote ones never echo back, and a live session isn't
// autosaved as a solo world -------------------------------------------------
{
  game.pos.set(0.5, 30, 0.5);
  game.updateStreaming(true);   // guarantee chunk 0,0 is loaded for what follows

  const before = game.get(2, 2, 2);
  const remoteId = before === 15 ? 16 : 15;
  game.applyRemoteEdit(2, 2, 2, remoteId);
  check('a remote edit to an already-loaded chunk lands immediately', game.get(2, 2, 2) === remoteId);

  // A remote edit to a chunk nobody's streamed in yet must not be dropped —
  // it's remembered and gets stamped on the moment that chunk does load.
  const farX = 500 * 16;
  const farZ = 500 * 16;
  check('the far chunk is not loaded yet', !game.chunkData.has('500,500'));
  game.applyRemoteEdit(farX + 3, 9, farZ + 3, 12);
  check('an edit to an unloaded chunk is remembered instead of dropped',
    game.remoteEdits.get('500,500')?.get(`${farX + 3},9,${farZ + 3}`) === 12);

  game.pos.set(farX + 0.5, 20, farZ + 0.5);
  game.updateStreaming(true);
  check('the remembered edit is applied once its chunk streams in',
    game.get(farX + 3, 9, farZ + 3) === 12);

  game.pos.set(0.5, 30, 0.5);
  game.updateStreaming(true);   // back near spawn for anything else that runs

  // set() is the local player's own edit — it should tell a connected server.
  const sent = [];
  game.net = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  game.set(3, 3, 3, 9);
  check('a local edit is sent to a connected server',
    sent.length === 1 && sent[0].t === 'edit' && sent[0].x === 3 && sent[0].y === 3 && sent[0].z === 3 && sent[0].b === 9,
    JSON.stringify(sent[0]));
  game.applyRemoteEdit(4, 4, 4, 9);
  check('a remote edit is never echoed back to the server', sent.length === 1);
  game.net = null;

  // A multiplayer session lives on the server, not in a local world slot —
  // autosave (and, by the same logic, dispose()) must leave it alone.
  game.multiplayer = true;
  game.dirty = true;
  let saveCalls = 0;
  const originalSave = game.save.bind(game);
  game.save = () => { saveCalls++; originalSave(); };
  game.saveTimer = 0;
  game.update(1 / 60);
  check('autosave is skipped while a multiplayer session is open',
    saveCalls === 0 && game.dirty === true);
  game.save = originalSave;
  game.multiplayer = false;
  game.dirty = false;
}

// --- chat: outgoing messages are sent and echoed locally, incoming ones are
// logged (the server never echoes a message back to whoever sent it) -------
{
  game.chatLog = [];
  const sent = [];
  game.net = { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) };
  game.pushChat('Alice', 'hello', false);   // an incoming message from someone else
  game.pushChat('Me', 'hi back', true);      // the local echo of a message we sent
  check('chat messages are logged in order',
    game.chatLog.length === 2 && game.chatLog[0].text === 'hello' && game.chatLog[1].self === true,
    JSON.stringify(game.chatLog));

  for (let i = 0; i < 35; i++) game.pushChat('Spam', `msg ${i}`, false);
  check('the chat log is capped so a long session can\'t grow it forever',
    game.chatLog.length <= 30, `${game.chatLog.length} entries`);

  game.net = null;
  check('sending is a no-op with no server connected', (() => {
    const before = game.chatLog.length;
    game.mpPanel = null;
    game.sendChat();
    return game.chatLog.length === before;
  })());
}

// --- browser hosting: this tab relaying for its own connected players -----
{
  game.pos.set(0.5, 30, 0.5);
  game.updateStreaming(true);   // guarantee chunk 0,0 is loaded for what follows
  game.hostPeer = {};   // truthy sentinel — handleHostData()/hostBroadcast() only check for that
  game.hostConns = new Map();

  const sentToA = [];
  const connA = { peer: 'peerA', send: (m) => sentToA.push(m) };
  game.handleHostData(connA, { t: 'hello', name: 'Guest' });
  const welcome = sentToA.find((m) => m.t === 'welcome');
  check('the host welcomes a joining player with its own seed', welcome?.seed === game.seed);
  check('the welcome lists the host itself as a player', welcome?.players?.some((p) => p.id === 'host'));

  sentToA.length = 0;
  game.mpPanel = null;   // sendChat() reads the chat box from here; not needed for set()
  game.set(2, 2, 2, 9);
  check('the host\'s own edit is broadcast to connected peers',
    sentToA.some((m) => m.t === 'edit' && m.x === 2 && m.y === 2 && m.z === 2 && m.b === 9));
  check('flattenEditsForNet reports the real diff, not the whole chunk',
    game.flattenEditsForNet().some(([x, y, z, id]) => x === 2 && y === 2 && z === 2 && id === 9));

  const sentToB = [];
  const connB = { peer: 'peerB', send: (m) => sentToB.push(m) };
  game.handleHostData(connB, { t: 'hello', name: 'Bob' });
  sentToA.length = 0;
  sentToB.length = 0;
  game.handleHostData(connA, { t: 'edit', x: 3, y: 3, z: 3, b: 15 });
  check('a peer\'s edit is applied on the host', game.get(3, 3, 3) === 15);
  check('a peer\'s edit is relayed to other peers but not echoed back to the sender',
    sentToB.some((m) => m.t === 'edit' && m.x === 3) && !sentToA.some((m) => m.t === 'edit' && m.x === 3));

  game.handleHostData(connA, { t: 'edit', x: 4, y: 4, z: 4, b: 24 });   // one past the last real block id
  check('the host rejects an out-of-range block id from a peer', game.get(4, 4, 4) !== 24);

  // Skins: a joiner's skin is validated (junk → default look, never a crash)
  // and shows up in what a later joiner is sent.
  const GOOD_SKIN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  game.handleHostData(connA, { t: 'skin', skin: GOOD_SKIN });
  check('the host records a valid skin from a peer', game.hostConns.get('peerA').skin === GOOD_SKIN);
  check('a peer skin change is relayed to other peers', sentToB.some((m) => m.t === 'skin' && m.skin === GOOD_SKIN));
  game.handleHostData(connA, { t: 'skin', skin: '<script>alert(1)</script>' });
  check('the host drops a non-PNG skin', game.hostConns.get('peerA').skin === null);
  check('every connected peer has a posable avatar', [...game.netPeers.values()].every((p) => p.avatar?.parts?.head && p.avatar.parts.legL));

  game.handleHostConnClose('peerA');
  check('a closed connection\'s player is removed', !game.netPeers.has('peerA'));

  game.hostConns.clear();
  game.hostPeer = null;
  game.netPeers.clear();
}

// --- PvP worlds: hearts, combat and bots run inside the game itself -------
{
  const pw = makeGame(makeInput());
  pw.start();
  check('a normal world has no arena and no PvP', pw.arena === null && pw.pvp === false);
  pw.buildWorld(777, null, 'PvP test', 'pvp-test', true);
  check('a PvP world starts an arena and turns PvP on', !!pw.arena && pw.pvp === true && pw.hasBots === true && pw.netId === 'host');
  check('it is remembered as a PvP world (the world list gets the flag)', (() => {
    pw.touchActive();
    return loadWorldListForTest().find((w) => w.id === 'pvp-test')?.pvp === true;
  })());
  check('flying is off in a PvP world', pw.flying === false);
  const botIds = () => [...pw.netPeers.keys()].filter((k) => String(k).startsWith('bot'));
  check('bots appear as players (the default count)', botIds().length === pw.botCount && pw.botCount > 0, `${botIds().length}`);
  pw.sendPvp({ t: 'bots', n: 5 });
  check('the Bots slider adds bots', botIds().length === 5);
  pw.sendPvp({ t: 'bots', n: 0 });
  check('...and 0 removes them all', botIds().length === 0);
  pw.sendPvp({ t: 'bots', n: 2 });
  const b1 = botIds()[0];

  // Put a bot beside us and cut it down; loot should drop (Math.random pinned so the roll is armour).
  const rec = pw.arena.players.get(b1);
  Object.assign(rec, { x: pw.pos.x + 1.5, y: pw.pos.y, z: pw.pos.z, protectUntil: 0 });
  pw.arena.onMove('host', { x: pw.pos.x, y: pw.pos.y, z: pw.pos.z, yaw: 0, pitch: 0 });
  pw.sendPvp({ t: 'hit', target: b1, w: 'sword' });
  check('hitting a bot hurts it (and everyone is told)', rec.hp === 14 && pw.netPeers.get(b1).hp === 14, `hp ${rec.hp}`);
  const realRandom = Math.random;
  Math.random = () => 0.1;
  rec.hp = 1; pw.arena.players.get('host').lastHitAt = 0;   // (the swing cooldown is the attacker's)
  pw.sendPvp({ t: 'hit', target: b1, w: 'sword' });
  Math.random = realRandom;
  check('killing a bot scores it and drops loot', pw.kills === 1 && pw.drops.size === 1, `kills ${pw.kills}, drops ${pw.drops.size}`);
  const drop = [...pw.drops.values()][0];
  pw.arena.onMove('host', { x: drop.group.position.x, y: drop.group.position.y, z: drop.group.position.z, yaw: 0, pitch: 0 });
  for (let i = 0; i < 40 && pw.armor < 1; i++) await new Promise((r) => setTimeout(r, 50));   // the arena checks pickups on a 100ms timer (allow a slow machine)
  check('walking over the drop picks it up (armour)', pw.armor === 1 && pw.drops.size === 0, `armor ${pw.armor}`);

  // Hosting a PvP world: friends join the same arena.
  pw.hostPeer = { destroy() {} };
  pw.hostCode = 'bc-test';
  const sent = [];
  const conn = { peer: 'peerZ', send: (m) => sent.push(m), close() {} };
  pw.handleHostData(conn, { t: 'hello', name: 'Zed', bots: 0, level: 'easy' });
  const w = sent.find((m) => m.t === 'welcome');
  check('a friend joining is told it is a PvP world with bots', w?.pvp === true && w?.bots === true && w?.botCount === 0 && Array.isArray(w?.drops));
  check('their welcome lists you and the bots', w.players.some((p) => p.id === 'host') && w.players.filter((p) => String(p.id).startsWith('bot')).length === botIds().length);
  pw.handleHostData(conn, { t: 'level', level: 'hard' });
  check('the friend\'s AI level is applied', pw.arena.players.get('peerZ').level === 'hard');
  pw.handleHostData(conn, { t: 'bots', n: 4 });
  const theirBots = () => [...pw.arena.players].filter(([, p]) => p.isBot && p.owner === 'peerZ');
  check('the friend can choose their own bots', theirBots().length === 4);
  check('their bots are announced to them', sent.filter((m) => m.t === 'join' && String(m.id).startsWith('bot')).length >= 4);
  pw.handleHostConnClose('peerZ');
  check('when the friend leaves, their bots go too', !pw.arena.players.has('peerZ') && theirBots().length === 0);
  const oldArena = pw.arena;
  pw.stopHosting();
  check('stopping hosting gives you a fresh arena', pw.arena !== oldArena && pw.pvp === true && !!pw.arena);
  pw.buildWorld(778, null, 'Plain', 'plain-test', false);
  check('switching to an ordinary world drops the arena and PvP', pw.arena === null && pw.pvp === false && pw.hasBots === false);
  pw.dispose();
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

// --- the newer blocks (ids 17-23) ------------------------------------------
{
  const t = makeGame(makeInput());
  t.start(); t.beginPlay();
  for (let i = 0; i < 5; i++) t.update(1 / 60);
  const px = Math.floor(t.pos.x), pz = Math.floor(t.pos.z);
  const gy = 30;
  let bad = null;
  for (let id = 17; id <= 23; id++) {
    try { t.set(px + id, gy, pz, id); } catch (e) { bad = `${id}: ${e.message}`; }
  }
  for (let i = 0; i < 6; i++) { try { t.update(1 / 60); } catch (e) { bad ??= e.message; } }
  check('every new block id can be placed and meshed without error', !bad, String(bad));
  check('the new blocks read back as placed', [17, 18, 19, 20, 21, 22, 23].every((id) => t.get(px + id, gy, pz) === id));
  const serverSrc = readFileSync(new URL('../server/blockcraft-server.mjs', import.meta.url), 'utf8');
  const serverMax = Number(/const MAX_BLOCK_ID = (\d+);/.exec(serverSrc)?.[1]);
  check('the multiplayer server accepts the new block ids', serverMax >= 23, `MAX_BLOCK_ID = ${serverMax}`);
  t.save();
  const t2 = makeGame(makeInput());
  t2.start();
  check('new blocks survive being saved and reloaded', [17, 18, 19, 20, 21, 22, 23].every((id) => t2.get(px + id, gy, pz) === id),
    [17, 18, 19, 20, 21, 22, 23].map((id) => t2.get(px + id, gy, pz)).join(','));
  // glowstone appears deep down in natural terrain
  const deep = countBlocks(t).counts[17] || 0;
  check('glowstone pockets are found deep underground', deep > 0, `${deep} glowstone in the loaded chunks`);
  let shallow = 0;
  for (const key of t.chunkData.keys()) {
    const [cx, cz] = key.split(',').map(Number);
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) for (let y = 9; y < 39; y++) if (t.get(cx * 16 + lx, y, cz * 16 + lz) === 17 && !(cx === Math.floor(px / 16) && Math.abs(y - gy) < 1)) shallow++;
  }
  check('...and never near the surface', shallow <= 7, `${shallow} above y8 (the seven placed test blocks may be among them)`);
}

for (const c of checks) {
  console.log(`${c.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${c.name.padEnd(46)} ${c.detail}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n\x1b[31m${failed} check(s) failed\x1b[0m` : '\n\x1b[32mAll checks passed\x1b[0m');
process.exit(failed ? 1 : 0);
