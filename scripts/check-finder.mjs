/**
 * The game finder (src/engine/GameFinder.js) against the real catalogue: what a person might type, and what they should get.
 *   node scripts/check-finder.mjs
 */
import { findGames, findByName, didYouMean, surprise } from '../src/engine/GameFinder.js';
import { CATALOG } from '../src/games/catalog.js';
import { LINKED } from '../src/engine/LinkedGames.js';

let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
const all = [...CATALOG.map((e) => ({ ...e, kind: 'game' })), ...LINKED.filter((l) => l.kind === 'page')];
const top = (q, n = 5, opts = {}) => findGames(q, all, opts).slice(0, n).map((r) => r.entry.id);
const tagsOf = (id) => all.find((e) => e.id === id).tags;
const allTop = (q, tag, n = 5) => top(q, n).every((id) => tagsOf(id).includes(tag) || all.find((e) => e.id === id).name.toLowerCase().includes(q));

ok(allTop('racing', 'racing', 3), 'racing finds the racing games first');
ok(top('cars', 6).some((id) => tagsOf(id).includes('racing')), 'cars finds racing games');
ok(allTop('puzzle', 'puzzle'), 'puzzle finds puzzles');
ok(allTop('shoot', 'shooter', 4), 'shoot finds shooters');
ok(top('relaxing', 6).every((id) => ['puzzle', 'memory', 'sandbox', 'timing'].some((t) => tagsOf(id).includes(t))), 'relaxing finds calm kinds of game (puzzle, memory, sandbox, timing)');
ok(top('chill').slice(0, 3).join() === top('relaxing').slice(0, 3).join(), 'chill means the same as relaxing');
ok(top('build')[0] === 'blockcraft', 'build finds Blockcraft first');
ok(top('minecraft')[0] === 'blockcraft', 'minecraft finds Blockcraft first');
ok(top('kart', 3).every((id) => /kart/.test(id)), 'kart finds the kart games first', top('kart', 3).join());
ok(top('music')[0] === 'beat-lanes', 'music finds the rhythm game');
ok(top('fishing')[0] === 'fishing-pond', 'a game named in the words is first');
ok(top('fly', 3).some((id) => tagsOf(id).includes('flight')), 'fly finds flying games');
ok(allTop('sport', 'sport'), 'sport finds sports');
ok(top('basketball').some((id) => tagsOf(id).includes('sport')), 'basketball finds sports games');
ok(top('chess').some((id) => tagsOf(id).includes('strategy')), 'chess finds strategy games');
ok(top('fast reflex')[0] && tagsOf(top('fast reflex')[0]).includes('reflex'), 'two words together: fast reflex');
ok(top('a quick game please').length > 0 && top('a quick game please').every((id) => ['arcade', 'reflex', 'timing'].some((t) => tagsOf(id).includes(t))), 'a sentence works: filler words are ignored');
ok(top('I want to play something relaxing').join() === top('relaxing').join(), '...so a full sentence gives what the one word gives');
ok(top('tetrs dro')[0] === 'tetra-drop', 'a typo still finds Tetra Drop');
ok(top('tetra')[0] === 'tetra-drop', 'part of a name finds it');
ok(top('2048')[0] === 'merge-2048', 'a number in a name');
const like = findGames('like tetra drop', all);
ok(like.length > 5 && like.every((r) => r.entry.id !== 'tetra-drop') && like[0].entry.tags.some((t) => tagsOf('tetra-drop').includes(t)), '"like Tetra Drop" finds similar games and not Tetra Drop itself');
ok(findGames('games similar to marble maze', all).length > 0, '"similar to ..." works');
ok(top('two player').some((id) => /kart|tag|sky/.test(id)) || top('with friends').length > 0, '"with friends" finds multiplayer and online games');
const played = (id) => (id === 'cube-dodger' ? 100 : null);
const fresh = findGames('something new', all, { best: played });
ok(fresh.length > 10 && fresh.every((r) => r.entry.id !== 'cube-dodger'), '"something new" leaves out games you have already played');
ok(findGames('my favourites', all, { best: played })[0]?.entry.id === 'cube-dodger', '"my favourites" finds games you have scored in');
ok(findGames('zxqv', all).length === 0 && findGames('', all).length === 0 && findGames('   ', all).length === 0 && findGames('the a of', all).length === 0, 'nonsense, nothing, and only filler words find nothing');
ok(findGames('<script>alert(1)</script>', all).every((r) => r.entry.id), 'odd characters do not break it');
ok(findGames('racing', all).every((r) => r.why.length > 0 && r.why.length <= 3), 'every result says why it matched');
ok(findGames('racing', all).every((r, i, a) => i === 0 || a[i - 1].score >= r.score), 'results are best first');
ok(findGames('RaCiNg', all).length === findGames('racing', all).length, 'capital letters make no difference');
ok(findByName('tetra drop', all)?.id === 'tetra-drop' && findByName('tetrs drop', all)?.id === 'tetra-drop' && findByName('qqqq', all) === null, 'finding a game by (misspelt) name');
ok(didYouMean('tetrs', all).some((e) => e.id === 'tetra-drop'), '"did you mean" suggests close names');
ok(didYouMean('xx', all).length === 0, '...and nothing for tiny nonsense');
// not the blocked ones: the menu removes blocked games before asking, so a smaller list never returns the missing game
const noKart = all.filter((e) => !/kart/.test(e.id));
ok(findGames('kart', noKart).every((r) => !/kart/.test(r.entry.id)), 'games left out of the list are never found');
let seq = [0.1, 0.5, 0.9, 0.3]; let i = 0; const rnd = () => seq[i++ % seq.length];
const pick = surprise(CATALOG, { best: (id) => (id === 'cube-dodger' ? 9 : null), rand: rnd });
ok(pick && pick.id !== 'cube-dodger', 'surprise favours games you have not played');
ok(surprise([], {}) === null, 'surprise with nothing to pick is null');
const everyone = CATALOG.filter((e) => e.id !== 'x');
ok(new Set(Array.from({ length: 60 }, (_, k) => surprise(everyone, { rand: () => ((k * 37) % 100) / 100 })?.id)).size > 15, 'surprise gives a good variety');
const t0 = performance.now(); for (let k = 0; k < 200; k++) findGames('relaxing racing with friends like tetra drop', all); ok(performance.now() - t0 < 1500, 'it is fast enough to run on every keypress', `${Math.round(performance.now() - t0)} ms for 200`);
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll finder checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
