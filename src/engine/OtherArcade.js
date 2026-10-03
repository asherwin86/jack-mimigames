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

/** The address the website switch goes to. `?fs=1` tells the other arcade it was reached by Switch, so it can go fullscreen (see armFullscreenOnArrival). */
export const switchUrl = () => `${OTHER_ARCADE.url}?fs=1`;

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
    try { window.open(switchUrl(), '_blank', 'noopener'); return; } catch { /* fall through */ }
  }
  location.href = switchUrl();
}

/** Right-click on the Switch button in the Windows app: pick where the other app is. */
export async function chooseOtherAppLocation() {
  const app = winApp();
  if (!app) return false;
  const c = await app.choose();
  if (!c.ok && !c.canceled) alert(c.msg || `Couldn't use that file.`);
  return true;
}

/**
 * Fullscreen on arrival. When the other arcade sends you here with `?fs=1`, this
 * page goes fullscreen so there is no browser bar.
 *
 * A browser only allows fullscreen after a tap or key press, and that does not
 * carry over to a new page. So: try straight away (some browsers allow it); if
 * refused, show a small "Tap anywhere for fullscreen" hint and do it on the first
 * tap or key press. iPhone Safari has no fullscreen for web pages at all, so
 * nothing happens there; it only loses its bar as a Home Screen app. Installed
 * copies (desktop app, Android app, Home Screen app) have no bar already.
 */
export function armFullscreenOnArrival() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  if (params.get('fs') !== '1') return;
  params.delete('fs');
  const rest = params.toString();
  try { history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash); } catch { /* no history API */ }

  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request || document.fullscreenElement || isInstalledCopy()) return;
  const go = () => {
    try { const r = request.call(el, { navigationUI: 'hide' }); return r && r.then ? r : Promise.resolve(); } catch (e) { return Promise.reject(e); }
  };
  go().catch(() => {
    const hint = document.createElement('div');
    hint.textContent = 'Tap anywhere for fullscreen';
    hint.setAttribute('role', 'status');
    hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:8px 16px;border-radius:999px;background:rgba(8,12,20,.85);border:1px solid rgba(255,255,255,.3);color:#fff;font:700 13px system-ui,sans-serif;pointer-events:none;';
    document.body.appendChild(hint);
    const events = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown'];
    let timer = 0;
    let trying = false;
    const stop = () => { events.forEach((e) => removeEventListener(e, onGesture, true)); hint.remove(); clearTimeout(timer); };
    function onGesture(e) {
      if (e.type === 'keydown' && e.key === 'Escape') return;
      if (trying) return;
      trying = true;
      go().then(stop, () => { trying = false; });   // a press that does not count as a gesture is refused; wait for the next one
    }
    events.forEach((e) => addEventListener(e, onGesture, true));
    timer = setTimeout(stop, 10000);
  });
}
