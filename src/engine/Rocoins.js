const KEY = 'mg.rocoins.v1';
const MAX_SLOTS = 40;
const MAX_DONE = 1500;   // ~93 game challenges + 3 a day for over a year, and still under the server's request size limit

/**
 * Where the numbers live: your Rocoins, which challenges are ticked off, and a
 * few counters the challenges look at. Kept in localStorage (so it works
 * offline) and backed up to your account by RocoinSync.js.
 *
 * It is shaped so that two devices can earn and spend while apart and still
 * merge without losing anything:
 *   done    challenge id -> [when, reward]. A union across devices.
 *   slots   one record per browser (`slot` is ours) holding counters that only
 *           ever go up: spent, refunded, bonus, runs, pbs, played, minutes.
 *           Merging takes the biggest of each, per slot, and totals add the
 *           slots up.
 * Balance = rewards of the challenges done + bonus - spent + refunded.
 *
 * The same merge runs on the account server (hub-server/server.js).
 */

// ---------- pure helpers (shared shape with the server) ----------

const int = (v, max = 1e9) => { v = Number(v); return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), max) : 0; };
const num = (v, max = 1e9) => { v = Number(v); return Number.isFinite(v) && v > 0 ? Math.min(Math.round(v * 1000) / 1000, max) : 0; };

function counts(o, frac) {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o).slice(0, 100)) if (k.length <= 60) out[k] = frac ? num(v) : int(v);
  }
  return out;
}

const blankSlot = () => ({ spent: 0, refunded: 0, bonus: 0, runs: 0, pbs: 0, t: 0, played: {}, minutes: {} });

/** Forces anything (a corrupt save, a stranger's upload) into a valid { done, slots }. */
export function cleanWallet(w) {
  const out = { done: {}, slots: {} };
  if (!w || typeof w !== 'object') return out;
  if (w.done && typeof w.done === 'object' && !Array.isArray(w.done)) {
    for (const [id, v] of Object.entries(w.done).slice(0, MAX_DONE)) {
      if (id.length <= 80 && Array.isArray(v)) out.done[id] = [int(v[0], 4e12), int(v[1], 1000)];
    }
  }
  if (w.slots && typeof w.slots === 'object' && !Array.isArray(w.slots)) {
    for (const [sid, sl] of Object.entries(w.slots).slice(0, MAX_SLOTS * 2)) {
      if (sid.length > 40 || !sl || typeof sl !== 'object') continue;
      out.slots[sid] = {
        spent: int(sl.spent), refunded: int(sl.refunded), bonus: int(sl.bonus),
        runs: int(sl.runs), pbs: int(sl.pbs), t: int(sl.t, 4e12),
        played: counts(sl.played, false), minutes: counts(sl.minutes, true),
      };
    }
  }
  return out;
}

const maxCounts = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v); return out; };

/** Combines two wallets without losing anything either one knows. */
export function mergeWallets(a, b) {
  const x = cleanWallet(a);
  const y = cleanWallet(b);
  const out = { done: { ...x.done }, slots: { ...x.slots } };
  for (const [id, v] of Object.entries(y.done)) if (!out.done[id] || v[0] < out.done[id][0]) out.done[id] = v;
  for (const [sid, sl] of Object.entries(y.slots)) {
    const m = out.slots[sid];
    out.slots[sid] = !m ? sl : {
      spent: Math.max(m.spent, sl.spent), refunded: Math.max(m.refunded, sl.refunded), bonus: Math.max(m.bonus, sl.bonus),
      runs: Math.max(m.runs, sl.runs), pbs: Math.max(m.pbs, sl.pbs), t: Math.max(m.t, sl.t),
      played: maxCounts(m.played, sl.played), minutes: maxCounts(m.minutes, sl.minutes),
    };
  }
  const ids = Object.keys(out.slots);
  if (ids.length > MAX_SLOTS) {
    ids.sort((p, q) => out.slots[q].t - out.slots[p].t);
    for (const sid of ids.slice(MAX_SLOTS)) delete out.slots[sid];
  }
  return out;
}

const newId = () => {
  try { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); } catch { /* old browser */ }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
};

// ---------- state ----------

let cache = null;
const listeners = new Set();

const blank = () => ({ owner: null, slot: newId(), done: {}, slots: {} });

function load() {
  if (cache) return cache;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY)); } catch { /* unreadable or unavailable */ }
  cache = blank();
  if (raw && typeof raw === 'object') {
    if (raw.v === 2) {
      const w = cleanWallet(raw);
      cache.done = w.done; cache.slots = w.slots;
      if (typeof raw.slot === 'string' && raw.slot && raw.slot.length <= 40) cache.slot = raw.slot;
      if (typeof raw.owner === 'string' && raw.owner) cache.owner = raw.owner;
    } else {
      // The first format kept plain totals. Carry the balance over as a bonus so nothing is lost.
      const sl = { ...blankSlot(), bonus: int(raw.coins), runs: int(raw.runs), pbs: int(raw.pbs), played: counts(raw.played, false), minutes: counts(raw.minutes, true), t: Date.now() };
      cache.slots[cache.slot] = sl;
    }
  }
  return cache;
}

function mine(s) {
  const sl = s.slots[s.slot] || (s.slots[s.slot] = blankSlot());
  sl.t = Date.now();
  return sl;
}

function totals(s) {
  const t = { reward: 0, bonus: 0, spent: 0, refunded: 0, runs: 0, pbs: 0, played: {}, minutes: {} };
  for (const [, d] of Object.entries(s.done)) t.reward += d[1];
  for (const sl of Object.values(s.slots)) {
    t.bonus += sl.bonus; t.spent += sl.spent; t.refunded += sl.refunded; t.runs += sl.runs; t.pbs += sl.pbs;
    for (const [k, v] of Object.entries(sl.played)) t.played[k] = (t.played[k] || 0) + v;
    for (const [k, v] of Object.entries(sl.minutes)) t.minutes[k] = (t.minutes[k] || 0) + v;
  }
  return t;
}

const balanceOf = (s) => { const t = totals(s); return Math.max(0, t.reward + t.bonus - t.spent + t.refunded); };

function save(fromSync = false) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, owner: cache.owner, slot: cache.slot, done: cache.done, slots: cache.slots }));
  } catch { /* private mode: lasts this session */ }
  const bal = balanceOf(cache);
  for (const fn of [...listeners]) { try { fn(bal, { fromSync }); } catch (e) { console.error(e); } }
}

export const Rocoins = {
  balance() { return balanceOf(load()); },
  /** Everything ever earned (challenge rewards and bonuses). */
  earned() { const t = totals(load()); return t.reward + t.bonus; },
  spent() { const t = totals(load()); return Math.max(0, t.spent - t.refunded); },

  /** Calls fn(balance, { fromSync }) whenever anything changes. Returns an unsubscribe. */
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Gives coins outright (a bonus). Challenges use complete() instead. */
  add(n) {
    n = Math.floor(n);
    const s = load();
    if (!(n > 0)) return balanceOf(s);
    mine(s).bonus += n;
    save();
    return balanceOf(s);
  },

  /** Takes `n` coins if you have them. Returns false (and takes nothing) if not. */
  spend(n) {
    n = Math.floor(n);
    const s = load();
    if (!(n >= 0) || balanceOf(s) < n) return false;
    if (n === 0) return true;
    mine(s).spent += n;
    save();
    return true;
  },

  /** Gives back coins that were spent on something that didn't happen. */
  refund(n) {
    n = Math.floor(n);
    const s = load();
    if (!(n > 0)) return balanceOf(s);
    mine(s).refunded += n;
    save();
    return balanceOf(s);
  },

  isDone(id) { return Boolean(load().done[id]); },

  /** Ticks a challenge off and pays its reward. False if it was already done. */
  complete(id, reward) {
    const s = load();
    if (s.done[id] || Object.keys(s.done).length >= MAX_DONE) return false;
    s.done[id] = [Date.now(), int(reward, 1000)];
    mine(s);
    save();
    return true;
  },

  counters() { const t = totals(load()); return { runs: t.runs, pbs: t.pbs, played: t.played, minutes: t.minutes }; },

  countRun(gameId, personalBest) {
    const s = load();
    const sl = mine(s);
    sl.runs += 1;
    sl.played[gameId] = (sl.played[gameId] || 0) + 1;
    if (personalBest) sl.pbs += 1;
    save();
  },

  addMinutes(gameId, mins) {
    if (!(mins > 0)) return;
    const s = load();
    const sl = mine(s);
    sl.minutes[gameId] = num((sl.minutes[gameId] || 0) + mins);
    save();
  },

  // ---------- account backup (see RocoinSync.js) ----------

  /** The account this wallet belongs to (null until it has been backed up), so one account's coins can't leak into another's. */
  owner() { return load().owner; },
  setOwner(key) { const s = load(); if (s.owner !== key) { s.owner = key; save(true); } },

  /** A copy of what gets backed up. */
  snapshot() { const s = load(); return JSON.parse(JSON.stringify({ done: s.done, slots: s.slots })); },

  /** Folds a backup in (from the account server). */
  merge(remote) {
    const s = load();
    const m = mergeWallets({ done: s.done, slots: s.slots }, remote);
    s.done = m.done; s.slots = m.slots;
    if (!s.slots[s.slot]) s.slots[s.slot] = blankSlot();
    save(true);
  },

  /** Switches this browser to another account's wallet: what was here belonged to someone else. */
  adopt(key, remote) {
    cache = blank();
    cache.owner = key;
    const m = cleanWallet(remote);
    cache.done = m.done; cache.slots = m.slots;
    save(true);
  },

  /** Wipes everything (used by tests). */
  reset() { cache = blank(); save(); },
  /** Forgets the in-memory copy so the next read comes from storage (tests). */
  _drop() { cache = null; },
};
