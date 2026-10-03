import { isInstalledCopy } from './Install.js';

/**
 * The sister arcade: 51 Mimi Games, a separate site (its own repo and server).
 *
 *  - In the Windows desktop app the button opens your copy of the 51 app and
 *    closes this one. The first time it asks where that app is (a normal file
 *    picker) and remembers; right-click the button to pick a different one.
 *    The picking and launching happen in the app's main process (see
 *    electron/otherApp.cjs); the page only asks.
 *  - Everywhere else it jumps to the website: in the same tab on the web (so
 *    Back returns here), in the browser for the other installed copies.
 */
export const OTHER_ARCADE = { name: '51 Mimi Games', url: 'https://mimi-games-bvpj.onrender.com/' };

const winApp = () => { const a = typeof window !== 'undefined' ? window.mimiDesktop?.otherApp : null; return a?.supported ? a : null; };

/** True inside the Windows desktop app, where the button starts the other app instead of opening a web page. */
export const switchUsesApp = () => !!winApp();

/** Starts the other app (asking where it is, if we do not know yet). Resolves true once it has started. */
async function switchViaApp(app) {
  let r = await app.launch();
  if (!r.ok && r.needsChoose) {
    if (r.msg) alert(r.msg);
    const c = await app.choose();
    if (c.canceled) return true;                 // changed their mind: stay here, say nothing
    if (!c.ok) { alert(c.msg || `Couldn't use that file.`); return true; }
    r = await app.launch();
  }
  if (!r.ok) alert(r.msg || `Couldn't start ${OTHER_ARCADE.name}.`);
  return true;
}

export async function switchToOtherArcade() {
  const app = winApp();
  if (app) { try { await switchViaApp(app); return; } catch { /* fall back to the website */ } }
  if (isInstalledCopy()) {
    try { window.open(OTHER_ARCADE.url, '_blank', 'noopener'); return; } catch { /* fall through */ }
  }
  location.href = OTHER_ARCADE.url;
}

/** Right-click on the Switch button in the Windows app: pick where the other app is. */
export async function chooseOtherAppLocation() {
  const app = winApp();
  if (!app) return false;
  const c = await app.choose();
  if (!c.ok && !c.canceled) alert(c.msg || `Couldn't use that file.`);
  return true;
}
