/** School holidays and their random menu colours.   node scripts/check-seasons.mjs */
import { isSchoolHoliday, themeFor, randomPalette, SCHOOL_HOLIDAYS } from '../src/engine/Seasons.js';

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
const varied = new Set();
let valid = true;
for (let i = 0; i < 50; i++) { const p = randomPalette(); if (p.length !== 4 || !p.every((c) => /^#[0-9a-f]{6}$/.test(c))) valid = false; varied.add(p[0]); }
ok(valid && varied.size > 40, 'random palettes are valid hex colours and differ every time');
ok(themeFor(d(2026, 9, 26)).palette.join() !== themeFor(d(2026, 9, 26)).palette.join(), 'two visits in the holidays get different colours');
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll season checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
