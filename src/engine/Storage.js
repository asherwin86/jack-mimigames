const KEY = 'mg.scores.v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export const Scores = {
  best(id) {
    const v = readAll()[id];
    return typeof v === 'number' ? v : null;
  },

  /**
   * Record a run. `higherIsBetter: false` suits time-attack games where a
   * smaller number wins. Returns true when it beat the stored best.
   */
  submit(id, score, higherIsBetter = true) {
    const all = readAll();
    const prev = all[id];
    const better = typeof prev !== 'number'
      || (higherIsBetter ? score > prev : score < prev);
    if (better) {
      all[id] = score;
      try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
    }
    return better;
  },

  played() { return Object.keys(readAll()).length; },
  reset() { localStorage.removeItem(KEY); },
};
