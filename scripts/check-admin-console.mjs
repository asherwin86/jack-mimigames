/**
 * The admin console's commands (src/engine/AdminCommands.js) with a fake wallet and fake browser pieces.
 *   node scripts/check-admin-console.mjs
 */
import { makeCommands } from '../src/engine/AdminCommands.js';

let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };

let bal = 10, inf = false, earned = 10, spent = 0, hub = 'https://default.example.com', gone = null, cleared = 0, locked = 0, seasoned = null, refreshed = 0, unlocked = true;
const Rocoins = {
  balance: () => (inf ? Infinity : bal), infinite: () => inf, earned: () => earned, spent: () => spent,
  spend: (n) => { if (bal < n) return false; bal -= n; spent += n; return true; },
  reset: () => { bal = 0; earned = 0; spent = 0; },
};
const tools = { give: (n) => { if (!unlocked) return null; bal += n; earned += n; return bal; }, setInfinite: (on) => { inf = on; } };
const games = [{ id: 'cube-dodger', name: 'Cube Dodger' }, { id: 'tetra-drop', name: 'Tetra Drop' }, { id: 'kart-racer', name: 'Island Kart Rush' }];
const env = {
  Rocoins, tools, games, go: (h) => { gone = h; }, info: () => 'INFO', season: (v) => { seasoned = v; }, refresh: () => { refreshed++; },
  lock: () => { locked++; }, clear: () => { cleared++; },
  hub: { url: () => hub, set: (u) => { hub = u || 'https://default.example.com'; }, ping: async () => ({ ok: true, text: 'pong' }) },
};
// fakes for the newer commands
let setting = null, sets = [], scoreStore = { 'tetra-drop': 120, 'cube-dodger': 9 }, cleared2 = [], reportsOpened = 0, backedUp = 0, restored = 0, reloaded = 0, fs = 0, resetS = 0, signedOut = 0, user = 'Jack', ran = null;
const powerList = [{ id: 'slowmo', name: 'Slow-mo', cost: 15 }, { id: 'confetti', name: 'Confetti', cost: 5 }];
Object.assign(env, {
  rand: () => 0.5, reload: () => { reloaded++; }, fullscreen: () => { fs++; }, reports: () => { reportsOpened++; },
  backup: () => { backedUp++; return 'Downloaded a backup.'; }, restore: () => { restored++; },
  powers: () => powerList,
  runPower: async (id) => { ran = id; return powerList.some((p) => p.id === id) ? { ok: true, text: `${id} used.` } : { ok: false, text: 'No such power.' }; },
  settings: { list: () => [{ name: 'music', on: true }, { name: 'props', on: false }], set: (n, on) => { sets.push([n, on]); } },
  scores: { all: () => scoreStore, clear: (id) => { cleared2.push(id); } }, resetSettings: () => { resetS++; },
  account: { name: () => user, signOut: () => { signedOut++; user = null; } },
});
const { run, names } = makeCommands(env);

let r = await run('help');
ok(r.ok && names.every((n) => r.text.includes(n)), 'help lists every command');
ok((await run('/HELP')).ok && (await run('?')).ok, 'a leading slash, capitals and ? all work');
r = await run('nope'); ok(!r.ok && /No command/.test(r.text), 'an unknown command says so');
r = await run('   '); ok(r.ok && r.text === '', 'an empty line does nothing');

r = await run('coins'); ok(r.ok && /10 Rocoins/.test(r.text), 'coins shows the balance');
r = await run('give 500'); ok(r.ok && bal === 510, 'give adds Rocoins', r.text);
r = await run('give abc'); ok(!r.ok && bal === 510, 'give needs a number');
r = await run('give -5'); ok(!r.ok && bal === 510, '...and a positive one');
r = await run('give 999999999999'); ok(r.ok && bal === 510 + 1e7, 'give is capped at 10,000,000');
bal = 510;
r = await run('take 10'); ok(r.ok && bal === 500, 'take removes Rocoins');
r = await run('take 9999'); ok(!r.ok && bal === 500, 'take refuses more than you have');
r = await run('set 42'); ok(r.ok && bal === 42, 'set lowers the balance exactly');
r = await run('set 1000'); ok(r.ok && bal === 1000, 'set raises it exactly');
r = await run('set -1'); ok(!r.ok, 'set refuses a negative number');
unlocked = false; r = await run('give 5'); ok(!r.ok && bal === 1000, 'give is refused when the tools are locked'); unlocked = true;

r = await run('infinite on'); ok(r.ok && inf, 'infinite on');
r = await run('take 5'); ok(!r.ok, 'take explains that infinite is on');
r = await run('set 5'); ok(!r.ok, 'set explains that infinite is on');
r = await run('coins'); ok(/Infinite/.test(r.text), 'coins says infinite is on');
r = await run('infinite off'); ok(r.ok && !inf, 'infinite off');
r = await run('infinite maybe'); ok(!r.ok, 'infinite needs on or off');

r = await run('games'); ok(r.ok && /3 games/.test(r.text), 'games lists them all');
r = await run('games kart'); ok(r.ok && /Island Kart Rush/.test(r.text) && !/Cube/.test(r.text), 'games can be filtered');
r = await run('games zzz'); ok(!r.ok, 'a filter with no match says so');
r = await run('play tetra'); ok(r.ok && gone === '#/tetra-drop', 'play finds a game by part of its name');
r = await run('play Cube Dodger'); ok(r.ok && gone === '#/cube-dodger', '...and by full name with spaces');
r = await run('play kart-racer'); ok(r.ok && gone === '#/kart-racer', '...and by id');
r = await run('play nothing'); ok(!r.ok, 'an unknown game is refused');
r = await run('home'); ok(r.ok && gone === '', 'home goes back to the menu');

r = await run('season holidays'); ok(r.ok && seasoned === 'holidays', 'season holidays');
r = await run('season auto'); ok(r.ok && seasoned === 'auto', 'season auto');
r = await run('season purple'); ok(!r.ok, 'a wrong season value is refused');

r = await run('info'); ok(r.ok && r.text === 'INFO', 'info');
r = await run('hub'); ok(r.ok && /default\.example/.test(r.text), 'hub shows the address');
r = await run('hub https://new.example.com'); ok(r.ok && hub === 'https://new.example.com', 'hub sets a new address');
r = await run('hub not-a-url'); ok(!r.ok && hub === 'https://new.example.com', 'a bad address is refused');
r = await run('hub ping'); ok(r.ok && r.text === 'pong', 'hub ping');
r = await run('hub reset'); ok(r.ok && /default/.test(hub), 'hub reset');

r = await run('refresh'); ok(r.ok && refreshed === 1, 'refresh');
r = await run('reset coins'); ok(!r.ok && bal === 1000, 'reset needs a clear yes');
r = await run('reset everything yes'); ok(!r.ok && bal === 1000, 'reset only does coins');
r = await run('reset coins yes'); ok(r.ok && bal === 0 && earned === 0, 'reset coins yes empties the wallet');
await run('clear'); ok(cleared === 1, 'clear');
await run('lock'); ok(locked === 1, 'lock');

r = await run('random'); ok(r.ok && gone === '#/tetra-drop', 'random opens a game (the middle one for a fixed dice roll)', gone);
r = await run('powers'); ok(r.ok && /slowmo/.test(r.text) && /confetti/.test(r.text), 'powers lists them');
env.powers = () => []; r = await run('powers'); ok(!r.ok, 'powers says to start a game when there are none'); env.powers = () => powerList;
r = await run('power slowmo'); ok(r.ok && ran === 'slowmo', 'power runs one');
r = await run('power nothing'); ok(!r.ok, 'an unknown power is refused');
r = await run('power'); ok(!r.ok, 'power needs an id');
r = await run('setting'); ok(r.ok && /music: on/.test(r.text) && /props: off/.test(r.text), 'setting lists them');
r = await run('setting music off'); ok(r.ok && sets.at(-1)?.join() === 'music,false', 'setting music off');
r = await run('setting MUSIC On'); ok(r.ok && sets.at(-1)?.join() === 'music,true', '...names and values ignore capitals');
r = await run('setting colour on'); ok(!r.ok, 'an unknown setting is refused');
r = await run('setting music maybe'); ok(!r.ok && sets.length === 2, 'a setting needs on or off');
r = await run('scores'); ok(r.ok && /2 best scores/.test(r.text) && /tetra-drop 120/.test(r.text), 'scores lists them');
r = await run('scores clear tetra'); ok(!r.ok && !cleared2.length, 'clearing a score needs yes');
r = await run('scores clear tetra yes'); ok(r.ok && cleared2.at(-1) === 'tetra-drop', 'scores clear one game');
r = await run('scores clear all yes'); ok(r.ok && cleared2.at(-1) === null, 'scores clear all');
r = await run('scores clear nothing yes'); ok(!r.ok, 'clearing an unknown game is refused');
r = await run('scores wipe'); ok(!r.ok, 'scores only understands clear');
r = await run('reports'); ok(r.ok && reportsOpened === 1, 'reports opens the inbox');
r = await run('account'); ok(r.ok && /Jack/.test(r.text), 'account shows who is signed in');
r = await run('account signout'); ok(r.ok && signedOut === 1, 'account signout');
r = await run('account signout'); ok(!r.ok && signedOut === 1, '...and says so when nobody is signed in');
r = await run('backup'); ok(r.ok && backedUp === 1, 'backup');
r = await run('restore'); ok(!r.ok && !restored, 'restore needs yes');
r = await run('restore yes'); ok(r.ok && restored === 1, 'restore yes');
r = await run('fullscreen'); ok(r.ok && fs === 1, 'fullscreen');
r = await run('reload'); ok(r.ok && reloaded === 1, 'reload');
r = await run('reset settings'); ok(!r.ok && !resetS, 'reset settings needs yes');
r = await run('reset settings yes'); ok(r.ok && resetS === 1, 'reset settings yes');

const boom = makeCommands({ ...env, info: () => { throw new Error('boom'); } });
r = await boom.run('info'); ok(!r.ok && /boom/.test(r.text), 'a command that throws gives a message instead of crashing');

console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll admin console checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
