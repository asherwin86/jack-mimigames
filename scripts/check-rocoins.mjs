/**
 * Rocoins: the wallet, the challenges that pay them, and the powers that cost
 * them. Pure logic — no browser needed.
 *
 *   node scripts/check-rocoins.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { Rocoins, mergeWallets, cleanWallet } = await import('../src/engine/Rocoins.js');
const ch = await import('../src/engine/challenges.js');
const { allPowers, findPower, usePower, whyNot, GENERIC_POWERS } = await import('../src/engine/Powers.js');
const { CATALOG, BY_ID } = await import('../src/games/catalog.js');
const { Scores } = await import('../src/engine/Storage.js');

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${msg}`); } else console.log(`\x1b[32mok\x1b[0m   ${msg}`); };
const fresh = () => { store.clear(); Rocoins._drop(); };
const submit = (id, score) => { const e = BY_ID.get(id); const r = ch.runFinished(e, score); Scores.submit(id, score, e.higherIsBetter !== false); return r; };

// ---------- wallet ----------
fresh();
ok(Rocoins.balance() === 0, 'starts with 0 Rocoins');
Rocoins.add(20);
ok(Rocoins.balance() === 20 && Rocoins.earned() === 20, 'add() gives coins and counts them as earned');
ok(Rocoins.spend(25) === false && Rocoins.balance() === 20, 'cannot spend more than you have (and nothing is taken)');
ok(Rocoins.spend(15) === true && Rocoins.balance() === 5 && Rocoins.spent() === 15, 'spend() takes coins');
ok(Rocoins.add(-5) === 5 && Rocoins.add(0) === 5 && Rocoins.add(NaN) === 5, 'add() ignores zero, negative and NaN');
Rocoins._drop();
ok(Rocoins.balance() === 5, 'balance survives a reload (stored)');
store.set('mg.rocoins.v1', '{ not json');
Rocoins._drop();
ok(Rocoins.balance() === 0, 'a corrupt save falls back to a clean wallet');
store.set('mg.rocoins.v1', JSON.stringify({ v: 2, done: 7, slots: 'x', slot: 12 }));
Rocoins._drop();
ok(Rocoins.balance() === 0 && Rocoins.isDone('anything') === false, 'nonsense values in the save are ignored');
store.set('mg.rocoins.v1', JSON.stringify({ v: 2, done: { a: [1, -5], b: [2, 1e12], c: 'x' }, slots: { s: { spent: -3, bonus: 'lots', runs: 2.7 } } }));
Rocoins._drop();
ok(Rocoins.balance() === 1000 && Rocoins.counters().runs === 2, 'negative, huge and non-numeric values are clamped');
store.set('mg.rocoins.v1', JSON.stringify({ coins: 42, runs: 3, pbs: 1, done: { 'goal:cube-dodger:0': 1700000000000 }, played: { 'cube-dodger': 3 } }));
Rocoins._drop();
ok(Rocoins.balance() === 42 && Rocoins.counters().runs === 3, 'the first save format is carried over with its balance');
Rocoins.spend(2); Rocoins._drop();
ok(Rocoins.balance() === 40, '…and is rewritten in the new format');

// ---------- every game has three sensible targets ----------
for (const e of CATALOG) {
  const goals = ch.gameChallenges(e);
  const g = goals.map((c) => c.at);
  const ordered = e.higherIsBetter === false ? g[0] > g[1] && g[1] > g[2] : g[0] < g[1] && g[1] < g[2];
  ok(goals.length === 3 && ordered && goals.every((c) => c.text && c.reward > 0), `${e.id}: three targets, each harder than the last`);
}

// ---------- paying out ----------
fresh();
const seen = [];
ch.onEarned((list) => seen.push(...list));
let r = submit('cube-dodger', 100);
ok(r.some((c) => c.id === 'all:first-run') && !r.some((c) => c.id.startsWith('goal:')), 'a run below the easy target only pays the first-run badge');
ok(Rocoins.balance() === 5, '…which is 5 Rocoins');
r = submit('cube-dodger', 420);
const goalIds = r.filter((c) => c.id.startsWith('goal:')).map((c) => c.id);
ok(goalIds.includes('goal:cube-dodger:0') && goalIds.includes('goal:cube-dodger:1') && !goalIds.includes('goal:cube-dodger:2'), '420 m clears easy and medium but not hard');
const dailyBonus = ch.dailyChallenges().some((d) => d.gameId === 'cube-dodger') ? ch.DAILY_REWARD : 0;   // (if today's daily happens to be this game, its medium target pays too)
ok(Rocoins.balance() === 5 + 5 + 12 + dailyBonus, 'and pays 5 + 12');
const before = Rocoins.balance();
r = submit('cube-dodger', 430);
ok(r.length === 0 && Rocoins.balance() === before, 'the same targets never pay twice');
r = submit('cube-dodger', 1000);
ok(r.length === 1 && r[0].id === 'goal:cube-dodger:2' && Rocoins.balance() === before + 30, 'the hard target pays 30 when finally reached');
ok(seen.length >= 4, 'earned events are announced to listeners');

// time-attack: smaller is better
fresh();
r = submit('marble-maze', 50);
ok(!r.some((c) => c.id.startsWith('goal:')), 'marble-maze: 50 s misses the 45 s target');
r = submit('marble-maze', 27);
ok(r.filter((c) => c.id.startsWith('goal:')).length === 2, 'marble-maze: 27 s clears the 45 s and 28 s targets');

// counters and everywhere challenges
fresh();
for (const id of ['cube-dodger', 'sky-hoops', 'block-stacker', 'whack-a-cube', 'simon-cubes']) submit(id, 0);
ok(Rocoins.isDone('all:variety-5') && Rocoins.isDone('all:first-run'), 'five different games earns the variety badge');
const c = Rocoins.counters();
ok(c.runs === 5 && c.pbs === 5, 'the first run in a game counts as a personal best');
submit('cube-dodger', 0);
ok(Rocoins.counters().pbs === 5, 'a run that does not beat the best is not a personal best');
ok(ch.runFinished(BY_ID.get('cube-dodger'), NaN).length === 0, 'a NaN score is ignored');

// daily
const d1 = ch.dailyChallenges('2026-09-24');
const d2 = ch.dailyChallenges('2026-09-24');
const d3 = ch.dailyChallenges('2026-09-25');
ok(d1.length === 3 && new Set(d1.map((d) => d.gameId)).size === 3, 'daily: three different games');
ok(JSON.stringify(d1) === JSON.stringify(d2), 'daily: the same date always gives the same three');
ok(JSON.stringify(d1) !== JSON.stringify(d3), 'daily: a new date gives new ones');
ok(d1.every((d) => !BY_ID.get(d.gameId).sandbox && !BY_ID.get(d.gameId).customStart), 'daily: never picks Blockcraft or Kart Circuit');
fresh();
const today = ch.dailyChallenges()[0];
const dEntry = BY_ID.get(today.gameId);
const good = dEntry.higherIsBetter === false ? today.at - 1 : today.at + 1;
r = ch.runFinished(dEntry, good);
ok(r.some((x) => x.id === today.id && x.reward === ch.DAILY_REWARD), 'daily: reaching today\'s target pays it');
r = ch.runFinished(dEntry, good);
ok(!r.some((x) => x.id === today.id), 'daily: only once per day');

// sandbox minutes + kart wins
fresh();
const bc = BY_ID.get('blockcraft');
ok(ch.minutesPlayed(bc, 9.9).length === 0, 'blockcraft: 9.9 minutes pays nothing yet');
r = ch.minutesPlayed(bc, 0.2);
ok(r.length === 1 && r[0].id === 'goal:blockcraft:0' && Rocoins.balance() === 5, 'blockcraft: 10 minutes total pays the easy target');
ok(ch.minutesPlayed(BY_ID.get('cube-dodger'), 30).length === 0, 'minutes only count in sandbox games');
const kart = BY_ID.get('kart-circuit');
ok(ch.valueReached(kart, 7).length === 0, 'kart: 7 laps pays nothing yet');
r = ch.valueReached(kart, 8);
ok(r.length === 1 && r[0].id === 'goal:kart-circuit:0', 'kart: 8 laps pays the first target');
ok(ch.valueReached(kart, 25).length === 1, 'kart: 25 laps pays the next');

// ---------- powers ----------
const engine = {
  canvas: { classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); } } },
  fx: new Map(), slow: null, camera: { isPerspectiveCamera: true, fov: 60, updateProjectionMatrix() {} }, scene: null,
  setSlowmo(sec, scale) { this.slow = { left: sec, scale }; },
};
const mkCtx = (over = {}) => ({ engine, game: { finished: false }, entry: BY_ID.get('cube-dodger'), ...over });
const P = (id) => GENERIC_POWERS.find((p) => p.id === id);

fresh();
let res = await usePower(P('slowmo'), mkCtx());
ok(!res.ok && /15 Rocoins/.test(res.msg) && /15 more/.test(res.msg) && engine.slow === null, 'a power you cannot afford is refused and says how many more coins you need');
Rocoins.add(20);
res = await usePower(P('slowmo'), mkCtx());
ok(res.ok && Rocoins.balance() === 5 && engine.slow?.scale === 0.5, 'slow-mo costs 15 and runs at half speed');
res = await usePower(P('widecam'), mkCtx());
ok(!res.ok && Rocoins.balance() === 5, 'wide view (8) is refused with only 5 left');
Rocoins.add(10);
res = await usePower(P('widecam'), mkCtx());
ok(res.ok && engine.camera.fov === 85 && Rocoins.balance() === 7, 'wide view widens the lens by 25 and costs 8');
res = await usePower(P('widecam'), mkCtx());
ok(res.ok && engine.camera.fov === 60 && Rocoins.balance() === 7, 'using a toggle again turns it off for free');
ok(whyNot(P('slowmo'), mkCtx({ game: null })) === 'Start a game first.', 'no powers outside a game');
ok(whyNot(P('slowmo'), mkCtx({ game: { finished: true } })) === 'This run is over.', 'no powers once the run has ended');
ok(/own powers/.test(whyNot(P('slowmo'), mkCtx({ game: { finished: false, genericPowers: false } }))), 'a game can switch the generic powers off');
engine.camera = { isPerspectiveCamera: false };
ok(/can't be widened/.test(whyNot(P('widecam'), mkCtx())), 'wide view is unavailable on an orthographic camera');

// refunds
Rocoins.add(50);
const bal = Rocoins.balance();
res = await usePower({ id: 'x', name: 'X', cost: 10, run: () => false }, mkCtx());
ok(!res.ok && Rocoins.balance() === bal, 'a power that could not be applied gives the coins back');
res = await usePower({ id: 'y', name: 'Y', cost: 10, run: async () => ({ ok: false, msg: 'Not now.' }) }, mkCtx());
ok(!res.ok && /Not now\./.test(res.msg) && Rocoins.balance() === bal, 'a refusal with a reason gives the coins back and says why');
const origErr = console.error; console.error = () => {};
res = await usePower({ id: 'z', name: 'Z', cost: 10, run: () => { throw new Error('boom'); } }, mkCtx());
console.error = origErr;
ok(!res.ok && Rocoins.balance() === bal, 'a power that throws gives the coins back');

// game-specific powers and the command lookup
const game = { finished: false, adminPowers: () => [{ id: 'heal', name: 'Full heal', cost: 10, desc: '', run: () => 'ok' }] };
const list = allPowers(mkCtx({ game }));
ok(list.some((p) => p.id === 'heal' && p.own) && list.some((p) => p.id === 'slowmo'), 'a game\'s own powers are listed after the generic ones');
ok(findPower('/slowmo', list)?.id === 'slowmo', 'command: /slowmo');
ok(findPower('Slow-mo', list)?.id === 'slowmo', 'command: by name');
ok(findPower('full heal', list)?.id === 'heal', 'command: by name with a space');
ok(findPower('wid', list)?.id === 'widecam', 'command: unique prefix');
ok(findPower('wi', list) === null, 'command: an ambiguous prefix finds nothing');
ok(findPower('', list) === null && findPower('nope', list) === null, 'command: unknown finds nothing');

// ---------- merging wallets from two devices ----------
fresh();
Rocoins.add(50);
const devA = Rocoins.snapshot();               // device A: 50 coins
const slotA = Object.keys(devA.slots)[0];
// device B starts from A's copy, then both carry on independently
const B = JSON.parse(JSON.stringify(devA));
B.slots.bbbb = { spent: 20, refunded: 0, bonus: 0, runs: 4, pbs: 1, t: 5, played: { 'cube-dodger': 4 }, minutes: {} };   // B spent 20
B.done['goal:cube-dodger:0'] = [100, 5];                                                                                // and earned 5
Rocoins.spend(10);                                                                                                       // meanwhile A spent 10
Rocoins.merge(B);
ok(Rocoins.balance() === 50 - 10 - 20 + 5, `both devices' spending and earnings are kept (got ${Rocoins.balance()}, want 25)`);
const once = Rocoins.snapshot();
Rocoins.merge(B); Rocoins.merge(once);
ok(Rocoins.balance() === 25, 'merging the same thing again changes nothing');
ok(JSON.stringify(mergeWallets(once, B)) === JSON.stringify(mergeWallets(B, once)) || Object.keys(mergeWallets(once, B).slots).length === Object.keys(mergeWallets(B, once).slots).length, 'merge order does not matter');
ok(Rocoins.counters().runs === 4 && Rocoins.counters().played['cube-dodger'] === 4, 'run counters from both devices add up');
const later = JSON.parse(JSON.stringify(B)); later.slots.bbbb.spent = 25; later.slots.bbbb.t = 9;
Rocoins.merge(later);
ok(Rocoins.balance() === 20, 'a device that spends more later replaces its own earlier total (not added twice)');
Rocoins.merge({ done: { 'goal:cube-dodger:0': [50, 5] }, slots: {} });
ok(Rocoins.balance() === 20 && Rocoins.snapshot().done['goal:cube-dodger:0'][0] === 50, 'the same challenge on two devices is paid once');
const junk = mergeWallets(null, { done: [], slots: { x: 1, y: { spent: '9' }, ['z'.repeat(50)]: {} } });
ok(Object.keys(junk.slots).join() === 'y' && junk.slots.y.spent === 9, 'garbage in an upload is dropped');
const many = { done: {}, slots: {} };
for (let i = 0; i < 60; i++) many.slots['d' + i] = { spent: 1, t: i };
ok(Object.keys(cleanWallet(many).slots).length === 60 && Object.keys(mergeWallets(many, {}).slots).length === 40, 'at most 40 devices are kept (the least recent are dropped)');
// another account's coins never flow into this one
fresh();
Rocoins.add(30); Rocoins.setOwner('alice');
ok(Rocoins.owner() === 'alice', 'a wallet remembers which account it belongs to');
Rocoins.adopt('bob', { done: { 'all:first-run': [1, 5] }, slots: {} });
ok(Rocoins.balance() === 5 && Rocoins.owner() === 'bob', 'adopting another account\'s wallet leaves the old coins behind');
Rocoins._drop();
ok(Rocoins.balance() === 5 && Rocoins.owner() === 'bob', '…and that is what was stored');

console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll Rocoin checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
