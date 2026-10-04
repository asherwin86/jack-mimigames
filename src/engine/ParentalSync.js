import { Account, api } from './Account.js';
import { parental } from './ParentalState.js';

/**
 * Parental controls that live on the CHILD's account and are managed by the PARENT's account, so the rules follow the
 * child to every device they sign in on. (The rules and the merge are in public/parental-core.js; the server side is the
 * "parental" actions in hub-server/server.js.)
 *
 *   1. A parent, signed in to their own account, types the child's account name in Parental controls: that sends a request
 *      carrying the rules they set up here. Nothing changes on the child's account yet.
 *   2. The child signs in (on any device) and sees the request. Accepting puts the rules on the child's account, with the
 *      parent as its manager.
 *   3. From then on the child's devices read the rules when the child signs in, keep a copy (so signing out is no way round
 *      them), and report play time (one counter per device, so a child on two devices adds up). Only the parent's account can
 *      change or remove the rules: their device pushes changes, and the child's devices pick them up within a minute or so.
 *
 * This device's link is stored in `mg.parental.link.v1`:
 *   { role: 'parent', target, targetName, parent }  this device manages that child's rules (works while the parent is signed in)
 *   { role: 'child',  key, name }                    this device follows the signed-in child's rules (works while they are signed in)
 * The PIN is stored salted and hashed. This is a house rule, not a security system.
 */

const LINK_KEY = 'mg.parental.link.v1';
const PUSH_DELAY = 2000;

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

const listeners = new Set();
/** status: off | syncing | saved | error;  state: pending | active | null (parent side);  request: { fromName } when this signed-in child has a request waiting. */
export const ParentalLink = { status: 'off', msg: '', request: null, state: null };   // state (parent side): pending | active | null
function emit() { for (const fn of [...listeners]) { try { fn(ParentalLink); } catch (e) { console.error(e); } } }
function setStatus(status, msg = '') { ParentalLink.status = status; ParentalLink.msg = msg; emit(); }
export function onLinkChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function readLink() {
  try { const l = JSON.parse(get(LINK_KEY) || 'null'); return l && (l.role === 'parent' || l.role === 'child') ? l : null; } catch { return null; }
}
const writeLink = (l) => put(LINK_KEY, l ? JSON.stringify(l) : null);

/** { role, name } this device is linked as (parent: the child's name; child: their own), or null. */
export function linkInfo() {
  const l = readLink();
  return l ? { role: l.role, name: l.role === 'parent' ? l.targetName : l.name } : null;
}

/** Who may sign calls for the link right now: the parent's session for a parent link, the child's for a child link. */
function session() {
  const l = readLink();
  const s = Account.session();
  if (!l || !s || !s.token) return null;
  if (l.role === 'parent') return s.key === l.parent ? s : null;
  return s.key === l.key ? s : null;
}
const active = () => !!session();

/** One call to the account server for this link. Resolves the server's answer, or { ok:false, signedOut } / { ok:false, msg }. */
async function call(action, body = {}) {
  const l = readLink();
  const s = session();
  if (!l || !s) return { ok: false, signedOut: true };
  const extra = l.role === 'parent' ? { target: l.target } : {};
  return Account.call('profiles', action, { ...extra, ...body });
}

let inflight = null;
let again = false;
let timer = 0;
let lastSent = '';
let importing = false;
function schedule() { clearTimeout(timer); timer = setTimeout(pushNow, PUSH_DELAY); }
function absorb(P, remote, opts) {
  importing = true;
  try { return P.importSync(remote, opts); } finally { importing = false; }
}
function failed(r, what) {
  if (r.signedOut) setStatus('off');
  else setStatus('error', r.offline ? "Couldn't reach the account server, will try again." : (r.msg || what));
}

/** Sends this device's play time (and, for the parent, the rules) and takes back the combined copy. */
export function pushNow() {
  clearTimeout(timer);
  const P = parental();
  const l = readLink();
  if (!P || !l || !active()) return Promise.resolve({ ok: false });
  if (inflight) { again = true; return inflight; }
  setStatus('syncing');
  inflight = (async () => {
    try {
      const out = P.exportSync();
      const r = l.role === 'parent' ? await call('parental-manage', { op: 'put', parental: out }) : await call('parental-put', { parental: out });
      if (r.ok) {
        lastSent = JSON.stringify(out.settings);
        if (l.role === 'parent') { ParentalLink.state = r.state === 'none' ? null : r.state; if (r.state === 'none') { writeLink(null); setStatus('off'); return r; } }   // (none: the child's account no longer has them)
        if (r.parental) absorb(P, r.parental);
        setStatus('saved');
      } else failed(r, 'Could not save to the account.');
      return r;
    } catch (e) {
      console.error(e);
      setStatus('error', 'Could not save to the account.');
      return { ok: false };
    } finally {
      inflight = null;
      if (again) { again = false; schedule(); }
    }
  })();
  return inflight;
}

/**
 * Brings in what the account has. Child side: a signed-in child whose account has rules follows them (and a waiting request is
 * reported through ParentalLink.request). Parent side: refreshes the state of the request / rules for the linked child.
 * Resolves { ok, state? }.
 */
export async function pullNow() {
  const P = parental();
  if (!P) return { ok: false };
  const l = readLink();
  if (l?.role === 'parent') {
    if (!active()) return { ok: false };
    const r = await call('parental-manage', { op: 'get' });
    if (!r.ok) { failed(r, 'Could not reach the account.'); return r; }
    ParentalLink.state = r.state === 'none' ? null : r.state;
    if (r.state === 'none') { writeLink(null); setStatus('off'); return { ok: true, state: 'none' }; }
    if (r.parental) { const res = absorb(P, r.parental); if (res.localNewer) schedule(); }
    setStatus('saved');
    return { ok: true, state: r.state };
  }
  const s = Account.session();
  if (!s || !s.token) { if (ParentalLink.request) { ParentalLink.request = null; emit(); } return { ok: false }; }
  const r = await Account.call('profiles', 'parental');
  if (!r.ok || Account.session()?.key !== s.key) return { ok: false };
  const req = r.request ? { fromName: r.request.fromName } : null;
  if (JSON.stringify(req) !== JSON.stringify(ParentalLink.request)) { ParentalLink.request = req; emit(); }
  if (r.parental) {
    writeLink({ role: 'child', key: s.key, name: s.name });
    absorb(P, r.parental, { preferRemote: true });   // the manager's rules are the child's rules (the manager's newest copy)
    setStatus('saved');
    return { ok: true, state: 'active' };
  }
  if (l?.role === 'child' && l.key === s.key) {   // the parent took the rules off this account: release this device too
    writeLink(null);
    if (P.enabled()) P.save({ enabled: false });
    setStatus('off');
  }
  return { ok: true, state: 'none' };
}

/** The signed-in child accepts the request that is waiting. Resolves { ok, msg? }. */
export async function acceptRequest() {
  const r = await Account.call('profiles', 'parental-accept');
  if (!r.ok) return r;
  ParentalLink.request = null;
  await pullNow();
  emit();
  return { ok: true };
}

/** The signed-in child says no. */
export async function declineRequest() {
  const r = await Account.call('profiles', 'parental-decline');
  if (r.ok || r.msg) { ParentalLink.request = null; emit(); }
  return r;
}

/**
 * A parent (signed in to their own account) sends the child's account a request carrying the rules set up on this device.
 * Resolves { ok, msg?, childName? }.
 */
export async function requestLink(childName) {
  const P = parental();
  const s = Account.session();
  if (!P || !P.hasPin()) return { ok: false, msg: 'Set a parent PIN first.' };
  if (!s) return { ok: false, msg: 'Sign in to your own account first.' };
  const target = String(childName || '').trim().toLowerCase();
  if (!target) return { ok: false, msg: "Type your child's account name." };
  const r = await Account.call('profiles', 'parental-request', { target, parental: P.exportSync() });
  if (!r.ok) return r;
  writeLink({ role: 'parent', target, targetName: r.childName || String(childName).trim(), parent: s.key });
  ParentalLink.state = 'pending';
  setStatus('saved');
  return r;
}

/** The parent takes the rules off the child's account (or cancels the request). This device keeps its own copy. */
export async function unlinkNow() {
  const l = readLink();
  if (!l) return { ok: true };
  if (l.role !== 'parent') { return { ok: false, msg: 'Only the parent who set the rules up can remove them from this account.' }; }
  if (!active()) { return { ok: false, msg: `Sign in to your own account (${l.parent}) to remove them.` }; }
  const r = await call('parental-manage', { op: 'clear' });
  if (r.ok || /no longer exists/.test(r.msg || '')) { writeLink(null); ParentalLink.state = null; setStatus('off'); return { ok: true }; }
  return r;
}

/** Starts watching: call once at startup. */
export function startParentalSync() {
  const P = parental();
  if (!P) return;
  P.onSettings(() => {
    if (importing || readLink()?.role !== 'parent' || !active()) return;   // only the parent's device sends rule changes
    if (JSON.stringify(P.exportSync().settings) !== lastSent) schedule();
  });
  Account.onChange(() => { if (Account.isSignedIn()) pullNow(); else { clearTimeout(timer); if (ParentalLink.request) { ParentalLink.request = null; emit(); } setStatus('off'); } });
  const visible = () => typeof document === 'undefined' || !document.hidden;
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (visible() && active()) pushNow(); });
  setInterval(() => {   // play time, and changes made on other devices
    if (!visible() || !Account.isSignedIn()) return;
    if (active() && P.status().enabled) pushNow(); else pullNow();
  }, 60000);
  if (Account.isSignedIn()) pullNow();
}
