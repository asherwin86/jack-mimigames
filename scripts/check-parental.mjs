/**
 * Parental controls core (public/parental-core.js): limits, extra time, allowed hours, counting rules, warnings,
 * the PIN and its lock-out, blocked games. Runs the real file with a fake browser storage and a fake clock.
 *
 *   node scripts/check-parental.mjs
 */
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
// The file is a classic browser script, so load it the way a page would: run its text with a `module` to export into.
const mod = { exports: {} };
new Function('module', 'exports', fs.readFileSync(new URL('../public/parental-core.js', import.meta.url), 'utf8'))(mod, mod.exports);
const P = mod.exports;

let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
let now = new Date(2026, 9, 5, 10, 0, 0).getTime();   // Monday 5 Oct 2026, 10:00 am
P._setClock(() => now);
const at = (y, mo, d, h = 10, mi = 0) => { now = new Date(y, mo - 1, d, h, mi, 0).getTime(); };
const reset = () => { P.stop(); store.clear(); at(2026, 10, 5); };
const events = () => { const e = { warn: [], lock: 0, unlock: 0, change: 0, brk: 0 }; e.hooks = { onWarn: (m) => e.warn.push(m), onLock: () => { e.lock++; }, onUnlock: () => { e.unlock++; }, onChange: () => { e.change++; }, onBreak: () => { e.brk++; } }; return e; };
const play = (sec) => { for (let i = 0; i < sec; i++) { now += 1000; P.tick(1, { ignoreIdle: true }); } };

// ---------- off by default
reset();
ok(!P.enabled() && !P.hasPin() && P.status().enabled === false && P.status().locked === null, 'off by default: nothing is limited and nothing is locked');
ok(!P.gameBlocked('tetra-drop') && !P.keepInside(), '...no game is blocked and nothing is hidden');
P.save({ enabled: true });
ok(!P.enabled(), 'the controls cannot be switched on without a PIN');

// ---------- PIN
reset();
ok((await P.setPin('12')).ok === false && (await P.setPin('abcd')).ok === false && (await P.setPin('123456789')).ok === false, 'a PIN must be 4 to 8 digits');
ok((await P.setPin('2468')).ok && P.hasPin() && P.enabled(), 'setting a PIN switches the controls on');
const raw = store.get('mg.parental.v1');
ok(!raw.includes('2468') && /"hash":"[0-9a-f]{64}"/.test(raw), 'the PIN is stored salted and hashed, never as typed');
const first = JSON.parse(raw).pin;
await P.setPin('2468');
ok(JSON.parse(store.get('mg.parental.v1')).pin.hash !== first.hash, '...with a fresh salt every time');
ok((await P.verifyPin('2468')).ok === true, 'the right PIN is accepted');
let r = await P.verifyPin('1111');
ok(r.ok === false && r.left === 4, 'a wrong PIN is refused and says how many tries are left', JSON.stringify(r));
for (let i = 0; i < 3; i++) r = await P.verifyPin('1111');
ok(r.left === 1, '...counting down to one try', JSON.stringify(r));
r = await P.verifyPin('1111');
ok(r.ok === false && r.wait === 300, 'the fifth wrong try locks the PIN pad for 5 minutes', JSON.stringify(r));
r = await P.verifyPin('2468');
ok(r.ok === false && r.wait > 290, '...even the right PIN is refused during the lock-out', JSON.stringify(r));
now += 301 * 1000;
ok((await P.verifyPin('2468')).ok === true, '...and works again once the 5 minutes are up');
await P.verifyPin('0000');
ok((await P.verifyPin('2468')).ok && P.load().lock.fails === 0, 'a right PIN clears the wrong-try count');
ok((await P.changePin('9999', '1357')).ok === false && (await P.changePin('2468', '1357')).ok === true && (await P.verifyPin('1357')).ok && !(await P.verifyPin('2468')).ok, 'changing the PIN needs the old one');
ok((await P.verifyPin('abc')).ok === false, 'a PIN that is not digits is refused');

// ---------- settings are cleaned up
reset();
await P.setPin('2468');
P.save({ limits: { weekday: 'x', weekend: 99999 }, hours: { from: '25:99', to: 'nope' }, breakEvery: 2, blocked: ['a', 'a', 5, 'b'.repeat(80), 'c'] });
const sx = P.load();
ok(sx.limits.weekday === 60 && sx.limits.weekend === 600, 'nonsense limits fall back or are capped (60 default, 600 max)');
ok(sx.hours.from === '07:00' && sx.hours.to === '19:30', 'nonsense hours fall back to 7:00 and 19:30');
ok(sx.breakEvery === 5, 'a break reminder is never more often than every 5 minutes');
ok(JSON.stringify(sx.blocked) === '["a","c"]', 'the blocked list drops duplicates, non-text and over-long entries');
store.set('mg.parental.v1', '{ not json');
ok(P.load().enabled === false && P.load().limits.weekday === 60, 'a damaged settings file is treated as the defaults');

// ---------- weekday and weekend limits
reset();
await P.setPin('2468');
P.save({ limits: { weekday: 30, weekend: 90 } });
at(2026, 10, 5);
ok(P.status().limit === 30 && P.status().remaining === 1800, 'Monday uses the weekday limit (30 min)');
at(2026, 10, 3);
ok(P.isWeekend(new Date(now)) && P.status().limit === 90, 'Saturday uses the weekend limit (90 min)');
at(2026, 10, 4);
ok(P.status().limit === 90, 'Sunday too');
P.save({ limits: { weekday: 0 } });
at(2026, 10, 6);
ok(P.status().remaining === null && P.status().locked === null, 'a limit of 0 means no limit');

// ---------- counting, locking, warnings
reset();
await P.setPin('2468');
P.save({ limits: { weekday: 10 } });
let e = events();
P.start(e.hooks);
ok(P.status().remaining === 600, 'a fresh day starts with the full allowance');
play(60);
ok(P.status().used === 60 && P.status().remaining === 540, 'a minute of play uses a minute');
P.tick(10, { visible: false, ignoreIdle: true });
ok(P.status().used === 60, 'time is not counted while the page is hidden');
now += 6 * 60 * 1000;
P.tick(10);
ok(P.status().used === 60, 'time is not counted when nobody has touched anything for 5 minutes');
P.noteActivity();
play(240);   // 5 minutes used
ok(e.warn.length === 1 && e.warn[0] === 5, 'at 5 minutes left it warns once', JSON.stringify(e.warn));
play(235);
ok(e.warn.length === 1, '...and not again until the next threshold');
play(5);
ok(e.warn.length === 2 && e.warn[1] === 1 && !P.status().locked, 'at 1 minute left it warns again', JSON.stringify(e.warn));
play(59);
ok(!P.status().locked && e.lock === 0, '1 second left is not locked yet');
play(1);
ok(P.status().locked?.kind === 'time' && P.status().remaining === 0 && e.lock === 1, 'at zero it locks (time)');
const used0 = P.status().used;
play(30);
ok(P.status().used === used0 && e.lock === 1, 'a locked arcade stops counting and does not lock twice');
P.grant(15);
ok(!P.status().locked && P.status().remaining === 900 && e.unlock === 1, 'a parent adding 15 minutes unlocks it with 15 minutes left');
P.grant(15);
ok(P.status().remaining === 1800, '...and adding more stacks up');
at(2026, 10, 6);
P.tick(1, { ignoreIdle: true });
ok(P.status().used === 1 && P.status().bonus === 0, 'next day: the timer and the extra time start again');
P.resetToday();
ok(P.status().used === 0, "'reset today' sets the timer back to zero");
// the day rolls over while locked
reset(); await P.setPin('2468'); P.save({ limits: { weekday: 1 } });
e = events(); P.start(e.hooks);
at(2026, 10, 5, 23, 58); play(61);
ok(P.status().locked?.kind === 'time', 'locked late in the evening');
at(2026, 10, 6, 0, 1);
P.tick(1, { ignoreIdle: true });
ok(!P.status().locked && e.unlock === 1, 'and unlocked after midnight, on its own');
// not counting when off
reset(); P.start(events().hooks); play(30);
ok(P.status().used === 0, 'nothing is counted while the controls are off');

// ---------- two tabs
reset();
await P.setPin('2468'); P.save({ limits: { weekday: 60 } });
P.start(events().hooks);
play(10);
store.set('mg.parental.lease.v1', JSON.stringify({ id: 'another-tab', t: now }));
const u1 = P.status().used;
P.tick(5, { ignoreIdle: true });
ok(P.status().used === u1, 'while another tab of the site is counting, this one does not (no double counting)');
now += 3000;
P.tick(5, { ignoreIdle: true });
ok(P.status().used === u1 + 5, '...and takes over once the other tab has gone quiet');

// ---------- allowed hours
reset();
await P.setPin('2468');
P.save({ hours: { on: true, from: '07:00', to: '19:30' }, limits: { weekday: 0, weekend: 0 } });
at(2026, 10, 5, 10, 0); ok(!P.status().locked, 'inside the allowed hours: open (10:00)');
at(2026, 10, 5, 6, 59); ok(P.status().locked?.kind === 'hours', 'before the start: locked (6:59)');
at(2026, 10, 5, 7, 0); ok(!P.status().locked, 'exactly at the start: open (7:00)');
at(2026, 10, 5, 19, 29); ok(!P.status().locked, 'one minute before the end: open (19:29)');
at(2026, 10, 5, 19, 30); ok(P.status().locked?.kind === 'hours', 'at the end: locked (19:30)');
P.grant(30);
ok(!P.status().locked, 'a parent can let them play 30 more minutes after hours...');
now += 31 * 60 * 1000;
ok(P.status().locked?.kind === 'hours', '...and then it locks again');
P.save({ hours: { on: true, from: '21:00', to: '06:00' } });
at(2026, 10, 5, 23, 0); ok(!P.status().locked, 'an overnight window: open at 23:00');
at(2026, 10, 6, 5, 0); ok(!P.status().locked, '...and at 05:00');
at(2026, 10, 6, 12, 0); ok(P.status().locked?.kind === 'hours', '...locked at noon');
P.save({ hours: { on: false } });
ok(!P.status().locked, 'turning the hours off opens it');

// ---------- breaks
reset();
await P.setPin('2468'); P.save({ limits: { weekday: 0 }, breakEvery: 20 });
e = events(); P.start(e.hooks);
play(20 * 60 - 1); ok(e.brk === 0, 'no break reminder before 20 minutes of play');
play(1); ok(e.brk === 1, 'a break reminder at 20 minutes');
play(20 * 60); ok(e.brk === 2, '...and again 20 minutes later');

// ---------- blocking
reset();
await P.setPin('2468'); P.save({ blocked: ['blockcraft', 'tag-game'] });
ok(P.gameBlocked('blockcraft') && P.gameBlocked('tag-game') && !P.gameBlocked('tetra-drop'), 'blocked games are blocked and the rest are not');
P.save({ enabled: false });
ok(!P.gameBlocked('blockcraft') && !P.keepInside(), 'switching the controls off lifts every block');
P.save({ enabled: true });
ok(P.keepInside(), 'keep-inside is on by default');
P.save({ keepInside: false });
ok(!P.keepInside(), '...and can be turned off');
// ---------- settings listeners and no storage
let heard = 0; const off = P.onSettings(() => { heard++; });
P.save({ breakEvery: 30 }); off(); P.save({ breakEvery: 20 });
ok(heard === 1, 'screens are told when settings change (and can stop listening)');
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
P.save({ limits: { weekday: 15 } });
ok(P.load().limits.weekday === 15, 'with browser storage blocked it keeps working in memory instead of crashing');
P.stop();
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll parental-control checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
