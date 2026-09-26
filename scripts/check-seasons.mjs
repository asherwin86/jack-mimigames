/** School holidays and their random menu colours.   node scripts/check-seasons.mjs */
import { isSchoolHoliday, themeFor, randomPalette, flashColour, ARCADE_COLOURS, SCHOOL_HOLIDAYS } from '../src/engine/Seasons.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
const d = (y, m, day) => new Date(y, m - 1, day);

ok(isSchoolHoliday(d(2026, 9, 26)) && isSchoolHoliday(d(2026, 9, 19)) && isSchoolHoliday(d(2026, 10, 4)) && !isSchoolHoliday(d(2026, 10, 5)) && !isSchoolHoliday(d(2026, 9, 18)), 'the September 2026 holidays are 19 Sep to 4 Oct');
ok(isSchoolHoliday(d(2026, 4, 3)) && isSchoolHoliday(d(2026, 4, 19)) && !isSchoolHoliday(d(2026, 4, 20)), 'the April 2026 holidays are 3 to 19 April');
ok(isSchoolHoliday(d(2026, 6, 27)) && isSchoolHoliday(d(2026, 7, 12)) && !isSchoolHoliday(d(2026, 7, 13)), 'the July 2026 holidays are 27 Jun to 12 Jul');
ok(isSchoolHoliday(d(2026, 12, 25)) && isSchoolHoliday(d(2027, 1, 10)) && !isSchoolHoliday(d(2027, 1, 27)), 'the summer holidays run over Christmas and the new year');
ok(themeFor(d(2026, 8, 12)) === null && themeFor(d(2026, 11, 3)) === null, 'an ordinary school day has no theme');
ok(themeFor(d(2026, 12, 25))?.id === 'holidays' && themeFor(d(2026, 10, 31)) === null, 'Christmas Day only gets colours because it is in the holidays; Halloween in term time gets none');
ok(themeFor(d(2026, 9, 26), 'off') === null && themeFor(d(2026, 8, 12), 'holidays')?.id === 'holidays', 'the ?season= override forces or switches off the holiday colours');
for (const r of SCHOOL_HOLIDAYS) ok(r[0] <= r[1] && /^\d{4}-\d\d-\d\d$/.test(r[0]) && /^\d{4}-\d\d-\d\d$/.test(r[1]), `holiday range ${r[0]}..${r[1]} is well formed`);
ok(SCHOOL_HOLIDAYS.every((r, i) => i === 0 || r[0] > SCHOOL_HOLIDAYS[i - 1][1]), 'holiday ranges do not overlap');
const orders = new Set();
let all = true;
for (let i = 0; i < 60; i++) { const p = randomPalette(); if (p.length !== ARCADE_COLOURS.length || [...p].sort().join() !== [...ARCADE_COLOURS].sort().join()) all = false; orders.add(p.join()); }
ok(all, 'every random palette contains every arcade colour exactly once (7 colours)');
ok(orders.size > 50, 'the colours come in a different order almost every time', String(orders.size));
ok(ARCADE_COLOURS.length === 7 && ARCADE_COLOURS.every((c) => /^#[0-9a-f]{6}$/i.test(c)), 'the arcade colours are valid hex');
ok(themeFor(d(2026, 9, 26)).palette.length === 7, 'the holiday theme uses all seven colours');
const pal = ['#ff0000', '#00ff00', '#0000ff'];
ok(flashColour(pal, 0.95) === '#ff0000' && flashColour(pal, 1.95) === '#00ff00' && flashColour(pal, 2.95) === '#0000ff' && flashColour(pal, 3.95) === '#ff0000', 'each colour holds solid, one after another, and it loops');
const seen = new Set();
for (let k = 0; k < 7; k++) seen.add(flashColour(ARCADE_COLOURS, k + 0.9));
ok(seen.size === 7, 'over seven seconds it shows all seven colours');
const mid = flashColour(pal, 1.15);
ok(mid !== '#00ff00' && mid !== '#ff0000' && flashColour(pal, 1.4) === '#00ff00', 'colours fade in over 0.3 s, then hold');
let changes = 0; let prev = flashColour(pal, 0);
for (let ms = 10; ms < 3000; ms += 10) { const c = flashColour(pal, ms / 1000); if (c !== prev) { changes++; prev = c; } }
ok(changes > 0, 'the colour does change over time');
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll season checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
