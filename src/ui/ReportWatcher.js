import { Account } from '../engine/Account.js';
import { keepInside } from '../engine/ParentalState.js';
import { openBugReport } from './BugReportDialog.js';
import { notify } from './Parental.js';

/**
 * Tells the arcade owner when someone sends a bug report: a desktop notification (a Windows toast in the desktop app, a
 * browser notification on the website once allowed) and, if notifications are not allowed, a message at the top of the
 * screen. Clicking it opens the report inbox.
 *
 * It only does anything while the owner's account is signed in (only that account can read reports) and the arcade is
 * open (the desktop app keeps checking while minimised). Anyone else's account is told "not the owner" once and left alone.
 * Reports that were already waiting before the first check are not announced one by one: you get a single
 * "N reports waiting" the first time.
 */
const SEEN_KEY = 'mg.reports.seen.v1';
const EVERY_MS = 60 * 1000;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function readSeen() {
  try { const s = JSON.parse(get(SEEN_KEY) || 'null'); return s && typeof s.owner === 'string' && Array.isArray(s.ids) ? s : null; } catch { return null; }
}

const KIND = { bug: 'Bug report', suggestion: 'Idea', other: 'Report' };
const short = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function announce(title, body, tag) {
  let shown = false;
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
      n.onclick = () => { try { window.focus(); n.close(); } catch { /* ignore */ } openBugReport({ tab: 'inbox' }); };
      shown = true;
    }
  } catch { /* some platforms refuse `new Notification` */ }
  if (!shown) notify(`${title}: ${body}`);   // no desktop notification allowed: at least say it on screen
}

let timer = 0;
let busy = false;
let ownerState = 'unknown';   // unknown | owner | notOwner

/** One check. Resolves how many new reports were announced (for tests). */
export async function checkReports() {
  const s = Account.session();
  if (!s || busy || keepInside()) return 0;
  busy = true;
  try {
    const r = await Account.reports();
    if (Account.session()?.key !== s.key) return 0;
    if (!r.ok) { if (r.notAdmin) { ownerState = 'notOwner'; stopTimer(); } return 0; }
    ownerState = 'owner';
    const list = Array.isArray(r.reports) ? r.reports : [];
    const seen = readSeen();
    const ids = list.map((x) => x.id);
    if (!seen || seen.owner !== s.key) {   // the first check on this device: do not announce the backlog one by one
      put(SEEN_KEY, JSON.stringify({ owner: s.key, ids }));
      if (list.length) announce('Bug reports waiting', `${list.length} report${list.length === 1 ? ' is' : 's are'} in your inbox.`, 'backlog');
      return 0;
    }
    const known = new Set(seen.ids);
    const fresh = list.filter((x) => !known.has(x.id)).sort((a, b) => a.createdAt - b.createdAt);
    put(SEEN_KEY, JSON.stringify({ owner: s.key, ids: [...new Set([...seen.ids, ...ids])].slice(-500) }));
    fresh.slice(0, 3).forEach((x) => {
      const where = x.context?.game ? ` in ${x.context.game}` : '';
      announce(`${KIND[x.category] || 'Report'} from ${x.name || 'Guest'}${where}`, short(x.message, 140), x.id);
    });
    if (fresh.length > 3) announce('More reports', `and ${fresh.length - 3} more new reports.`, 'more');
    return fresh.length;
  } finally { busy = false; }
}

function stopTimer() { clearInterval(timer); timer = 0; }
function startTimer() { if (!timer) timer = setInterval(() => { checkReports(); }, EVERY_MS); }

/** Starts watching: call once at startup. */
export function startReportWatcher() {
  const react = () => {
    if (Account.isSignedIn() && !keepInside()) { ownerState = 'unknown'; startTimer(); checkReports(); } else stopTimer();
  };
  Account.onChange(react);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) checkReports(); });
  react();
}

export const reportWatcherState = () => ownerState;
