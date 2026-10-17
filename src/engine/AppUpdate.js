import { ANDROID_URL } from './Install.js';

/**
 * "Update available" for the Android app.
 *
 * The Android app is the whole arcade bundled inside an APK that is installed from the website, not from Google Play,
 * and Android does not let an app like that replace itself silently: installing an APK always ends in the system's own
 * "Update this app?" screen. So this does everything up to that point. It asks GitHub for the newest release, and when
 * that is newer than the version this APK was built from it shows a banner; one tap downloads the new APK and opening
 * it installs over the old one. Saves and sign-ins are kept, because the release builds are signed with the same key.
 *
 * The version this app was built from is stamped in at build time (VITE_APP_VERSION, set to the release tag in
 * .github/workflows/android.yml). A build without one, such as the dev server or a hand-built APK, never checks.
 *
 * Deliberately not done here: swapping the game files in place without touching the APK. That would update silently,
 * but it needs native code, and a mistake in native code cannot be found without a device.
 */
const REPO = 'asherwin86/jack-mimigames';
const DISMISS_KEY = 'mimiUpdateDismissed';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export const INSTALLED_VERSION = String((import.meta.env && import.meta.env.VITE_APP_VERSION) || '').replace(/^v/, '');

/** [major, minor, patch] from "1.2.3" (a leading v is fine), or null for anything else. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when version `a` is newer than version `b`. Unparseable on either side is "no". */
export function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const isAndroidApp = () => typeof window !== 'undefined' && window.Capacitor?.getPlatform?.() === 'android';

/** The newest published release that has an APK attached, as { version, apkUrl }, or null. */
export async function latestRelease() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    // The APK is attached by a separate job after the release exists; until it is there there is nothing to download.
    const apk = (rel.assets || []).find((a) => a.name === '100-Mimi-Games.apk');
    return parseVersion(version) && apk ? { version, apkUrl: ANDROID_URL } : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function showBanner(version) {
  if (document.querySelector('[data-app-update]')) return;
  const bar = document.createElement('div');
  bar.dataset.appUpdate = '1';
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;max-width:min(560px,calc(100vw - 24px));display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 16px;border-radius:12px;background:rgba(16,19,28,.97);color:#fff;border:1px solid rgba(255,255,255,.18);box-shadow:0 8px 30px rgba(0,0,0,.5);font:14px/1.4 system-ui,sans-serif;';
  const msg = document.createElement('span');
  msg.style.flex = '1 1 220px';
  msg.textContent = `Version ${version} is out. Tap Update, then open the file it downloads and tap Install. Your progress is kept.`;
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'acct-btn primary'; go.textContent = 'Update';
  const later = document.createElement('button');
  later.type = 'button'; later.className = 'acct-btn'; later.textContent = 'Later';
  go.onclick = () => { window.open(ANDROID_URL, '_blank'); bar.remove(); };
  later.onclick = () => { store.set(DISMISS_KEY, version); bar.remove(); };
  bar.append(msg, go, later);
  document.body.appendChild(bar);
}

async function check() {
  const rel = await latestRelease();
  if (!rel || !isNewer(rel.version, INSTALLED_VERSION)) return;
  if (store.get(DISMISS_KEY) === rel.version) return;   // they said Later to this one
  showBanner(rel.version);
}

export function startAppUpdateCheck() {
  if (!isAndroidApp() || !parseVersion(INSTALLED_VERSION)) return;
  let last = 0;
  const run = () => { last = Date.now(); check(); };
  setTimeout(run, 4000);                                  // after the menu has painted
  setInterval(run, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {   // coming back to the app after a long time away
    if (document.visibilityState === 'visible' && Date.now() - last > 60 * 60 * 1000) run();
  });
}
