/**
 * The "switch to the other Windows app" module (electron/otherApp.cjs), tested with a fake file dialog and a fake
 * program launcher. Also checks the copy in 51 Mimi Games is identical, since the two projects share it by hand.
 *
 *   node scripts/check-otherapp.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createOtherApp } = createRequire(import.meta.url)('../electron/otherApp.cjs');

let failed = 0;
const ok = (c, m, d = '') => { if (!c) { failed++; console.log(`\x1b[31mFAIL\x1b[0m ${m} ${d}`); } else console.log(`\x1b[32mok\x1b[0m   ${m}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'otherapp-'));
const userData = path.join(tmp, 'userData');
const exe = path.join(tmp, '51 Mimi Games.exe');
const selfExe = path.join(tmp, '100 Mimi Games.exe');
const notExe = path.join(tmp, 'readme.txt');
fs.writeFileSync(exe, 'x'); fs.writeFileSync(selfExe, 'x'); fs.writeFileSync(notExe, 'x');
fs.mkdirSync(path.join(tmp, 'folder.exe'));

function make(over = {}) {
  const calls = { dialog: [], spawn: [], quit: 0 };
  const dialogAnswer = over.dialogAnswer ?? { canceled: false, filePaths: [exe] };
  const api = createOtherApp({
    otherName: '51 Mimi Games', exeName: '51 Mimi Games.exe', userDataDir: userData, selfExe, platform: 'win32', fs,
    localAppData: over.localAppData ?? path.join(tmp, 'Local'),
    showOpenDialog: async (o) => { calls.dialog.push(o); return dialogAnswer; },
    spawn: over.spawn ?? ((p, a, o) => { calls.spawn.push([p, a, o]); const c = new EventEmitter(); c.unref = () => { calls.unref = true; }; setImmediate(() => c.emit('spawn')); return c; }),
    quit: () => { calls.quit++; },
    ...over.opts,
  });
  return { api, calls };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- before anything is chosen
{
  const { api, calls } = make();
  ok(api.supported && api.info().name === '51 Mimi Games', 'on Windows it is supported and knows the other app\'s name');
  ok(api.status().path === null && api.status().exists === false, 'nothing is saved to begin with');
  const r = await api.launch();
  ok(r.ok === false && r.needsChoose === true && calls.spawn.length === 0 && calls.quit === 0, 'launching with no location asks you to choose, and starts nothing');
}
// ---- choosing
{
  const { api, calls } = make();
  const c = await api.choose();
  ok(c.ok && c.path === exe, 'choosing a real .exe saves it');
  ok(calls.dialog[0].properties.includes('openFile') && calls.dialog[0].filters[0].extensions[0] === 'exe' && /51 Mimi Games/.test(calls.dialog[0].title), 'the file picker is titled for the other app and only shows .exe files');
  ok(api.status().path === exe && api.status().exists === true, 'the saved location is remembered...');
  ok(JSON.parse(fs.readFileSync(path.join(userData, 'other-app.json'), 'utf8')).path === exe, '...in the app data folder');
  ok(make().api.status().path === exe, '...and survives a restart (a fresh module reads it back)');
}
{
  const { api } = make({ dialogAnswer: { canceled: true, filePaths: [] } });
  const c = await api.choose();
  ok(c.ok === false && c.canceled === true, 'cancelling the picker changes nothing');
}
for (const [label, file, expect] of [['a file that is not an .exe', notExe, /\.exe/], ['this very app', selfExe, /this app/], ['a folder named .exe', path.join(tmp, 'folder.exe'), /not a file/], ['a file that does not exist', path.join(tmp, 'gone.exe'), /find/i]]) {
  fs.rmSync(path.join(userData, 'other-app.json'), { force: true });
  const { api } = make({ dialogAnswer: { canceled: false, filePaths: [file] } });
  const c = await api.choose();
  ok(c.ok === false && expect.test(c.msg) && api.status().path === null, `picking ${label} is refused and not saved`, c.msg);
}
{
  const g = path.join(tmp, 'Local', 'Programs', '51 Mimi Games');
  fs.mkdirSync(g, { recursive: true }); fs.writeFileSync(path.join(g, '51 Mimi Games.exe'), 'x');
  const { api, calls } = make();
  await api.choose();
  ok(calls.dialog[0].defaultPath === path.join(g, '51 Mimi Games.exe'), 'the picker starts in the normal install folder when the app is there');
  const none = make({ opts: { localAppData: path.join(tmp, 'nowhere') } });
  await none.api.choose();
  ok(none.calls.dialog[0].defaultPath === undefined, '...and just uses the default folder when it is not');
}
// ---- launching
{
  fs.rmSync(path.join(userData, 'other-app.json'), { force: true });
  const { api, calls } = make();
  await api.choose();
  const r = await api.launch();
  ok(r.ok === true && calls.spawn.length === 1 && calls.spawn[0][0] === exe, 'launch starts the chosen program');
  ok(calls.spawn[0][2].detached === true && calls.spawn[0][2].stdio === 'ignore' && calls.spawn[0][2].cwd === tmp && calls.unref === true, '...detached, so it outlives this app, from its own folder');
  ok(calls.quit === 0, 'this app has not closed yet when the reply goes out');
  await wait(600);
  ok(calls.quit === 1, '...it closes itself right after');
}
{
  const { api, calls } = make({ spawn: () => { const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit('error', new Error('spawn EACCES'))); return c; } });
  await api.choose();
  const r = await api.launch();
  await wait(600);
  ok(r.ok === false && /Couldn't start 51 Mimi Games/.test(r.msg) && calls.quit === 0, 'if the program will not start, this app stays open and says why', r.msg);
}
{
  const { api, calls } = make({ spawn: () => { throw new Error('boom'); } });
  await api.choose();
  const r = await api.launch();
  ok(r.ok === false && /boom/.test(r.msg) && calls.quit === 0, 'a launcher that throws is handled the same way');
}
{
  fs.rmSync(path.join(userData, 'other-app.json'), { force: true });
  const { api, calls } = make();
  await api.choose();
  fs.unlinkSync(exe);
  const r = await api.launch();
  ok(r.ok === false && r.needsChoose === true && /not where it was/.test(r.msg) && calls.spawn.length === 0 && calls.quit === 0, 'if the other app was moved or uninstalled, it asks again instead of failing');
  fs.writeFileSync(exe, 'x');
}
{
  fs.writeFileSync(path.join(userData, 'other-app.json'), JSON.stringify({ path: 'relative/evil.exe' }));
  const { api, calls } = make();
  const r = await api.launch();
  ok(r.ok === false && calls.spawn.length === 0, 'a saved path that is not absolute is never run');
  fs.writeFileSync(path.join(userData, 'other-app.json'), '{ not json');
  ok((await make().api.launch()).needsChoose === true, 'a damaged settings file is treated as nothing saved');
}
// ---- not Windows
{
  const { api, calls } = make({ opts: { platform: 'linux' } });
  ok(api.supported === false && api.info().supported === false, 'on Mac and Linux the feature is switched off');
  const c = await api.choose(); const l = await api.launch();
  ok(c.ok === false && l.ok === false && calls.dialog.length === 0 && calls.spawn.length === 0, '...and neither choosing nor launching does anything there');
}
// ---- the two projects' copies stay identical
const theirs = '/home/anthony/owen/mini_games/electron/otherApp.js';
if (fs.existsSync(theirs)) ok(fs.readFileSync(theirs, 'utf8') === fs.readFileSync(new URL('../electron/otherApp.cjs', import.meta.url), 'utf8'), 'the copy in 51 Mimi Games is identical');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll other-app checks passed.\x1b[0m');
process.exit(failed ? 1 : 0);
