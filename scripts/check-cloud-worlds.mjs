/**
 * Blockcraft worlds on an account: runs the real account server (hub-server/)
 * and drives the real game class against it — sign up, upload, list, load on
 * "another device", conflicts, size and count limits, delete, sign-out.
 *
 *   node scripts/check-cloud-worlds.mjs
 */
import * as THREE from 'three';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

globalThis.document ??= {
  createElement: () => ({
    width: 0, height: 0, style: {},
    getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, clearRect() {}, set fillStyle(_) {}, get fillStyle() { return '#000'; } }),
  }),
};
globalThis.addEventListener ??= () => {};
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
};

const PORT = 9800 + ((Math.random() * 150) | 0);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-check-'));
const server = spawn(process.execPath, ['hub-server/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), MIMI_DATA_DIR: DATA, HASH_PEPPER: 'p', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${PORT}`;

let failures = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(66)} ${detail}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { default: Blockcraft } = await import('../src/games/blockcraft.js');
const { Account, setHubUrl } = await import('../src/engine/Account.js');
setHubUrl(base);

const toasts = [];
function makeGame() {
  return new Blockcraft({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: null,
    input: {
      pointer: new THREE.Vector2(), delta: new THREE.Vector2(), down: false, clicked: false, wheel: 0, locked: false, keys: new Set(),
      key: () => false, hit: () => false, axisX: () => 0, axisY: () => 0, button: () => false, clickedButton: () => false,
      requestLock() {}, exitLock() {}, pick: () => null, gpAxis: () => 0, gpButton: () => false, gpHit: () => false,
    },
    audio: new Proxy({}, { get: () => () => {} }),
    hud: { stat() {}, toast: (t) => toasts.push(t), hint() {}, panel: () => null, stats: new Map() },
    size: { w: 1280, h: 800 }, setCamera() {}, end() {},
  });
}
const listOnServer = async () => (await Account.call('worlds', 'list')).worlds ?? [];

try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/health'); break; } catch { await sleep(150); } }

  const A = makeGame();
  A.start();
  ok('signed out: nothing is queued for upload', (A.scheduleCloudSave(true), A.cloudTimer === 0));

  const up = await Account.signUp('Cloudy', 'pw1234');
  ok('signing up works against the real server', up.ok === true, up.msg);
  A.buildWorld(555, null, 'Cloudy World', 'cloudy-1', true);
  A.set(1, 3, 2, 9);
  A.save();
  ok('a local save queues an upload while signed in', A.cloudTimer > 0);
  ok('the upload succeeds', (await A.cloudSave()) === true);
  const l1 = await listOnServer();
  ok('the world is on the account with its name, seed and PvP flag', l1.length === 1 && l1[0].id === 'cloudy-1' && l1[0].seed === 555 && l1[0].pvp === true && l1[0].name === 'Cloudy World', JSON.stringify(l1[0]));
  ok('the game remembers the account\'s version', A.cloudAt === l1[0].savedAt && loadList().find((w) => w.id === 'cloudy-1')?.cloudAt === l1[0].savedAt);

  // sign out and back in: the game forgets, then relearns, what's on the account
  Account.signOut();
  ok('signing out forgets the account\'s worlds', A.cloudIndex.size === 0);
  await Account.signIn('cloudy', 'pw1234');
  for (let i = 0; i < 30 && A.cloudIndex.size === 0; i++) await sleep(100);
  ok('signing back in fetches them again', A.cloudIndex.has('cloudy-1'));

  // "another device": no local worlds at all, same account
  Account.signOut();
  memStore.clear();
  const B = makeGame();
  B.start();
  await Account.signIn('Cloudy', 'pw1234');
  await B.cloudRefresh();
  ok('a new device sees the account\'s world', B.cloudIndex.has('cloudy-1'));
  ok('...with no local copy yet', !loadList().some((w) => w.id === 'cloudy-1'));
  ok('loading it downloads and opens it', (await B.loadCloudWorld('cloudy-1')) === true && B.worldId === 'cloudy-1');
  ok('the blocks come back', B.get(1, 3, 2) === 9);
  ok('it comes back as a PvP world, arena and all', B.pvpWorld === true && !!B.arena && B.pvp === true);
  ok('and it is now stored on this device too', !!loadList().find((w) => w.id === 'cloudy-1'));

  // conflicts: B saves newer progress; the stale copy in A must not overwrite it
  B.set(2, 3, 2, 9);
  B.save();
  ok('the second device\'s newer save goes up', (await B.cloudSave()) === true);
  A.set(3, 3, 2, 9);
  A.save();
  toasts.length = 0;
  ok('a stale copy is refused', (await A.cloudSave()) === false && A.cloudBlocked.has('cloudy-1'));
  ok('...and the player is told', toasts.some((t) => /another device/i.test(t)), toasts.join(' | '));
  A.scheduleCloudSave(true);
  ok('...and it stops retrying that world', A.cloudTimer === 0);
  const still = await Account.call('worlds', 'get', { id: 'cloudy-1' });
  ok('the newer progress is still what the account holds', JSON.parse(still.data).edits && Object.keys(JSON.parse(still.data).edits).length > 0);

  // size limit
  B.buildWorld(9, null, 'Huge', 'huge-1', false);
  for (let cx = 0; cx < 24; cx++) {
    const data = new Uint8Array(16 * 40 * 16);
    for (let i = 0; i < data.length; i++) data[i] = 1 + ((i * 7919 + cx * 31) % 16);   // noisy voxels compress badly
    B.edits.set(`${cx},0`, data);
  }
  B.save();
  toasts.length = 0;
  const hugeLen = JSON.stringify(B.serializeWorld()).length;
  ok('a world too big for an account is not uploaded', (await B.cloudSave()) === false && B.cloudBlocked.has('huge-1'), `world JSON is ${hugeLen} chars`);
  ok('...it is still saved on this device, and the player is told', !!loadList().find((w) => w.id === 'huge-1') && toasts.some((t) => /too big/i.test(t)), toasts.join(' | '));

  // account full
  for (let i = 0; i < 7; i++) await Account.call('worlds', 'put', { id: `filler-${i}`, name: `F${i}`, seed: i, data: '{}', expect: 0 });
  B.buildWorld(10, null, 'Ninth', 'ninth-1', false);
  B.set(1, 1, 1, 3);
  B.save();
  toasts.length = 0;
  ok('a ninth world is refused (the account holds 8)', (await B.cloudSave()) === false && toasts.some((t) => /8 worlds/i.test(t)), toasts.join(' | '));

  // delete
  await B.removeWorld('cloudy-1');
  ok('deleting a world removes it from the account too', !(await listOnServer()).some((w) => w.id === 'cloudy-1') && !loadList().some((w) => w.id === 'cloudy-1'));

  // signed out: worlds stay local and nothing is queued
  Account.signOut();
  B.buildWorld(11, null, 'Local only', 'local-1', false);
  B.set(1, 1, 1, 3);
  B.save();
  ok('signed out, worlds still save locally and nothing is queued', !!loadList().find((w) => w.id === 'local-1') && B.cloudTimer === 0);
  // ---- an older session (password hash, no token) upgrades itself to a device token
  const { hashPassword } = await import('../src/engine/Account.js');
  const lh = await hashPassword('legacy', 'oldpass');
  await fetch(`${base}/api/profiles/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'legacy', name: 'Legacy', passwordHash: lh }) });
  memStore.set('mimiActiveSession', JSON.stringify({ key: 'legacy', name: 'Legacy', passwordHash: lh, dev: false }));
  Account.refresh();
  ok('a pre-token session is recognised', Account.name() === 'Legacy' && !Account.session().token);
  const lr = await Account.call('worlds', 'list');
  ok('it still works, and upgrades to a device token on first use', lr.ok === true && !!Account.session().token && Account.session().passwordHash === undefined);
  ok('...and the stored session no longer holds the password hash', !JSON.parse(memStore.get('mimiActiveSession')).passwordHash);
  const dv = await Account.devices();
  ok('the device now shows up in the list', dv.ok && dv.devices.length === 1 && dv.devices[0].current === true, dv.devices?.[0]?.label);
  await Account.revokeOthers();
  const signedOutWorlds = await (async () => { const t = Account.session().token; Account.signOut(); await sleep(300); return (await (await fetch(`${base}/api/worlds/list`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'legacy', token: t }) })).json()); })();
  ok('signing out really revokes the token on the server', signedOutWorlds.authFailed === true);

  B.dispose(); A.dispose();
} catch (e) {
  ok(e.stack || e.message, false);
} finally {
  server.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}

function loadList() {
  try { return JSON.parse(memStore.get('mg.blockcraft.worlds.v1') || '[]'); } catch { return []; }
}

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll cloud world checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
