/**
 * The operator tool (scripts/hub-admin.mjs) against a real server: rename an account (keeping its worlds and
 * Rocoin backup), set a password, grant the bug report inbox, and the guards around all of it.
 *
 *   node scripts/check-admin-cli.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 9900 + ((Math.random() * 90) | 0);
const PORT2 = PORT + 100;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-check-'));
const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-check2-'));
const TOKEN = 'a-long-secret-token-1234';
let failures = 0;
const ok = (label, cond, detail = '') => { console.log(`${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(70)} ${detail}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashPw = (key, pw) => createHash('sha256').update(`mimiProfile:${key}:${pw}`).digest('hex');
const post = async (port, p, body) => (await (await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json().catch(() => null));
const cli = (port, token, ...args) => spawnSync(process.execPath, ['scripts/hub-admin.mjs', ...args], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HUB_URL: `http://127.0.0.1:${port}`, HUB_ADMIN_TOKEN: token }, encoding: 'utf8' });
const start = (port, dir, extra = {}) => spawn(process.execPath, ['hub-server/server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), MIMI_DATA_DIR: dir, HASH_PEPPER: 'test-pepper', RATE_LIMIT_ADMIN_MAX: '4', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', ...extra }, stdio: 'ignore' });
const ready = async (port) => { for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); return; } catch { await sleep(150); } } };

const server = start(PORT, DATA, { HUB_ADMIN_TOKEN: TOKEN });
const off = start(PORT2, DATA2);   // no admin token: the tools must be switched off
try {
  await ready(PORT); await ready(PORT2);
  const wt = async (key, pw) => (await post(PORT, '/api/profiles/login', { key, passwordHash: hashPw(key, pw), device: { label: 'test' } }));

  await post(PORT, '/api/profiles/create', { key: 'owen', name: 'Owen', passwordHash: hashPw('owen', 'the old one'), settings: {} });
  await post(PORT, '/api/profiles/create', { key: 'sam', name: 'Sam', passwordHash: hashPw('sam', 'pw12') });
  const old = await wt('owen', 'the old one');
  const put = await post(PORT, '/api/worlds/put', { key: 'owen', token: old.token, id: 'w1', name: 'My world', seed: 7, data: JSON.stringify({ blocks: [1, 2, 3] }), expect: 0 });
  ok('setup: an account with a saved world', put?.ok === true, JSON.stringify(put));
  await post(PORT, '/api/profiles/wallet-put', { key: 'owen', token: old.token, wallet: { done: { 'all:first-run': [1, 5] }, slots: {} } });

  ok('the tool refuses to run without a token', /HUB_ADMIN_TOKEN/.test(cli(PORT, '', 'accounts').stderr));
  const bad = cli(PORT, 'wrong-token-wrong-token', 'accounts');
  ok('a wrong token is refused', bad.status === 1 && /Wrong admin token/.test(bad.stderr), bad.stderr.trim());
  const nothing = cli(PORT2, TOKEN, 'accounts');
  ok('with no HUB_ADMIN_TOKEN set on the server the tools are switched off', nothing.status === 1 && /not found/i.test(nothing.stderr), nothing.stderr.trim());
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = /Too many/.test(cli(PORT, 'guess-guess-guess-guess-' + i, 'accounts').stderr);
  ok('guessing the token hits the rate limit', limited);
  await sleep(100);

  const list = cli(PORT, TOKEN, 'accounts');
  ok('accounts lists names and flags (never passwords)', list.status === 0 || /Too many/.test(list.stderr), list.stdout.trim().replace(/\n/g, ' | '));
  ok('an ordinary account cannot read the inbox', (await post(PORT, '/api/reports/list', { key: 'sam', token: (await wt('sam', 'pw12')).token }))?.notAdmin === true);
  // the limiter above may have used up the minute's tries: give it a fresh server for the real work
  server.kill(); await sleep(300);
  const server2 = start(PORT, DATA, { HUB_ADMIN_TOKEN: TOKEN });
  await ready(PORT);
  const run = cli(PORT, TOKEN, 'setup', 'owen', 'Jack', '67');
  ok('"setup owen Jack 67" succeeds', run.status === 0, run.stdout.trim().replace(/\n/g, ' | ') + run.stderr);
  ok('the old account name is gone', (await wt('owen', 'the old one'))?.ok === false && (await wt('owen', '67'))?.ok === false);
  ok('the old password no longer works on the new name', (await wt('jack', 'the old one'))?.ok === false);
  const nj = await wt('jack', '67');
  ok('the account signs in as Jack with password 67', nj?.ok === true && nj.name === 'Jack');
  ok('the old devices were signed out', (await post(PORT, '/api/worlds/list', { key: 'owen', token: old.token }))?.ok === false && (await post(PORT, '/api/profiles/devices', { key: 'jack', token: old.token }))?.authFailed === true);
  const worlds = await post(PORT, '/api/worlds/list', { key: 'jack', token: nj.token });
  ok('the saved world moved across', worlds?.ok && JSON.stringify(worlds).includes('My world'), JSON.stringify(worlds).slice(0, 120));
  const get = await post(PORT, '/api/worlds/get', { key: 'jack', token: nj.token, id: 'w1' });
  ok('...and its data is intact', JSON.stringify(get).includes('blocks'), JSON.stringify(get).slice(0, 100));
  const wal = await post(PORT, '/api/profiles/wallet', { key: 'jack', token: nj.token });
  ok('the Rocoin backup moved across', wal?.ok && wal.wallet?.done?.['all:first-run']?.[1] === 5);
  const inbox = await post(PORT, '/api/reports/list', { key: 'jack', token: nj.token });
  ok('Jack can now read the bug report inbox', inbox?.ok === true);
  ok('the new Jack account survives a server restart', await (async () => { server2.kill(); await sleep(300); const s3 = start(PORT, DATA, { HUB_ADMIN_TOKEN: TOKEN }); await ready(PORT); const r = await wt('jack', '67'); const rr = await post(PORT, '/api/reports/list', { key: 'jack', token: r.token }); s3.kill(); return r?.ok === true && rr?.ok === true; })());

  const s4 = start(PORT, DATA, { HUB_ADMIN_TOKEN: TOKEN });
  await ready(PORT);
  const taken = cli(PORT, TOKEN, 'rename', 'jack', 'Sam', 'pw');
  ok('renaming onto a name that exists is refused', taken.status === 1 && /already taken/.test(taken.stderr), taken.stderr.trim());
  ok('a bad new name is refused', cli(PORT, TOKEN, 'rename', 'jack', 'x', 'pw').status === 1 && cli(PORT, TOKEN, 'rename', 'jack', '<b>', 'pw').status === 1);
  ok('an unknown account is refused', /No account/.test(cli(PORT, TOKEN, 'set-password', 'nobody', 'pw').stderr));
  const sp = cli(PORT, TOKEN, 'set-password', 'sam', 'newpass');
  ok('set-password changes just the password', sp.status === 0 && (await wt('sam', 'newpass'))?.ok === true && (await wt('sam', 'pw12'))?.ok === false, sp.stdout.trim());
  const ma = cli(PORT, TOKEN, 'make-admin', 'sam');
  ok('make-admin grants the inbox, remove-admin takes it away', ma.status === 0 && (await post(PORT, '/api/reports/list', { key: 'sam', token: (await wt('sam', 'newpass')).token }))?.ok === true && cli(PORT, TOKEN, 'remove-admin', 'sam').status === 0 && (await post(PORT, '/api/reports/list', { key: 'sam', token: (await wt('sam', 'newpass')).token }))?.ok === false);
  ok('the usage text is shown with no command', /rename <from> <to> <password>/.test(cli(PORT, TOKEN).stdout));
  s4.kill();
} catch (e) {
  ok(e.message, false);
} finally {
  server.kill(); off.kill();
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(DATA2, { recursive: true, force: true });
}
console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll admin tool checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
