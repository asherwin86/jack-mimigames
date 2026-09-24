import { Account } from './Account.js';
import { Rocoins } from './Rocoins.js';

/**
 * Backs the Rocoin wallet up to the signed-in account, and brings it back on
 * another device. Signed out, nothing is sent and the wallet just lives in
 * this browser. Signed in:
 *
 *   - every change is pushed a few seconds later (one request that merges this
 *     device's copy into the account's and returns the combined result), and
 *   - signing in, coming back to the tab, and a slow timer pull in whatever
 *     your other devices did.
 *
 * A browser that already holds a *different* account's coins (you signed out
 * of one account and into another) doesn't donate them: it switches to the
 * new account's wallet instead.
 */

export const SyncState = { status: 'off', at: 0, msg: '' };   // status: off | syncing | saved | error
const listeners = new Set();
const set = (status, msg = '') => {
  SyncState.status = status; SyncState.msg = msg;
  if (status === 'saved') SyncState.at = Date.now();
  for (const fn of [...listeners]) { try { fn(SyncState); } catch (e) { console.error(e); } }
};

export function onSyncState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const PUSH_DELAY = 4000;
let timer = 0;
let inflight = null;
let again = false;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, PUSH_DELAY);
}

/** Merges this device's wallet with the account's. Resolves { ok, msg? }. */
export function syncNow() {
  clearTimeout(timer);
  const s = Account.session();
  if (!s) { set('off'); return Promise.resolve({ ok: false, signedOut: true }); }
  if (inflight) { again = true; return inflight; }
  set('syncing');
  inflight = (async () => {
    try {
      const owner = Rocoins.owner();
      let r;
      if (owner && owner !== s.key) {
        r = await Account.call('profiles', 'wallet');
        if (r.ok && Account.session()?.key === s.key) Rocoins.adopt(s.key, r.wallet);
      } else {
        r = await Account.call('profiles', 'wallet-put', { wallet: Rocoins.snapshot() });
        if (r.ok && Account.session()?.key === s.key) { Rocoins.merge(r.wallet); Rocoins.setOwner(s.key); }
      }
      if (r.ok) set('saved');
      else if (r.signedOut) set('off');
      else set('error', r.offline ? "Couldn't reach the account server — will try again." : (r.msg || 'Could not back up.'));
      return r;
    } catch (e) {
      console.error(e);
      set('error', 'Could not back up.');
      return { ok: false, msg: 'Could not back up.' };
    } finally {
      inflight = null;
      if (again) { again = false; schedule(); }
    }
  })();
  return inflight;
}

/** Starts watching: call once at startup. */
export function startRocoinSync() {
  Rocoins.onChange((_bal, meta) => { if (!meta?.fromSync && Account.isSignedIn()) schedule(); });
  Account.onChange(() => {
    if (Account.isSignedIn()) syncNow();
    else { clearTimeout(timer); set('off'); }
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Account.isSignedIn()) syncNow(); });
  }
  setInterval(() => { if (Account.isSignedIn() && !(typeof document !== 'undefined' && document.hidden)) syncNow(); }, 120000);
  if (Account.isSignedIn()) syncNow();
}
