import { hubUrl, setAutoHub } from './Account.js';

/**
 * Hosting for other devices, from the client's side. The server half is in hub-server/server.js ("Hosting for other
 * devices") and the Windows app's half is in electron/main.js; the Host dialog (ui/HostDialog.js) is the control panel.
 *
 * Three jobs, depending on where this page is running:
 *
 *  - Served by a host (window.MIMI_LOCAL_HOST): nothing to do. Account.js already points at the host's own server.
 *  - The Windows app: normally keep using the website's account server, but if that one is not answering, use the
 *    server running inside this app instead. Ticking "always use this computer's server" in the Host dialog skips the
 *    check. (Accounts are separate on each server, which is why this is a fallback and not the default: switching
 *    silently would look like signed-in accounts disappearing.)
 *  - The website or a phone browser: ask the website's server whether a host is announced from this network, and offer
 *    a link to it. A link and not a connection, because browsers refuse to let an https page call a plain-http address
 *    on a home network, and a probe would not say whether it is reachable. A top-level navigation is allowed.
 *    It never jumps by itself unless the visitor ticked "always"; and not twice in one session, so an unreachable host
 *    (a guest Wi-Fi that isolates devices) cannot trap anyone in a back-button loop.
 */
const USE_LOCAL_KEY = 'mimiUseLocalHub';
const AUTO_KEY = 'mimiAutoJoinHost';
const DISMISS_KEY = 'mimiHostDismissed';
const TRIED_KEY = 'mimiHostTried';

const store = {
  get(area, k) { try { return window[area].getItem(k); } catch { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch { /* private mode */ } },
  del(area, k) { try { window[area].removeItem(k); } catch { /* private mode */ } },
};

export const desktopHost = () => (typeof window !== 'undefined' ? window.mimiDesktop?.host ?? null : null);
export const alwaysUseLocalHub = () => store.get('localStorage', USE_LOCAL_KEY) === '1';
export function setAlwaysUseLocalHub(on) { if (on) store.set('localStorage', USE_LOCAL_KEY, '1'); else store.del('localStorage', USE_LOCAL_KEY); }

async function answers(url, ms = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`${url}/health`, { cache: 'no-store', signal: ctrl.signal });
    return res.ok;
  } catch { return false; } finally { clearTimeout(timer); }
}

/** The Windows app: use this computer's server when asked to, or when the website's server is down. */
async function chooseDesktopHub(host) {
  const info = await host.info().catch(() => null);
  if (!info || !info.ok) return;                  // the server inside the app is not running: nothing to switch to
  const local = `http://localhost:${info.port}`;
  if (alwaysUseLocalHub() || !(await answers(hubUrl()))) setAutoHub(local);
}

const onLanAlready = () => {
  const h = location.hostname;
  return h === 'localhost' || h === '[::1]' || h.endsWith('.local')
    || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
};

// Only a plain private-network http(s) address with a port is ever navigated to, whatever the response says.
const SAFE_URL = /^https?:\/\/(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}(\.\d{1,3})?:\d{4,5}\/$/;

function jumpUrl(hostUrl) {
  return new URL(location.pathname + location.search + location.hash, hostUrl).href;   // keep the visitor where they were
}

function showBanner(host) {
  const url = jumpUrl(host.urls[0]);
  const auto = store.get('localStorage', AUTO_KEY) === '1' && store.get('sessionStorage', TRIED_KEY) !== '1';
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;max-width:min(560px,calc(100vw - 32px));display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 16px;border-radius:12px;background:rgba(16,19,28,.97);color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 30px rgba(0,0,0,.5);font:14px/1.4 system-ui,sans-serif;';
  const msg = document.createElement('span');
  msg.style.flex = '1 1 220px';
  msg.textContent = auto ? `Joining ${host.name} on your network…` : `${host.name} is hosting on your network. Play from it for a faster, local game.`;
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'acct-btn primary'; go.textContent = auto ? 'Cancel' : 'Join';
  const later = document.createElement('button');
  later.type = 'button'; later.className = 'acct-btn'; later.textContent = 'Not now';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:12px;opacity:.85;cursor:pointer;flex-basis:100%;';
  const always = document.createElement('input');
  always.type = 'checkbox'; always.checked = store.get('localStorage', AUTO_KEY) === '1';
  always.style.cssText = 'width:auto;margin:0;';
  always.addEventListener('change', () => { if (always.checked) store.set('localStorage', AUTO_KEY, '1'); else store.del('localStorage', AUTO_KEY); });
  label.append(always, document.createTextNode('Always join a host on my network automatically'));
  let timer = null;
  const navigate = () => { store.set('sessionStorage', TRIED_KEY, '1'); location.assign(url); };
  const close = () => { if (timer) clearTimeout(timer); store.set('sessionStorage', DISMISS_KEY, '1'); bar.remove(); };
  if (auto) { timer = setTimeout(navigate, 2500); go.onclick = close; later.hidden = true; }
  else { go.onclick = navigate; later.onclick = close; }
  bar.append(msg, go, later);
  if (host.urls.length > 1 && !auto) {
    const alt = document.createElement('span');
    alt.style.cssText = 'flex-basis:100%;font-size:12px;opacity:.8;';
    alt.append('Not working? Try: ');
    host.urls.slice(1).forEach((u, i) => {
      if (i) alt.append(' · ');
      const a = document.createElement('a');
      a.href = jumpUrl(u); a.textContent = new URL(u).host; a.style.color = 'inherit';
      alt.appendChild(a);
    });
    bar.appendChild(alt);
  }
  bar.appendChild(label);
  document.body.appendChild(bar);
}

async function findHostForVisitor() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${hubUrl()}/api/host/lookup`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return;
    const data = await res.json();
    for (const h of (data && data.ok && Array.isArray(data.hosts)) ? data.hosts : []) {
      const urls = Array.isArray(h.urls) ? h.urls.filter((u) => typeof u === 'string' && SAFE_URL.test(u)) : [];
      if (urls.length) { showBanner({ name: String(h.name || 'A computer').slice(0, 40), urls }); return; }
    }
  } catch { /* offline, server asleep, or nothing announced: nothing to offer */ } finally { clearTimeout(timer); }
}

export function startHostFinder() {
  if (window.MIMI_LOCAL_HOST === true) return;
  const host = desktopHost();
  if (host) { chooseDesktopHub(host); return; }
  if (location.protocol === 'file:' || onLanAlready()) return;
  if (store.get('sessionStorage', DISMISS_KEY) === '1') return;
  if (new URLSearchParams(location.search).has('nohost')) return;
  // After the menu has painted; a convenience is never worth delaying a load.
  setTimeout(findHostForVisitor, 1500);
}
