/**
 * Hosting from the desktop app: the saved account storage (electron/hostConfig.cjs) and the guarantee behind it, that a
 * local account server given the same Upstash storage and password pepper keeps every account (hub-server/server.js).
 * Runs the real server against a fake Upstash.
 *   node scripts/check-host.mjs
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createHostConfig } = require('../electron/hostConfig.cjs');
let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };

// ---------- the saved settings
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-hostcfg-'));
const fakeSafe = (avail = true) => ({
  isEncryptionAvailable: () => avail,
  encryptString: (s) => Buffer.from(`ENC:${s}`.split('').reverse().join('')),
  decryptString: (b) => { const t = b.toString().split('').reverse().join(''); if (!t.startsWith('ENC:')) throw new Error('bad'); return t.slice(4); },
});
let cfg = createHostConfig({ dir, fs, safeStorage: fakeSafe() });
ok(cfg.pvpOn() === true && !cfg.publicStatus().configured && Object.keys(cfg.hubEnv()).length === 0, 'a fresh install: the arena is on, no storage saved, the server gets no storage settings');
let r = cfg.saveStorage({ url: 'http://x', token: 'abcdefgh', pepper: 'p' }); ok(!r.ok && /https/.test(r.msg), 'a database address that is not https is refused');
r = cfg.saveStorage({ url: 'https://good.upstash.io', token: 'abc', pepper: 'p' }); ok(!r.ok && /token/.test(r.msg), 'a missing token is refused');
r = cfg.saveStorage({ url: 'https://good.upstash.io', token: 'abcdefgh1234', pepper: '' }); ok(!r.ok && /pepper/i.test(r.msg), 'a missing pepper is refused, with the reason');
r = cfg.saveStorage({ url: ' https://good.upstash.io ', token: ' tok-1234567890 ', pepper: ' pep per ' });
ok(r.ok && r.encrypted, 'good settings are saved (encrypted)');
const raw = fs.readFileSync(cfg.file, 'utf8');
ok(!raw.includes('tok-1234567890') && !raw.includes('good.upstash.io') && !raw.includes('pep per'), 'none of the secrets are readable in the file');
const env = cfg.hubEnv();
ok(env.UPSTASH_REDIS_REST_URL === 'https://good.upstash.io' && env.UPSTASH_REDIS_REST_TOKEN === 'tok-1234567890' && env.HASH_PEPPER === 'pep per', 'the server is started with them (trimmed)');
const pub = cfg.publicStatus();
ok(pub.configured && pub.where === 'good.upstash.io' && !JSON.stringify(pub).includes('tok-'), 'the Host window only sees where it points, never the secrets');
cfg = createHostConfig({ dir, fs, safeStorage: fakeSafe() }); ok(cfg.publicStatus().configured, 'they are still there after a restart');
cfg = createHostConfig({ dir, fs, safeStorage: { ...fakeSafe(), decryptString: () => { throw new Error('other user'); } } });
ok(!cfg.publicStatus().configured && Object.keys(cfg.hubEnv()).length === 0, 'if they cannot be decrypted (another Windows user) they are treated as not saved, not as a crash');
cfg = createHostConfig({ dir, fs, safeStorage: fakeSafe() });
cfg.setPvp(false); ok(!cfg.pvpOn() && cfg.publicStatus().configured, 'turning the arena off is remembered and keeps the storage');
cfg.setPvp(true); cfg.clearStorage(); ok(cfg.pvpOn() && !cfg.publicStatus().configured, 'removing the storage keeps the arena setting');
fs.writeFileSync(cfg.file, '{ nope'); ok(cfg.pvpOn() && !cfg.publicStatus().configured, 'a damaged settings file is ignored');
const plain = createHostConfig({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-hostcfg2-')), fs, safeStorage: fakeSafe(false) });
ok(plain.saveStorage({ url: 'https://good.upstash.io', token: 'tok-1234567890', pepper: 'pp' }).encrypted === false && plain.publicStatus().configured && plain.publicStatus().encrypted === false, 'where the system cannot encrypt, it still works and says it is not encrypted');

// ---------- the account server on the same storage
const store = new Map();
const upstash = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer fake-token-12345') { res.writeHead(401); res.end('{"error":"nope"}'); return; }
    const [cmd, k, v] = JSON.parse(b || '[]');
    let result = null;
    if (cmd === 'GET') result = store.has(k) ? store.get(k) : null;
    else if (cmd === 'SET') { store.set(k, v); result = 'OK'; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => upstash.listen(0, '127.0.0.1', r));
const upUrl = `http://127.0.0.1:${upstash.address().port}`;
const hubPort = 21000 + Math.floor(Math.random() * 15000);
const HUB = `http://127.0.0.1:${hubPort}`;
const procs = [];
async function startHub(pepper) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-hub-data-'));
  const p = spawn(process.execPath, ['hub-server/server.js'], { env: { ...process.env, PORT: String(hubPort), MIMI_DATA_DIR: d, HUB_API_ONLY: '1', UPSTASH_REDIS_REST_URL: upUrl, UPSTASH_REDIS_REST_TOKEN: 'fake-token-12345', HASH_PEPPER: pepper }, stdio: 'ignore' });
  procs.push(p);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${HUB}/health`)).ok) return p; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('hub did not start');
}
const stopHub = (p) => new Promise((r) => { p.once('exit', r); p.kill(); });
const post = async (a, body) => (await fetch(`${HUB}/api/profiles/${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const hash = 'ab'.repeat(32);

let hub = await startHub('the-pepper');
let c = await post('create', { key: 'jack', name: 'Jack', passwordHash: hash, settings: { theme: 'x' }, device: { label: 'website' } });
ok(c.ok, 'an account is made on the first server');
await new Promise((r) => setTimeout(r, 1200));   // saves are written in the background
ok([...store.keys()].length > 0, 'it is written to the shared storage', [...store.keys()].join(','));
await stopHub(hub);

hub = await startHub('the-pepper');   // "the local computer": a new server process, same storage and pepper
let l = await post('login', { key: 'jack', passwordHash: hash, device: { label: 'this computer' } });
ok(l.ok && l.name === 'Jack', 'a different server on the same storage and pepper still knows the account and its password');
const again = await post('create', { key: 'jack', name: 'Jack', passwordHash: hash, settings: {}, device: { label: 'x' } });
ok(!again.ok, 'and it is not possible to create that name again (it really is the same data)');
await stopHub(hub);

hub = await startHub('another-pepper');
l = await post('login', { key: 'jack', passwordHash: hash, device: { label: 'this computer' } });
ok(!l.ok, 'with a different pepper the password no longer matches (which is why the pepper must be copied exactly)');
await stopHub(hub);

hub = await startHub('the-pepper');
l = await post('login', { key: 'jack', passwordHash: hash, device: { label: 'this computer' } });
ok(l.ok, 'and with the right one again it works');
await stopHub(hub);

// ---------- the arena bundle
const pvpPort = 22000 + Math.floor(Math.random() * 10000);
await import('node:child_process').then(({ execFileSync }) => execFileSync(process.execPath, ['scripts/bundle-pvp.mjs'], { stdio: 'ignore' }));
const pvp = spawn(process.execPath, ['hub-server/blockcraft-server.bundle.mjs', '--pvp'], { env: { ...process.env, PORT: String(pvpPort) }, stdio: 'ignore' });
procs.push(pvp);
let health = null;
for (let i = 0; i < 40 && !health; i++) { try { health = await (await fetch(`http://127.0.0.1:${pvpPort}/health`)).json(); } catch { await new Promise((r) => setTimeout(r, 150)); } }
ok(health?.ok === true && health.mode === 'pvp', 'the bundled PvP arena starts on its own and reports itself as a PvP server', JSON.stringify(health));

for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
upstash.close();
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll host checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
