const KEY = 'mg.settings.v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

/** Small key/value store for display preferences. Falls back to the default
 *  whenever storage is unavailable, the way the score store does. */
export const Settings = {
  get(key, fallback) {
    const v = readAll()[key];
    return v === undefined ? fallback : v;
  },

  set(key, value) {
    const all = readAll();
    all[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
    return value;
  },

  toggle(key, fallback = true) {
    return this.set(key, !this.get(key, fallback));
  },
};
