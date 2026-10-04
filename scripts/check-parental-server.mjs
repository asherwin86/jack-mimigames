/**
 * The account server's parental-controls actions (hub-server/server.js): a parent's account sends a request to a child's
 * account, the child accepts, then only the parent can change or remove the rules. Starts a real server on a spare port with
 * an empty data folder.
 *
 *   node scripts/check-parental-server.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimi-hub-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn(process.execPath, ['hub-server/server.js'], { env: { ...process.env, PORT: String(port), MIMI_DATA_DIR: dir, HUB_API_ONLY: '1' }, stdio: 'ignore' });
const HUB = `http://127.0.0.1:${port}`;
let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
const post = async (action, body) => (await fetch(`${HUB}/api/profiles/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const finish = () => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll parental server checks passed.\x1b[0m'); process.exit(failed ? 1 : 0); };

for (let i = 0; i < 50; i++) { try { if ((await fetch(`${HUB}/health`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
const hash = (n) => `${n.padEnd(64, '0')}`.slice(0, 64);
async function account(name) {
  const key = name.toLowerCase();
  const r = await post('create', { key, name, passwordHash: hash(key), settings: {}, device: { label: 'test' } });
  if (!r.ok) throw new Error('could not make ' + name + ': ' + JSON.stringify(r));
  return { key, token: r.token };
}
const mum = await account('Mum'), kid = await account('Kid'), other = await account('Other');
const rules = (over = {}) => ({ v: 1, enabled: true, pin: { salt: 'ab'.repeat(8), hash: 'cd'.repeat(32) }, limits: { weekday: 30, weekend: 60 }, hours: { on: false, from: '07:00', to: '19:30' }, breakEvery: 0, keepInside: true, blocked: ['tetra-drop'], bonus: { date: '', minutes: 0 }, pass: { until: 0 }, lock: { fails: 5, until: 1 }, t: 1000, ...over });
const used = (date, by, r = 0) => ({ date, r, by });
const today = '2026-10-05';
const as = (a, extra) => ({ key: a.key, token: a.token, ...extra });

let r = await post('parental', as(kid));
ok(r.ok && r.parental === null && r.request === null, 'a new account has no parental controls and no request');
r = await post('parental-request', as(mum, { target: 'kid', parental: { settings: rules(), used: used(today, {}) } }));
ok(r.ok && r.state === 'pending', 'a parent can send a request to a child account by name');
r = await post('parental', as(kid));
ok(r.parental === null && r.request?.fromName === 'Mum', 'the child sees the request, but the rules are not on their account yet');
ok(!JSON.stringify(r).includes('"pin"'), '...and the request details do not include the rules');

r = await post('parental-request', as(mum, { target: 'nobody', parental: { settings: rules() } }));
ok(r.ok === false && /no account/i.test(r.msg), 'a name with no account is refused');
r = await post('parental-request', as(mum, { target: 'mum', parental: { settings: rules() } }));
ok(r.ok === false, 'a parent cannot target their own account');
r = await post('parental-request', as(mum, { target: 'kid', parental: { settings: { enabled: true } } }));
ok(r.ok === false && /PIN/.test(r.msg), 'rules without a PIN are refused');
r = await post('parental-request', as(other, { target: 'kid', parental: { settings: rules() } }));
ok(r.ok === false && /already sent/.test(r.msg), 'a second account cannot take over a pending request');
r = await post('parental-request', { key: 'mum', token: 'wrong', target: 'kid', parental: { settings: rules() } });
ok(r.ok === false && r.authFailed, 'a request needs the parent to be signed in');
r = await post('parental-accept', as(other));
ok(r.ok === false, 'only the child account can accept');
r = await post('parental-accept', as(mum));
ok(r.ok === false, '...not the parent either');

r = await post('parental-accept', as(kid));
ok(r.ok && r.parental?.controllerName === 'Mum' && r.parental.settings.limits.weekday === 30 && r.request === null, 'accepting puts the parent\'s rules on the child\'s account');
ok(r.parental.settings.lock.fails === 0 && r.parental.settings.pin.hash === 'cd'.repeat(32), '...with the wrong-PIN counter cleaned and the PIN kept as the hash');

// the child's devices only report play time
r = await post('parental-put', as(kid, { parental: { settings: rules({ limits: { weekday: 0, weekend: 0 }, enabled: false, t: 9e12 }), used: used(today, { aaaa: 300 }) } }));
ok(r.parental.settings.limits.weekday === 30 && r.parental.settings.enabled, 'the child\'s side cannot change the rules, even with a newer stamp');
ok(r.parental.used.by.aaaa === 300, '...but its play time is recorded');
r = await post('parental-put', as(kid, { parental: { used: used(today, { aaaa: 100, bbbb: 60 }) } }));
ok(r.parental.used.by.aaaa === 300 && r.parental.used.by.bbbb === 60, 'play time per device only grows and devices add up');
r = await post('parental-put', as(kid, { parental: { used: used(today, {}, 5) } }));
ok(Object.keys(r.parental.used.by).length === 0, 'a newer reset replaces the day\'s counters');
r = await post('parental-put', as(kid, { parental: { used: used(today, { cccc: 99 }, 1) } }));
ok(Object.keys(r.parental.used.by).length === 0, 'an older reset does not bring the time back');
r = await post('parental-put', as(kid, { parental: { used: used('2026-10-06', { aaaa: 5 }) } }));
ok(r.parental.used.date === '2026-10-06' && r.parental.used.by.aaaa === 5, 'a new day starts fresh');

// only the parent manages them
r = await post('parental-manage', as(mum, { target: 'kid', op: 'get' }));
ok(r.ok && r.state === 'active' && r.parental.settings.blocked.includes('tetra-drop'), 'the parent can read them');
r = await post('parental-manage', as(mum, { target: 'kid', op: 'put', parental: { settings: rules({ limits: { weekday: 45, weekend: 60 }, t: 2000 }), used: used('2026-10-06', {}) } }));
ok(r.parental.settings.limits.weekday === 45, 'the parent can change them');
r = await post('parental-manage', as(mum, { target: 'kid', op: 'put', parental: { settings: rules({ limits: { weekday: 10, weekend: 10 }, t: 1500 }) } }));
ok(r.parental.settings.limits.weekday === 45, '...and an older copy does not overwrite newer rules');
r = await post('parental-manage', as(other, { target: 'kid', op: 'get' }));
ok(r.state === 'none' && r.parental === null, 'another account sees nothing');
r = await post('parental-manage', as(other, { target: 'kid', op: 'clear' }));
ok(r.state === 'none', 'another account cannot remove them');
r = await post('parental', as(kid));
ok(r.parental?.settings.limits.weekday === 45, '...they are still there');
r = await post('parental-request', as(other, { target: 'kid', parental: { settings: rules() } }));
ok(r.ok === false && /already has parental controls/.test(r.msg), 'a different parent cannot add a second set');
r = await post('parental-decline', as(kid));
ok(r.ok === false, 'there is nothing to decline once accepted');

r = await post('parental-manage', as(mum, { target: 'kid', op: 'clear' }));
ok(r.ok && r.state === 'none', 'the parent can remove them');
r = await post('parental', as(kid));
ok(r.parental === null, '...and the child\'s account is free again');

// decline, cancel
await post('parental-request', as(mum, { target: 'kid', parental: { settings: rules() } }));
r = await post('parental-decline', as(kid));
ok(r.ok && r.request === null && r.parental === null, 'the child can say no');
await post('parental-request', as(mum, { target: 'kid', parental: { settings: rules() } }));
r = await post('parental-manage', as(mum, { target: 'kid', op: 'get' }));
ok(r.state === 'pending', 'the parent sees a request that is waiting');
r = await post('parental-manage', as(mum, { target: 'kid', op: 'put', parental: { settings: rules({ limits: { weekday: 20, weekend: 20 }, t: 3000 }) } }));
await post('parental-accept', as(kid));
r = await post('parental', as(kid));
ok(r.parental?.settings.limits.weekday === 20, 'rules edited while waiting are the ones the child accepts');
await post('parental-manage', as(mum, { target: 'kid', op: 'clear' }));
await post('parental-request', as(mum, { target: 'kid', parental: { settings: rules() } }));
r = await post('parental-manage', as(mum, { target: 'kid', op: 'clear' }));
ok(r.state === 'none' && (await post('parental', as(kid))).request === null, 'the parent can cancel a request');
finish();
