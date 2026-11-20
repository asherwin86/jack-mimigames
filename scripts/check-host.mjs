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
const { createTailscale } = require('../electron/tailscale.cjs');
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

// ---------- the host controls cannot be reached through a tunnel
{
  const ctlPort = 23000 + Math.floor(Math.random() * 9000);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-ctl-'));
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head><body>hi</body></html>');
  const srv = spawn(process.execPath, ['hub-server/server.js'], { env: { ...process.env, PORT: String(ctlPort), MIMI_DATA_DIR: d, MIMI_HOST_MODE: '1', HUB_STATIC_DIR: dist, MIMI_PVP_PORT: '7443', MIMI_PVP_TLS_PORT: '8443', MIMI_HOST_CONTROL_TOKEN: 'secret-secret-secret-1234' }, stdio: 'ignore' });
  procs.push(srv);
  const base = `http://127.0.0.1:${ctlPort}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 150)); }
  const call = (p2, method, headers = {}, body) => fetch(base + p2, { method, headers: { 'Content-Type': 'application/json', ...headers }, body }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const T = { 'x-mimi-host-control': 'secret-secret-secret-1234' };
  let x = await call('/api/host/info', 'GET'); ok(x.status === 403, 'the host info needs the app\'s secret, even from this computer', String(x.status));
  x = await call('/api/host/info', 'GET', { 'x-mimi-host-control': 'wrong' }); ok(x.status === 403, '...a wrong secret is refused');
  x = await call('/api/host/info', 'GET', T); ok(x.status === 200 && x.json.ok, 'with the secret it answers');
  x = await call('/api/host/sharing', 'POST', {}, '{"on":false}'); ok(x.status === 403, 'switching hosting off needs the secret');
  x = await call('/api/host/sharing', 'POST', { ...T, 'x-forwarded-for': '203.0.113.5' }, '{"on":false}'); ok(x.status === 403, '...and a request that came through a tunnel is refused even with the secret (a proxy header marks it)');
  x = await call('/api/host/sharing', 'POST', { ...T, 'tailscale-ingress-src': '203.0.113.5:1234' }, '{"on":false}'); ok(x.status === 403, '...also when the only sign is Tailscale\'s header');
  x = await call('/api/host/announce', 'POST', {}, '{"on":false}'); ok(x.status === 403, 'announcing needs the secret too');
  x = await call('/api/host/sharing', 'POST', T, '{"on":true}'); ok(x.status === 200, 'the app itself (with the secret, no proxy) can still control it');
  const page = await fetch(base + '/').then((r) => r.text());
  ok(/MIMI_LOCAL_HOST=true/.test(page) && /MIMI_PVP_PORT=7443/.test(page) && /MIMI_PVP_TLS_PORT=8443/.test(page), 'pages served from here are told where the arena is, plain and over https');
  const noTok = spawn(process.execPath, ['hub-server/server.js'], { env: { ...process.env, PORT: String(ctlPort + 1), MIMI_DATA_DIR: d, MIMI_HOST_MODE: '1', HUB_STATIC_DIR: dist }, stdio: 'ignore' });
  procs.push(noTok);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${ctlPort + 1}/health`)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 150)); }
  const y = await fetch(`http://127.0.0.1:${ctlPort + 1}/api/host/sharing`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: '{"on":false}' }).then((r) => r.status);
  ok(y === 403, 'even a server started without a secret refuses controls that came through a proxy');
}

// ---------- Tailscale Funnel
{
  const calls = [];
  let mode = 'ready';
  const fakeRun = async (file, args) => {
    calls.push([file, ...args].join(' '));
    const a = args.join(' ');
    if (mode === 'missing') return { code: -1, stdout: '', stderr: '' };
    if (a === 'version') return { code: 0, stdout: '1.80.0', stderr: '' };
    if (a === 'status --json') return { code: 0, stdout: JSON.stringify(mode === 'login' ? { BackendState: 'NeedsLogin' } : mode === 'stopped' ? { BackendState: 'Stopped' } : { BackendState: 'Running', Self: { DNSName: 'my-pc.tail1234.ts.net.' } }), stderr: '' };
    if (a === 'funnel status --json') return { code: 0, stdout: JSON.stringify(on ? { AllowFunnel: { 'my-pc.tail1234.ts.net:443': true, 'my-pc.tail1234.ts.net:8443': true } } : {}), stderr: '' };
    if (a.startsWith('funnel --bg')) { if (mode === 'needsfunnel') return { code: 1, stdout: '', stderr: 'Funnel is not enabled on your tailnet.\nTo enable, visit: https://login.tailscale.com/f/funnel?node=abc123' }; on = true; return { code: 0, stdout: '', stderr: '' }; }
    if (a.includes(' off')) { on = false; return { code: 0, stdout: '', stderr: '' }; }
    return { code: 1, stdout: '', stderr: 'unknown' };
  };
  let on = false;
  const ts = createTailscale({ run: fakeRun, existsSync: () => true, env: { ProgramFiles: 'C:\\Program Files' }, hubPort: 1864, pvpPort: 7443 });
  mode = 'missing'; ok((await ts.status()).state === 'missing', 'Tailscale not installed is reported as missing');
  ok(!(await ts.enable()).ok, '...and turning on says so');
  const ts2 = createTailscale({ run: fakeRun, existsSync: () => true, env: {}, hubPort: 1864, pvpPort: 7443 });
  mode = 'login'; ok((await ts2.status()).state === 'needs-login' && /sign in/i.test((await ts2.enable()).msg), 'installed but signed out: asks them to sign in');
  const ts3 = createTailscale({ run: fakeRun, existsSync: () => true, env: {}, hubPort: 1864, pvpPort: 7443 });
  mode = 'stopped'; ok((await ts3.status()).state === 'stopped', 'a stopped Tailscale is reported');
  const ts4 = createTailscale({ run: fakeRun, existsSync: () => true, env: {}, hubPort: 1864, pvpPort: 7443 });
  mode = 'needsfunnel'; calls.length = 0;
  let r2 = await ts4.enable(); ok(!r2.ok && r2.link === 'https://login.tailscale.com/f/funnel?node=abc123', 'when Funnel is not allowed yet, it hands back the page to visit', JSON.stringify(r2));
  const ts5 = createTailscale({ run: fakeRun, existsSync: () => true, env: {}, hubPort: 1864, pvpPort: 7443 });
  mode = 'ready'; calls.length = 0; on = false;
  ok((await ts5.status()).on === false, 'ready but not exposed yet');
  r2 = await ts5.enable();
  ok(r2.ok && r2.urls.page === 'https://my-pc.tail1234.ts.net/' && r2.urls.arena === 'wss://my-pc.tail1234.ts.net:8443', 'turning on gives the stable address and the arena address', JSON.stringify(r2.urls));
  ok(calls.some((c) => c.endsWith('funnel --bg --https=443 localhost:1864')) && calls.some((c) => c.endsWith('funnel --bg --https=8443 localhost:7443')), 'it exposes the account server and page on 443 and the arena on 8443 (and nothing else)', calls.filter((c) => c.includes('funnel --bg')).join(' | '));
  ok((await ts5.status()).on === true, 'status then shows it on');
  await ts5.disable(); ok((await ts5.status()).on === false && calls.some((c) => c.endsWith('funnel --https=443 off')) && calls.some((c) => c.endsWith('funnel --https=8443 off')), 'turning off closes both');
}

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
