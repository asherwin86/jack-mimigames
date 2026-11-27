/**
 * The game finder: type what you feel like playing and it ranks the games. No internet, no paid service: it understands a list
 * of everyday words (moods, genres, sports, "with friends", "quick", typos, "like Tetra Drop") and otherwise falls back to
 * matching the words against names, descriptions, controls and tags. It does not "know" anything beyond that list, so a word it
 * has never heard of just searches the text.
 *
 *   findGames(query, entries, { best })  ->  [{ entry, score, why: ['racing', ...] }]  (best first, only real matches)
 *   surprise(entries, { best, rand })    ->  one entry, favouring games you have not played
 */

const STOP = new Set(('a an the and or of to for with in on at is are be it its my me i we you some any something anything game games ' +
  'play playing want wanna like find show give need looking look good fun nice cool best new more really very kind type that this ' +
  'one thing things please can could would should let lets').split(' '));

// word -> [tag or keyword, weight]. A tag is one of the catalogue's tags; a keyword matches the description text.
const SYN = {
  relax: [['puzzle', 3], ['memory', 3], ['sandbox', 3], ['timing', 1]], relaxing: [['puzzle', 3], ['memory', 3], ['sandbox', 3], ['timing', 1]],
  relaxed: [['puzzle', 3], ['memory', 3], ['sandbox', 3]], calm: [['puzzle', 3], ['memory', 3], ['sandbox', 3]], chill: [['puzzle', 3], ['memory', 3], ['sandbox', 3]],
  peaceful: [['puzzle', 3], ['sandbox', 3]], easy: [['puzzle', 2], ['memory', 2], ['timing', 2]], gentle: [['puzzle', 3], ['sandbox', 2]],
  think: [['puzzle', 4], ['strategy', 3]], thinking: [['puzzle', 4], ['strategy', 3]], brain: [['puzzle', 4], ['memory', 3], ['strategy', 3]],
  smart: [['puzzle', 3], ['strategy', 3]], logic: [['puzzle', 4]], solve: [['puzzle', 4]], riddle: [['puzzle', 3]],
  hard: [['skill', 3], ['reflex', 3]], difficult: [['skill', 3], ['reflex', 3]], challenging: [['skill', 3], ['reflex', 3], ['strategy', 2]], challenge: [['skill', 3], ['reflex', 2]],
  fast: [['reflex', 4], ['runner', 3], ['racing', 3], ['arcade', 2]], quick: [['reflex', 3], ['arcade', 3], ['timing', 2]], speed: [['racing', 4], ['reflex', 3], ['runner', 3]],
  short: [['arcade', 3], ['reflex', 2], ['timing', 2]], arcade: [['arcade', 4]], classic: [['arcade', 3], ['puzzle', 1]], retro: [['arcade', 3]],
  race: [['racing', 5]], racing: [['racing', 5]], racer: [['racing', 5]], car: [['racing', 5]], cars: [['racing', 5]], drive: [['racing', 4]], driving: [['racing', 4]],
  kart: [['racing', 5]], karts: [['racing', 5]], drift: [['racing', 4]], vehicle: [['racing', 3]], lap: [['racing', 3]], laps: [['racing', 3]],
  shoot: [['shooter', 5], ['aim', 3]], shooting: [['shooter', 5], ['aim', 3]], shooter: [['shooter', 5]], gun: [['shooter', 4], ['aim', 3]], guns: [['shooter', 4]],
  blast: [['shooter', 4]], aim: [['aim', 5]], target: [['aim', 4]], targets: [['aim', 4]], archery: [['aim', 4], ['sport', 2]], arrows: [['aim', 3]],
  fight: [['fighting', 5], ['shooter', 2]], fighting: [['fighting', 5]], battle: [['fighting', 4], ['shooter', 3], ['strategy', 2]], war: [['strategy', 3], ['shooter', 3]], combat: [['fighting', 4], ['shooter', 3]],
  chase: [['chase', 5]], chased: [['chase', 5]], tag: [['chase', 4]], escape: [['chase', 4], ['runner', 3], ['survival', 3]], hide: [['chase', 3]],
  run: [['runner', 5]], running: [['runner', 5]], runner: [['runner', 5]], endless: [['runner', 4], ['arcade', 3]], dodge: [['reflex', 4], ['runner', 3]], dodging: [['reflex', 4]],
  jump: [['platformer', 5]], jumping: [['platformer', 5]], platform: [['platformer', 5]], platformer: [['platformer', 5]], hop: [['platformer', 4]], climb: [['platformer', 3]],
  fly: [['flight', 5]], flying: [['flight', 5]], flight: [['flight', 5]], plane: [['flight', 5]], planes: [['flight', 5]], glide: [['flight', 4]], glider: [['flight', 4]], sky: [['flight', 3]],
  space: [['space', 5], ['flight', 2], ['shooter', 1]], rocket: [['space', 4], ['flight', 3]], galaxy: [['space', 4]], alien: [['space', 3], ['shooter', 3]], aliens: [['space', 3], ['shooter', 3]], asteroid: [['space', 4], ['shooter', 3]], asteroids: [['space', 4], ['shooter', 3]],
  music: [['rhythm', 5]], rhythm: [['rhythm', 5]], beat: [['rhythm', 4]], beats: [['rhythm', 4]], dance: [['rhythm', 4]], song: [['rhythm', 3]],
  memory: [['memory', 5]], remember: [['memory', 5]], match: [['memory', 3], ['puzzle', 2]], matching: [['memory', 3], ['puzzle', 2]], cards: [['memory', 3], ['strategy', 2]], card: [['strategy', 3], ['memory', 2]],
  build: [['sandbox', 5]], building: [['sandbox', 5]], create: [['sandbox', 4]], creative: [['sandbox', 5]], minecraft: [['sandbox', 5], ['survival', 2]], blocks: [['sandbox', 3], ['puzzle', 2]], block: [['sandbox', 3], ['puzzle', 2]], world: [['sandbox', 3]], explore: [['sandbox', 4], ['survival', 2]],
  survive: [['survival', 5]], survival: [['survival', 5]], zombie: [['survival', 4], ['shooter', 3]], zombies: [['survival', 4], ['shooter', 3]], scary: [['survival', 3], ['chase', 2]],
  strategy: [['strategy', 5]], tactics: [['strategy', 4]], plan: [['strategy', 3]], board: [['strategy', 4]], chess: [['strategy', 5]], checkers: [['strategy', 5]], tower: [['strategy', 3]], defense: [['strategy', 4]], defend: [['strategy', 3]],
  puzzle: [['puzzle', 5]], puzzles: [['puzzle', 5]], maze: [['puzzle', 3], ['skill', 2]], tetris: [['puzzle', 5]], merge: [['puzzle', 3]], slide: [['puzzle', 3]], word: [['puzzle', 3]], words: [['puzzle', 3]],
  sport: [['sport', 5]], sports: [['sport', 5]], ball: [['sport', 4]], balls: [['sport', 3]], soccer: [['sport', 5]], football: [['sport', 5]], basketball: [['sport', 5]], golf: [['sport', 5]], bowling: [['sport', 5]], tennis: [['sport', 5]], hockey: [['sport', 5]], baseball: [['sport', 5]], pool: [['sport', 4]], billiards: [['sport', 4]], fishing: [['sport', 3], ['skill', 2]], ski: [['sport', 4], ['reflex', 2]], skiing: [['sport', 4]], dart: [['sport', 3], ['aim', 4]], darts: [['sport', 3], ['aim', 4]],
  timing: [['timing', 5]], click: [['reflex', 2], ['timing', 2]], tap: [['reflex', 3], ['timing', 3]], reaction: [['reflex', 5]], reflex: [['reflex', 5]], reflexes: [['reflex', 5]],
  skill: [['skill', 5]], skilled: [['skill', 4]], physics: [['physics', 5]], gravity: [['physics', 4]], bounce: [['physics', 4]], bouncing: [['physics', 4]], marble: [['physics', 3]],
  physical: [['physics', 3]], simple: [['arcade', 2], ['puzzle', 2], ['timing', 2]], kids: [['puzzle', 2], ['arcade', 2], ['memory', 2]],
};
// Phrases (checked on the whole query before it is split into words).
const PHRASES = [
  [/(two|2|2-)\s*(player|players|person)|with (a )?friends?|multiplayer|\bversus\b|\bvs\b|against (a )?(friend|someone|people)|online|co-?op|together/, 'players'],
  [/(\b1\b|one)\s*min|a minute|few minutes|short game|quick game|in a hurry|not much time/, 'quick'],
  [/something new|never played|haven'?t played|unplayed|different|surprise/, 'new'],
  [/(my )?(favou?rite|best score|again)|played before/, 'played'],
];
const MULTI_HINT = /two[- ]player|2[- ]player|versus|\bvs\b|multiplayer|online|co-?op|against a friend|friends/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ers|er|es|s|ed)$/, '') : w.replace(/s$/, ''));

function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const words = (s) => norm(s).split(' ').filter(Boolean);
const entryText = (e) => norm(`${e.name} ${e.blurb || ''} ${e.controls || ''} ${(e.tags || []).join(' ')}`);

/** Finds the entry a name was typed for ("tetra drop", "tetra", "tetrs drop"), tolerating a typo. Null when nothing is close. */
export function findByName(text, entries) {
  const t = norm(text);
  if (!t) return null;
  let best = null, bestScore = 0;
  for (const e of entries) {
    const n = norm(e.name);
    let s = 0;
    if (n === t) s = 100;
    else if (n.startsWith(t)) s = 80;
    else if (n.includes(t)) s = 60;
    else {
      const tw = words(t), nw = words(n);
      const hits = tw.filter((w) => w.length > 2 && nw.some((x) => x === w || (w.length >= 4 && editDistance(w, x) <= 1))).length;
      if (hits) s = 30 + (hits / Math.max(tw.length, 1)) * 30;
    }
    if (s > bestScore) { best = e; bestScore = s; }
  }
  return bestScore >= 55 ? best : null;
}

/** Ranks `entries` for a typed query. `opts.best(id)` returns a saved score or null (used for "something new"). */
export function findGames(query, entries, opts = {}) {
  const best = opts.best || (() => null);
  const raw = norm(query);
  if (!raw) return [];

  // "like X": similar to a game they name.
  const likeMatch = raw.match(/(?:like|similar to|same as|more like|something like)\s+(.+)$/);
  if (likeMatch) {
    const ref = findByName(likeMatch[1], entries);
    if (ref) {
      const refTags = new Set(ref.tags || []);
      const out = entries.filter((e) => e.id !== ref.id).map((e) => {
        const shared = (e.tags || []).filter((t) => refTags.has(t));
        return { entry: e, score: shared.length * 5 + (shared.length && e.tags?.[0] === ref.tags?.[0] ? 2 : 0), why: shared.length ? [`like ${ref.name}: ${shared.join(', ')}`] : [] };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
      if (out.length) return out;
    }
  }

  const flags = {};
  let rest = raw;
  for (const [re, flag] of PHRASES) if (re.test(rest)) { flags[flag] = true; rest = rest.replace(re, ' '); }
  const toks = words(rest).filter((w) => !STOP.has(w) && w.length > 0);
  if (!toks.length && !Object.keys(flags).length) return [];

  // What each word is asking for: tags with weights.
  const wantTags = new Map();
  const note = (tag, weight, why) => { const cur = wantTags.get(tag); if (!cur || cur.weight < weight) wantTags.set(tag, { weight, why }); };
  const known = new Set();
  for (const w of toks) {
    const hit = SYN[w] || SYN[stem(w)];
    if (hit) { known.add(w); for (const [tag, wt] of hit) note(tag, wt, w); }
  }

  const results = [];
  for (const e of entries) {
    const name = norm(e.name), nameWords = words(e.name), text = entryText(e), tags = e.tags || [];
    let score = 0;
    const why = [];
    for (const w of toks) {
      let s = 0;
      if (name === w) s += 12;
      else if (nameWords.includes(w)) s += 9;
      else if (name.startsWith(w) && w.length >= 3) s += 7;
      else if (name.includes(w) && w.length >= 3) s += 5;
      else if (w.length >= 4 && nameWords.some((x) => editDistance(w, x) <= 1)) s += 5;   // a typo in the name
      if (!s && w.length >= 3 && text.split(' ').some((x) => x === w || stem(x) === stem(w))) s += 2;   // somewhere in the text
      if (s) { score += s; why.push(`“${w}”`); }
    }
    for (const [tag, { weight, why: w }] of wantTags) {
      if (tags.includes(tag)) { score += weight; if (!why.includes(tag)) why.unshift(tag); }
    }
    if (flags.players) {
      if (MULTI_HINT.test(`${e.blurb} ${e.controls}`) || e.kind === 'page') { score += 6; why.push('two players or online'); }
    }
    if (flags.quick && (tags.includes('arcade') || tags.includes('reflex') || tags.includes('timing'))) { score += 3; why.push('quick'); }
    if (flags.new && best(e.id) === null && e.kind !== 'arcade') { score += 4; why.push('not played yet'); }
    if (flags.played && best(e.id) !== null) { score += 4; why.push('you have played it'); }
    if (score > 0) results.push({ entry: e, score, why: [...new Set(why)].slice(0, 3) });
  }
  // Flag-only queries ("something new") need a stable, interesting order: unplayed first, then catalogue order.
  return results.sort((a, b) => b.score - a.score || (a.entry.n ?? 9999) - (b.entry.n ?? 9999) || a.entry.name.localeCompare(b.entry.name));
}

/** Close names for a query that found nothing ("Did you mean ...?"). */
export function didYouMean(query, entries, max = 3) {
  const t = norm(query);
  if (t.length < 3) return [];
  return entries.map((e) => ({ e, d: Math.min(...words(e.name).map((w) => editDistance(t.replace(/\s+/g, ''), w, 3)), editDistance(t.replace(/\s+/g, ''), norm(e.name).replace(/\s+/g, ''), 3)) }))
    .filter((x) => x.d <= 3).sort((a, b) => a.d - b.d).slice(0, max).map((x) => x.e);
}

/** One game for "Surprise me", favouring ones that have not been played. */
export function surprise(entries, { best = () => null, rand = Math.random } = {}) {
  if (!entries.length) return null;
  const fresh = entries.filter((e) => best(e.id) === null);
  const pool = fresh.length && rand() < 0.8 ? fresh : entries;
  return pool[Math.floor(rand() * pool.length)];
}
