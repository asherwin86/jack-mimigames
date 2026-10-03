/**
 * "Switch to the other app" for the Windows desktop apps (100 Mimi Games and
 * 51 Mimi Games). You point the app at the other one's .exe once; after that
 * the Switch button starts that app and closes this one.
 *
 * Only the main process ever touches the path, and only a path picked in the
 * operating system's own file dialog is stored. The page can ask to choose or
 * launch but can never hand over a path of its own, so a web page can't use
 * this to run arbitrary programs.
 *
 * Everything the module needs from Electron / Node is passed in, so the same
 * file (kept identical in both projects) can be tested without a window.
 */
const path = require('path');

function createOtherApp({ otherName, exeName, userDataDir, selfExe, platform, fs, showOpenDialog, spawn, quit, localAppData }) {
  const supported = platform === 'win32';
  const store = path.join(userDataDir, 'other-app.json');

  const load = () => {
    try { const p = JSON.parse(fs.readFileSync(store, 'utf8')).path; return typeof p === 'string' && p ? p : null; } catch { return null; }
  };
  const save = (p) => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(store, JSON.stringify({ path: p }));
  };
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  /** null if `p` is a program this app may switch to, else a sentence saying why not. */
  function problem(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return 'That is not a file.';
    if (!/\.exe$/i.test(p)) return `Pick the ${otherName} program (a file ending in .exe).`;
    let st;
    try { st = fs.statSync(p); } catch { return `Couldn't find ${p}.`; }
    if (!st.isFile()) return 'That is not a file.';
    if (selfExe && same(p, selfExe)) return `That is this app. Pick ${otherName}.`;
    return null;
  }

  function guess() {
    if (!localAppData) return undefined;
    const g = path.join(localAppData, 'Programs', otherName, exeName);
    try { return fs.existsSync(g) ? g : undefined; } catch { return undefined; }
  }

  return {
    supported,
    name: otherName,
    info() { return { supported, name: otherName }; },

    status() {
      const p = load();
      return { supported, name: otherName, path: p, exists: !!p && !problem(p) };
    },

    /** Opens the file picker. Resolves { ok:true, path }, { ok:false, canceled:true } or { ok:false, msg }. */
    async choose() {
      if (!supported) return { ok: false, msg: 'This only works in the Windows app.' };
      const r = await showOpenDialog({
        title: `Find ${otherName} (${exeName}) to switch to it`,
        defaultPath: guess(),
        properties: ['openFile'],
        filters: [{ name: 'Windows program', extensions: ['exe'] }],
      });
      if (!r || r.canceled || !r.filePaths?.length) return { ok: false, canceled: true };
      const p = r.filePaths[0];
      const bad = problem(p);
      if (bad) return { ok: false, msg: bad };
      save(p);
      return { ok: true, path: p };
    },

    /** Starts the other app, then closes this one. { ok:true } once it has started; { ok:false, needsChoose } if no usable location is saved. */
    launch() {
      if (!supported) return Promise.resolve({ ok: false, msg: 'This only works in the Windows app.' });
      const p = load();
      if (!p) return Promise.resolve({ ok: false, needsChoose: true });
      const bad = problem(p);
      if (bad) return Promise.resolve({ ok: false, needsChoose: true, msg: `${otherName} is not where it was before. ${bad}` });
      return new Promise((resolve) => {
        let child;
        try { child = spawn(p, [], { detached: true, stdio: 'ignore', cwd: path.dirname(p) }); } catch (e) { resolve({ ok: false, msg: `Couldn't start ${otherName}: ${e.message}` }); return; }
        child.once('error', (e) => resolve({ ok: false, msg: `Couldn't start ${otherName}: ${e.message}` }));
        child.once('spawn', () => {
          try { child.unref(); } catch { /* already gone */ }
          resolve({ ok: true });
          setTimeout(quit, 400);   // after the reply, so the page is not cut off mid-answer
        });
      });
    },
  };
}

module.exports = { createOtherApp };
