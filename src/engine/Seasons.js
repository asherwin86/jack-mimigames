/**
 * School holidays and the menu colours that go with them.
 *
 * The menu's sky normally cycles through a rainbow. During the school holidays
 * it uses a fresh random set of colours each time the menu opens.
 *
 * The dates are Victoria's (Australia). They are just a list of date ranges
 * below, so it is easy to add another year or change the state. To preview it
 * on any day, add ?season=holidays to the address (?season=off turns it off).
 */

/** [first day, last day] inclusive, as local YYYY-MM-DD. Victorian school holidays. */
export const SCHOOL_HOLIDAYS = [
  ['2025-12-20', '2026-01-26'],
  ['2026-04-03', '2026-04-19'],
  ['2026-06-27', '2026-07-12'],
  ['2026-09-19', '2026-10-04'],
  ['2026-12-19', '2027-01-26'],
  ['2027-04-02', '2027-04-18'],
  ['2027-06-26', '2027-07-11'],
  ['2027-09-18', '2027-10-03'],
  ['2027-12-18', '2028-01-26'],
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isSchoolHoliday = (date) => { const day = iso(date); return SCHOOL_HOLIDAYS.some(([a, b]) => day >= a && day <= b); };

/** A fresh, harmonious random palette of hex colours. */
export function randomPalette(rng = Math.random) {
  const base = rng() * 360;
  const scheme = [[0, 40, 80, 120], [0, 120, 240, 300], [0, 180, 30, 210], [0, 60, 180, 240]][Math.floor(rng() * 4)];
  return scheme.map((off) => hsl((base + off) % 360, 0.62 + rng() * 0.2, 0.38 + rng() * 0.08));
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The theme for a date, or null on an ordinary day: { id, label, palette: ['#rrggbb', ...] }.
 * `override` (from ?season=) forces the holiday colours ('holidays') or switches them off ('off').
 */
export function themeFor(date = new Date(), override = null, rng = Math.random) {
  if (override === 'off') return null;
  if (override === 'holidays' || isSchoolHoliday(date)) return { id: 'holidays', label: 'School holidays: new colours every visit!', palette: randomPalette(rng) };
  return null;
}

/** The ?season= value in the page address, if any. */
export function seasonOverride() {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get('season'); } catch { return null; }
}
