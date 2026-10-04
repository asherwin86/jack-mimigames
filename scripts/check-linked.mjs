/**
 * The tiles that are not built-in games (the sister arcade and the Unity games, src/engine/LinkedGames.js): their data,
 * that the Unity builds are complete, how the website and the apps build (the big files are website-only), and that the
 * offline cache never touches them. Runs two real builds, so it takes a few seconds.
 *
 *   node scripts/check-linked.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { LINKED, SITE_URL, linkedUrl } = await import('../src/engine/LinkedGames.js');
let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
const root = new URL('..', import.meta.url).pathname;
const exists = (p) => fs.existsSync(path.join(root, p));

// ---- data
ok(LINKED.length >= 4 && new Set(LINKED.map((l) => l.id)).size === LINKED.length, 'linked tiles have unique ids');
ok(LINKED.every((l) => ['page', 'arcade'].includes(l.kind) && l.name && l.blurb && l.badge && l.tags?.length), 'every tile has a kind, name, text, badge and tag');
const { CATALOG } = await import('../src/games/catalog.js');
ok(LINKED.every((l) => !CATALOG.some((g) => g.id === l.id)), 'no linked tile reuses a built-in game id');
const PRODUCTS = {};
for (const l of LINKED.filter((x) => x.kind === 'page')) {
  ok(l.path === `unity/${l.id}/index.html`, `${l.id}: the page path is unity/${l.id}/index.html (an explicit file, so the host never rewrites it)`);
  const dir = `unity-builds/${l.id}`;
  ok(exists(`${dir}/index.html`), `${l.id}: has its page`);
  const page = fs.readFileSync(path.join(root, dir, 'index.html'), 'utf8');
  const needed = ['Build/WebBuild.data', 'Build/WebBuild.framework.js', 'Build/WebBuild.loader.js', 'Build/WebBuild.wasm', 'TemplateData/favicon.ico', 'TemplateData/unity-logo-dark.png', 'TemplateData/progress-bar-full-dark.png'];
  ok(needed.every((f) => exists(`${dir}/${f}`)), `${l.id}: the Unity build files are all there`, needed.filter((f) => !exists(`${dir}/${f}`)).join());
  const refs = [...page.matchAll(/(?:buildUrl \+ '|url\()?['"]?((?:Build|TemplateData)\/[A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  ok(refs.every((r) => exists(`${dir}/${r}`)), `${l.id}: every file the page mentions exists`, refs.filter((r) => !exists(`${dir}/${r}`)).join());
  ok(fs.readFileSync(path.join(root, dir, 'Build/WebBuild.wasm')).subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d])), `${l.id}: the .wasm file is a real WebAssembly file`);
  const all = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else all.push(f); } };
  walk(path.join(root, dir));
  ok(!all.some((f) => /DoNotShip|ProjectVersion\.txt$/.test(f)), `${l.id}: no Unity debug folders or ProjectVersion.txt`);
  ok(!all.some((f) => /\.(br|gz|unityweb)$/i.test(f)), `${l.id}: the files are plain (not .br / .gz), so any static host can serve them`);
  ok(all.every((f) => fs.statSync(f).size < 95 * 1024 * 1024), `${l.id}: every file is under GitHub's 100 MB limit (largest ${(Math.max(...all.map((f) => fs.statSync(f).size)) / 1048576).toFixed(0)} MB)`);
  ok(/\.\.\/\.\.\//.test(page) && /createUnityInstance/.test(page), `${l.id}: the page has a way back to the arcade and starts the game`);
  const product = /productName: '([^']+)'/.exec(page)?.[1];
  PRODUCTS[l.id] = product;
  ok(!!product && !page.includes('{{'), `${l.id}: the page is filled in (product ${product})`);
  const u = linkedUrl(l, false); const v = linkedUrl(l, true);
  ok(u === `${l.path}?fs=1` && v === `${SITE_URL}${l.path}?fs=1`, `${l.id}: on the website the tile uses the page next to it, from an app it uses the website address (${v})`);
}
ok(exists('unity-builds/tag-game/StreamingAssets/UnityServicesProjectConfiguration.json'), 'tag-game: its StreamingAssets folder came with it (the game needs it)');
ok(!/secret|password|token(?!=null)/i.test(fs.readFileSync(path.join(root, 'unity-builds/tag-game/StreamingAssets/UnityServicesProjectConfiguration.json'), 'utf8').replace(/PublicKeyToken=null/g, '')), 'tag-game: that config has no secrets in it (it is published)');
// The pages come from scripts/unity-page-template.html: regenerating each one must change nothing.
for (const l of LINKED.filter((x) => x.kind === 'page')) {
  const file = path.join(root, 'unity-builds', l.id, 'index.html');
  const before = fs.readFileSync(file, 'utf8');
  const g = spawnSync(process.execPath, ['scripts/make-unity-page.mjs', l.id, l.name, PRODUCTS[l.id]], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(file, 'utf8');
  ok(g.status === 0 && before === after, `${l.id}: its page matches what scripts/make-unity-page.mjs makes from the template`, before === after ? '' : '(regenerated it: re-run the test)');
}
ok(linkedUrl(LINKED.find((l) => l.kind === 'arcade'), true) === null, 'the 51 tile has no page address (it uses the Switch button\'s own logic)');

// ---- the offline cache and the apps
const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
ok(/\/unity\//.test(sw.split("addEventListener('fetch'")[1] || ''), 'the service worker ignores /unity/ pages and files (it would otherwise save a Unity page as the arcade home page)');
for (const wf of ['release.yml', 'android.yml']) ok(/MIMI_APP_BUILD:\s*'1'/.test(fs.readFileSync(path.join(root, '.github/workflows', wf), 'utf8')), `${wf} builds the app without the Unity games`);
const build = (env) => spawnSync('npx', ['vite', 'build'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
let r = build({ MIMI_APP_BUILD: '1' });
ok(r.status === 0 && fs.existsSync(path.join(root, 'dist/index.html')) && !fs.existsSync(path.join(root, 'dist/unity')), 'the app build (MIMI_APP_BUILD=1) has no unity folder, so the installer and APK stay small');
const appBytes = Number(spawnSync('du', ['-sb', path.join(root, 'dist')], { encoding: 'utf8' }).stdout.split('\t')[0]);
ok(appBytes < 25 * 1024 * 1024, `...and the app build is ${(appBytes / 1048576).toFixed(1)} MB`);
r = build({ MIMI_APP_BUILD: '' });
ok(r.status === 0 && fs.existsSync(path.join(root, 'dist/unity/kart-racer/index.html')) && fs.existsSync(path.join(root, 'dist/unity/kart-racer/Build/WebBuild.wasm')), 'the website build includes the Unity game');
const precache = JSON.parse(fs.readFileSync(path.join(root, 'dist/precache.json'), 'utf8'));
ok(precache.length > 50 && !precache.some((f) => /unity/i.test(f)), 'the offline cache list leaves the Unity game out (it would be a 58 MB download on the first visit)');
ok(!fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8').includes("'mimi-arcade-v1'"), 'the service worker is still stamped per build');

console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll linked-tile checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
