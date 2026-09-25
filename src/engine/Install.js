/**
 * "Get the app" support for the website: where to download the apps, whether this browser can install the site itself, and
 * whether we are already inside an installed copy (in which case there is nothing to offer).
 */
export const RELEASES = 'https://github.com/asherwin86/jack-mimigames/releases/latest/download';
export const WINDOWS_URL = `${RELEASES}/100-Mimi-Games-Setup.exe`;
export const ANDROID_URL = `${RELEASES}/100-Mimi-Games.apk`;

let deferred = null;
const listeners = new Set();

/** True inside the desktop app, the Android app, or an installed web app — no button needed there. */
export function isInstalledCopy() {
  if (typeof window === 'undefined') return true;
  if (window.Capacitor) return true;
  if (/Electron/i.test(navigator.userAgent || '')) return true;
  try {
    if (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch { /* old browser */ }
  return navigator.standalone === true;   // iOS "Add to Home Screen"
}

/** 'windows' | 'android' | 'ios' | 'mac' | 'linux' | 'other' */
export function platform() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

/** Can the browser pop up its own "Install app" prompt right now? */
export function canPromptInstall() { return deferred !== null; }

/** Shows the browser's install prompt. Resolves to 'accepted', 'dismissed' or 'unavailable'. */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null;
  notify();
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice?.outcome || 'dismissed';
  } catch { return 'dismissed'; }
}

export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } }

if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; notify(); });
  addEventListener('appinstalled', () => { deferred = null; notify(); });
  // Registered only on the real website (not the dev server, the desktop app or the Android app, which already
  // bundle everything). It is what lets the browser offer to install the site and keeps it working offline.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor
      && !/Electron/i.test(navigator.userAgent || '') && !(import.meta.env && import.meta.env.DEV)) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
}
