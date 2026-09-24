import { CATALOG, BY_ID } from '../games/catalog.js';
import { Rocoins } from './Rocoins.js';
import { Scores } from './Storage.js';

/**
 * Challenges: the only way to earn Rocoins.
 *
 *   goals        every game has three score targets (easy / medium / hard),
 *                each worth Rocoins once
 *   daily        three games a day (the same for everyone on a given date)
 *                with a fresh medium target — this is what refills your wallet
 *   everywhere   one-off badges for playing a lot / playing a variety
 *
 * Nothing here draws anything; the admin panel reads these and main.js reports
 * finished runs. Scores are always the game's real score — powers never change
 * one, so they can't be used to fake a challenge.
 */

export const TIERS = ['Easy', 'Medium', 'Hard'];
export const REWARDS = [5, 12, 30];
export const DAILY_REWARD = 10;

/** Easy / medium / hard targets. For time-attack games (marble-maze,
 *  maze-escape) smaller is harder, so the numbers go down. Sandbox games are
 *  measured in minutes played, Kart Circuit in race wins. */
export const GOALS = {
  'cube-dodger':      [150, 400, 900],
  'sky-hoops':        [4, 9, 16],
  'block-stacker':    [6, 14, 25],
  'whack-a-cube':     [300, 700, 1200],
  'marble-maze':      [45, 28, 18],
  'asteroid-blaster': [500, 1500, 3500],
  'simon-cubes':      [5, 9, 14],
  'paddle-rally':     [6, 15, 30],
  'platform-hop':     [5, 12, 25],
  'gem-grab':         [6, 15, 30],
  'snake-cube':       [8, 16, 30],
  'sumo-arena':       [2, 5, 10],
  'tunnel-run':       [8, 20, 40],
  'beat-lanes':       [2000, 6000, 12000],
  'colour-rush':      [300, 900, 2000],
  'maze-escape':      [90, 55, 35],
  'brick-wall':       [300, 800, 1600],
  'lava-floor':       [15, 35, 70],
  'orbit-dodge':      [5, 12, 25],
  'artillery-duel':   [300, 700, 1200],
  'blockcraft':       [10, 30, 90],
  'fruit-slice':      [15, 40, 90],
  'wrecking-ball':    [15, 40, 80],
  'frog-hopper':      [2, 5, 10],
  'hurdle-runner':    [150, 400, 900],
  'free-throw':       [8, 20, 40],
  'plate-spinner':    [30, 75, 150],
  'grapple-gap':      [60, 150, 300],
  'skeet-range':      [5, 12, 25],
  'arena-fighter':    [30, 80, 150],
  'kart-circuit':     [1, 3, 10],
};

/** Games whose challenge is "play for N minutes" instead of a score. */
const isMinutes = (entry) => entry.sandbox === true;

/** Games that pick their targets from a finished run (everything but the
 *  sandbox and the kart racer, which report through their own hooks). */
export const RUN_GAMES = CATALOG.filter((e) => !e.sandbox && !e.customStart);

/** How each score unit reads as a target: "Cover 400 metres in Hurdle Runner". */
const UNIT_TEXT = {
  pts: (n, g) => `Score ${n} points in ${g}`,
  m: (n, g) => `Cover ${n} metres in ${g}`,
  rings: (n, g) => `Fly through ${n} rings in ${g}`,
  floors: (n, g) => `Reach ${n} floors in ${g}`,
  rounds: (n, g) => `Match ${n} rounds in ${g}`,
  rally: (n, g) => `Keep a rally of ${n} going in ${g}`,
  gems: (n, g) => `Grab ${n} gems in ${g}`,
  pushed: (n, g) => `Push ${n} opponents out in ${g}`,
  walls: (n, g) => `Clear ${n} walls in ${g}`,
  stars: (n, g) => `Collect ${n} stars in ${g}`,
  crossings: (n, g) => `Cross ${n} times in ${g}`,
  dmg: (n, g) => `Deal ${n} damage in ${g}`,
  long: (n, g) => `Grow to length ${n} in ${g}`,
  s: (n, g) => `Last ${n} seconds in ${g}`,
};

function goalText(entry, at) {
  if (isMinutes(entry)) return `Play ${entry.name} for ${at} minutes`;
  if (entry.id === 'kart-circuit') return `Win ${at} race${at === 1 ? '' : 's'}`;
  if (entry.higherIsBetter === false) return `Finish ${entry.name} in ${at} seconds or less`;
  return (UNIT_TEXT[entry.unit] || ((n, g) => `Score ${n} ${entry.unit || 'points'} in ${g}`))(at, entry.name);
}

/** Is `value` good enough for a target `at` in this game? */
export function meets(entry, value, at) {
  return entry.higherIsBetter === false ? value <= at : value >= at;
}

/** The three targets for one game. */
export function gameChallenges(entry) {
  const goals = GOALS[entry.id];
  if (!goals) return [];
  return goals.map((at, i) => ({
    id: `goal:${entry.id}:${i}`, kind: 'goal', gameId: entry.id, tier: TIERS[i], at,
    reward: REWARDS[i], text: goalText(entry, at),
  }));
}

// ---------- daily ----------

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Small deterministic hash so a date always picks the same games. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Today's three challenges: three different games, medium target each. */
export function dailyChallenges(dateKey = todayKey()) {
  const pool = RUN_GAMES.map((e) => e.id);
  const picks = [];
  let salt = 0;
  while (picks.length < 3 && salt < 200) {
    const id = pool[hash(`${dateKey}:${salt++}`) % pool.length];
    if (!picks.includes(id)) picks.push(id);
  }
  return picks.map((gameId) => {
    const entry = BY_ID.get(gameId);
    const at = GOALS[gameId][1];
    return {
      id: `daily:${dateKey}:${gameId}`, kind: 'daily', gameId, tier: 'Daily', at,
      reward: DAILY_REWARD, text: `${goalText(entry, at)} — today only`,
    };
  });
}

// ---------- everywhere ----------

const distinct = (c) => Object.values(c.played).filter((n) => n > 0).length;

export const EVERYWHERE = [
  { id: 'all:first-run',   reward: 5,   text: 'Finish your first run',                  have: (c) => c.runs,     need: 1 },
  { id: 'all:runs-25',     reward: 15,  text: 'Finish 25 runs',                         have: (c) => c.runs,     need: 25 },
  { id: 'all:runs-100',    reward: 40,  text: 'Finish 100 runs',                        have: (c) => c.runs,     need: 100 },
  { id: 'all:variety-5',   reward: 10,  text: 'Finish a run in 5 different games',      have: distinct,          need: 5 },
  { id: 'all:variety-15',  reward: 25,  text: 'Finish a run in 15 different games',     have: distinct,          need: 15 },
  { id: 'all:variety-all', reward: 100, text: `Finish a run in all ${RUN_GAMES.length} score games`, have: distinct, need: RUN_GAMES.length },
  { id: 'all:pb-5',        reward: 10,  text: 'Beat your personal best 5 times',        have: (c) => c.pbs,      need: 5 },
  { id: 'all:pb-25',       reward: 30,  text: 'Beat your personal best 25 times',       have: (c) => c.pbs,      need: 25 },
].map((c) => ({ ...c, kind: 'everywhere' }));

// ---------- awarding ----------

const earnedListeners = new Set();

/** Calls fn([{ id, text, reward }]) whenever challenges pay out (so the UI can say so). */
export function onEarned(fn) { earnedListeners.add(fn); return () => earnedListeners.delete(fn); }

/** Pays every unpaid challenge in `list` for which `test(ch)` is true. */
function award(list, test) {
  const out = [];
  for (const ch of list) {
    if (Rocoins.isDone(ch.id) || !test(ch)) continue;
    if (Rocoins.complete(ch.id, ch.reward)) out.push({ id: ch.id, text: ch.text, reward: ch.reward });
  }
  return out;
}

/** award() over several lists at once, announcing the lot together. */
function awardAll(...groups) {
  const out = groups.flat();
  if (out.length) for (const fn of [...earnedListeners]) { try { fn(out); } catch (e) { console.error(e); } }
  return out;
}

const checkEverywhere = () => {
  const c = Rocoins.counters();
  return award(EVERYWHERE, (ch) => ch.have(c) >= ch.need);
};

/** Score-based targets (and today's dailies) for one game. */
function checkScore(entry, value) {
  const list = [...gameChallenges(entry), ...dailyChallenges().filter((d) => d.gameId === entry.id)];
  return award(list, (ch) => meets(entry, value, ch.at));
}

/**
 * A run just ended with `score`. Call this BEFORE the score is stored, so it
 * can tell whether it was a personal best. Returns what was earned:
 * [{ id, text, reward }].
 */
export function runFinished(entry, score) {
  if (!entry || !Number.isFinite(score)) return [];
  const prev = Scores.best(entry.id);
  const higher = entry.higherIsBetter !== false;
  const pb = prev === null || (higher ? score > prev : score < prev);
  Rocoins.countRun(entry.id, pb);
  return awardAll(checkScore(entry, score), checkEverywhere());
}

/** A game with its own progress counter (Kart Circuit's wins) reached `value`. */
export function valueReached(entry, value) {
  if (!entry || !Number.isFinite(value)) return [];
  return awardAll(checkScore(entry, value));
}

/** Time spent in a sandbox game; pays its "play for N minutes" targets. */
export function minutesPlayed(entry, mins) {
  if (!entry || !isMinutes(entry) || !(mins > 0)) return [];
  Rocoins.addMinutes(entry.id, mins);
  const total = Rocoins.counters().minutes[entry.id] || 0;
  return awardAll(award(gameChallenges(entry), (ch) => total >= ch.at));
}

/** For the panel: progress towards a sandbox game's minutes targets. */
export function minutesSoFar(entry) { return Rocoins.counters().minutes[entry.id] || 0; }
