/**
 * Starts the account / cloud-worlds / multiplayer server (hub-server/server.js)
 * for real and drives it over HTTP and WebSocket: sign up and in, password
 * hashing at rest, CORS, which endpoints are switched off, Blockcraft cloud
 * worlds (save, list, load, conflicts, limits, isolation, cleanup), the
 * rate limit, and the /mp room relay Kart Circuit uses.
 *
 *   node scripts/check-hub.mjs
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = 9100 + ((Math.random() * 700) | 0);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-check-'));
let failures = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(64)} ${detail}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = `http://127.0.0.1:${PORT}`;
const hashPw = (key, pw) => createHash('sha256').update(`mimiProfile:${key}:${pw}`).digest('hex');   // what the game's client sends
const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, headers: r.headers, json: await r.json().catch(() => null) }; };

const server = spawn(process.execPath, ['hub-server/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), MIMI_DATA_DIR: DATA, HASH_PEPPER: 'test-pepper', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });

try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/health'); break; } catch { await sleep(150); } }

  const health = await (await fetch(base + '/health')).json();
  ok('/health answers for uptime monitors', health.ok === true && health.service === 'mimi-arcade-hub', JSON.stringify(health));
  const pre = await fetch(base + '/api/profiles/login', { method: 'OPTIONS', headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST' } });
  ok('the CORS preflight is answered for other origins', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');

  // ---- accounts
  const key = 'owen', pw = 'correct horse';
  const h = hashPw(key, pw);
  const created = await post('/api/profiles/create', { key, name: 'Owen', passwordHash: h, settings: {} });
  ok('creating an account works (and carries CORS headers)', created.json?.ok === true && created.headers.get('access-control-allow-origin') === '*');
  ok('a taken name is refused', (await post('/api/profiles/create', { key, name: 'Owen', passwordHash: h })).json?.ok === false);
  ok('signing in with the right password works', (await post('/api/profiles/login', { key, passwordHash: h })).json?.ok === true);
  ok('a wrong password is refused', (await post('/api/profiles/login', { key, passwordHash: hashPw(key, 'nope') })).json?.ok === false);
  ok('dev accounts cannot be created here', (await post('/api/profiles/create', { key: 'sneaky', name: 'S', passwordHash: hashPw('sneaky', 'x'), dev: true, devPasswordHash: 'guess' })).json?.ok === false);
  await sleep(300);
  const stored = JSON.parse(fs.readFileSync(path.join(DATA, 'data', 'profiles.json'), 'utf8'));
  ok('the stored password hash is not the one the client sent (server-side pepper)', stored.owen && stored.owen.passwordHash !== h && /^[0-9a-f]{64}$/.test(stored.owen.passwordHash));

  // ---- switched-off endpoints
  for (const p of ['/api/feedback/list', '/api/messages/inbox', '/api/friends/list', '/api/cakes/list', '/api/videos/list', '/api/fetch-page', '/api/latest-release', '/index.html', '/games/mario-kart/game.js', '/data/profiles.json']) {
    const r = await fetch(base + p, { method: p.startsWith('/api') ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: p.startsWith('/api') ? '{}' : undefined });
    if (r.status !== 404) ok(`${p} is switched off`, false, `status ${r.status}`);
  }
  ok('the hub-only endpoints and static files are switched off', true);

  // ---- worlds
  const auth = { key, passwordHash: h };
  ok('the world list needs sign-in', (await post('/api/worlds/list', { key, passwordHash: 'x'.repeat(64) })).json?.ok === false);
  ok('a new account has no worlds', (await post('/api/worlds/list', auth)).json?.worlds?.length === 0);
  const worldData = JSON.stringify({ edits: { '0,0': [1, 4, 2, 9] }, pos: { x: 1, y: 20, z: 3 }, yaw: 0.5, pitch: 0, flying: false, mined: 3, placed: 2 });
  const put1 = await post('/api/worlds/put', { ...auth, id: 'w1', name: 'My world', seed: 4242, pvp: true, data: worldData, expect: 0 });
  ok('saving a world works', put1.json?.ok === true && put1.json.meta.pvp === true && put1.json.meta.seed === 4242, JSON.stringify(put1.json?.meta));
  const list1 = (await post('/api/worlds/list', auth)).json;
  ok('it shows in the list with its details', list1.worlds.length === 1 && list1.worlds[0].name === 'My world' && list1.worlds[0].pvp === true);
  const got = (await post('/api/worlds/get', { ...auth, id: 'w1' })).json;
  ok('loading it returns exactly what was saved', got.ok && got.data === worldData);
  const put2 = await post('/api/worlds/put', { ...auth, id: 'w1', name: 'My world', seed: 4242, pvp: true, data: worldData, expect: put1.json.meta.savedAt });
  ok('saving again with the last-seen save succeeds', put2.json?.ok === true && put2.json.meta.savedAt >= put1.json.meta.savedAt);
  const stale = await post('/api/worlds/put', { ...auth, id: 'w1', name: 'My world', seed: 4242, data: worldData, expect: put1.json.meta.savedAt - 1000 });
  ok('an out-of-date copy cannot overwrite newer progress', stale.json?.ok === false && stale.json.conflict === true);
  ok('...unless it is forced', (await post('/api/worlds/put', { ...auth, id: 'w1', name: 'Forced', seed: 4242, data: worldData, expect: 1, force: true })).json?.ok === true);
  ok('an oversized world is refused', (await post('/api/worlds/put', { ...auth, id: 'big', name: 'Big', seed: 1, data: JSON.stringify({ x: 'a'.repeat(950000) }), expect: 0 })).json?.tooBig === true);
  ok('data that is not JSON is refused', (await post('/api/worlds/put', { ...auth, id: 'bad', name: 'Bad', seed: 1, data: 'not json {', expect: 0 })).status === 400);
  ok('a bad world id is refused', (await post('/api/worlds/put', { ...auth, id: '../etc/passwd', name: 'x', seed: 1, data: '{}', expect: 0 })).status === 400);
  for (let i = 2; i <= 8; i++) await post('/api/worlds/put', { ...auth, id: `w${i}`, name: `W${i}`, seed: i, data: '{}', expect: 0 });
  const ninth = await post('/api/worlds/put', { ...auth, id: 'w9', name: 'Nine', seed: 9, data: '{}', expect: 0 });
  ok('an account holds at most 8 worlds', ninth.json?.ok === false && ninth.json.full === true);

  // another account can't see or touch them
  const k2 = 'friend', h2 = hashPw(k2, 'pw2');
  await post('/api/profiles/create', { key: k2, name: 'Friend', passwordHash: h2 });
  const other = { key: k2, passwordHash: h2 };
  ok('a different account has its own empty list', (await post('/api/worlds/list', other)).json.worlds.length === 0);
  ok('...and cannot load someone else\'s world', (await post('/api/worlds/get', { ...other, id: 'w1' })).json?.ok === false);
  await post('/api/worlds/delete', { ...other, id: 'w1' });
  ok('...or delete it', (await post('/api/worlds/list', auth)).json.worlds.some((w) => w.id === 'w1'));

  ok('deleting a world removes it', (await post('/api/worlds/delete', { ...auth, id: 'w8' })).json?.ok === true && !(await post('/api/worlds/list', auth)).json.worlds.some((w) => w.id === 'w8'));
  // restart keeps everything (files on disk)
  server.kill();
  await new Promise((r) => server.once('exit', r));
  const server2 = spawn(process.execPath, ['hub-server/server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), MIMI_DATA_DIR: DATA, HASH_PEPPER: 'test-pepper', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/health'); break; } catch { await sleep(150); } }
  ok('accounts and worlds survive a restart', (await post('/api/profiles/login', { key, passwordHash: h })).json?.ok === true && (await post('/api/worlds/list', auth)).json.worlds.length === 7);
  ok('...including the world\'s contents', (await post('/api/worlds/get', { ...auth, id: 'w1' })).json?.data === worldData);

  // ---- deleting an account takes its worlds with it
  ok('an account can be deleted', (await post('/api/profiles/delete', auth)).json?.ok === true);
  await sleep(300);
  await post('/api/profiles/create', { key, name: 'Newcomer', passwordHash: h });
  ok('a new account with the same name does not inherit the old worlds', (await post('/api/worlds/list', auth)).json.worlds.length === 0);

  // ---- multiplayer relay (what Kart Circuit's online modes use)
  const wsUrl = `ws://127.0.0.1:${PORT}/mp`;
  const open = (u) => new Promise((res, rej) => { const w = new WebSocket(u); w.once('open', () => res(w)); w.once('error', rej); });
  const next = (w, type) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + type)), 3000); const on = (raw) => { const m = JSON.parse(raw); if (m.type === type) { clearTimeout(t); w.off('message', on); res(m); } }; w.on('message', on); });
  const a = await open(wsUrl);
  const joinedA = next(a, 'joined');
  a.send(JSON.stringify({ type: 'host', name: 'Host' }));
  const ja = await joinedA;
  ok('hosting a race gives a room code', /^[A-Z0-9]{4}$/.test(ja.room) && ja.isHost === true, ja.room);
  const b = await open(wsUrl);
  const joinedB = next(b, 'joined');
  b.send(JSON.stringify({ type: 'join', room: ja.room, name: 'Guest' }));
  const jb = await joinedB;
  ok('a second player can join with that code', jb.room === ja.room && jb.isHost === false && jb.players.length === 2);
  const c = await open(wsUrl);
  const err = next(c, 'joinError');
  c.send(JSON.stringify({ type: 'join', room: 'ZZZZ', name: 'Nobody' }));
  ok('a wrong code is refused', /not found/i.test((await err).reason));
  a.close(); b.close(); c.close();

  // ---- the strict rate limit on credential checks
  let limited = false;
  for (let i = 0; i < 20 && !limited; i++) limited = (await post('/api/profiles/login', { key: 'ghost', passwordHash: hashPw('ghost', String(i)) })).status === 429;
  ok('guessing passwords hits the rate limit', limited);
  server2.kill();

  // ---- capacity guards (a second server with tiny limits)
  const PORT3 = PORT + 1;
  const DATA3 = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-check3-'));
  const s3 = spawn(process.execPath, ['hub-server/server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT3), MIMI_DATA_DIR: DATA3, MAX_PROFILES: '2', MAX_WORLD_STORE_MB: '0.0001', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' }, stdio: 'ignore' });
  const b3 = `http://127.0.0.1:${PORT3}`;
  const post3 = async (p, body) => (await (await fetch(b3 + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json());
  for (let i = 0; i < 40; i++) { try { await fetch(b3 + '/health'); break; } catch { await sleep(150); } }
  await post3('/api/profiles/create', { key: 'u1', name: 'U1', passwordHash: hashPw('u1', 'p') });
  await post3('/api/profiles/create', { key: 'u2', name: 'U2', passwordHash: hashPw('u2', 'p') });
  ok('the server stops taking sign-ups at its account limit', (await post3('/api/profiles/create', { key: 'u3', name: 'U3', passwordHash: hashPw('u3', 'p') })).ok === false);
  const full = await post3('/api/worlds/put', { key: 'u1', passwordHash: hashPw('u1', 'p'), id: 'a', name: 'A', seed: 1, data: JSON.stringify({ pad: 'x'.repeat(400) }), expect: 0 });
  ok('...and stops accepting worlds when its storage is full', full.ok === false && /storage is full/i.test(full.msg || ''), full.msg);
  s3.kill();
  fs.rmSync(DATA3, { recursive: true, force: true });
} catch (e) {
  ok(e.message, false);
  console.log(log);
} finally {
  server.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
}
console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll hub server checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
