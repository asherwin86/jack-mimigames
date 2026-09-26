/**
 * School holidays and the menu colours that go with them.
 *
 * The menu's sky normally cycles through a rainbow. During the school holidays
 * it flashes through every colour in the arcade's palette, one flat colour at a time, in a new random order each time the menu opens.
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

/** The arcade's own colours (the same ones as PALETTE in utils.js): cyan, pink, lime, amber, violet, blue, red. */
export const ARCADE_COLOURS = ['#6ee7ff', '#ff6ea9', '#7bffb0', '#ffc861', '#b08cff', '#5b8cff', '#ff5f6d'];

/** Every arcade colour, in a fresh random order (so each visit blends them differently). */
export function randomPalette(rng = Math.random) {
  const out = ARCADE_COLOURS.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

/**
 * The single colour on screen `time` seconds in: each palette colour holds for `step` seconds, fading in over `fade`
 * seconds. Two changes a second: quick and lively, but kept under three flashes a second, the usual limit for safe flashing.
 */
export function flashColour(palette, time, step = 0.5, fade = 0.15) {
  const n = palette.length;
  const k = Math.floor(time / step);
  const f = Math.min(1, Math.max(0, (time - k * step) / fade));
  const from = hexToRgb(palette[(((k - 1) % n) + n) % n]);
  const to = hexToRgb(palette[((k % n) + n) % n]);
  return rgbToHex(from.map((v, i) => v + (to[i] - v) * f));
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
