/**
 * Accounts for 100 Mimi Games: sign up / sign in against the arcade's account
 * server (hub-server/), and a small API helper the rest of the game uses
 * (cloud Blockcraft worlds, Kart Circuit's online modes).
 *
 * Passwords never leave the device as typed: the game sends
 * SHA-256("mimiProfile:" + name + ":" + password) — the same scheme as the
 * original Mimi Games hub, so profiles are interchangeable with it — and the
 * server mixes its own secret into that before storing anything.
 *
 * Signing in registers the device with the server, which hands back a random
 * token. That token — not the password hash — is what the device keeps and sends
 * from then on, so the account can list the devices it's signed in on and sign
 * any of them out. The session lives in localStorage under `mimiActiveSession`
 * ({ key, name, token, deviceId, ... }); Kart Circuit reads it to know who you are.
 */

const SESSION_KEY = 'mimiActiveSession';
const HUB_OVERRIDE_KEY = 'mimiHubOverride';
const DEFAULT_HUB = 'https://mimi-arcade-hub.onrender.com';

const listeners = new Set();
let hubOverride = null;

function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }

/** Base URL of the account server: a build-time VITE_HUB_URL, a user override, or the default. */
export function hubUrl() {
  const envUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_HUB_URL : undefined;
  return String(hubOverride ?? storageGet(HUB_OVERRIDE_KEY) ?? envUrl ?? DEFAULT_HUB).trim().replace(/\/+$/, '');
}

/** Points the game at a different account server (tests, self-hosting). `null` restores the default. */
export function setHubUrl(url) {
  hubOverride = url ? String(url).replace(/\/+$/, '') : null;
  storageSet(HUB_OVERRIDE_KEY, hubOverride);
}

/** A short human label for this device, e.g. "Chrome on Windows" or "Desktop app (Windows)". */
export function deviceLabel() {
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux|X11/.test(ua) ? 'Linux' : 'an unknown system';
  if (/Electron\//.test(ua)) return `Desktop app (${os})`;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  return `${browser} on ${os}`;
}

/** Lower-cased, trimmed — how the server identifies an account. */
export const keyOf = (name) => String(name ?? '').trim().toLowerCase();

const sha256Hex = async (text) => {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(text);   // plain-http pages have no crypto.subtle
};

export const hashPassword = (key, password) => sha256Hex(`mimiProfile:${key}:${password}`);

/** Pure-JS SHA-256 (FIPS 180-4), only for insecure contexts where crypto.subtle is missing. */
function sha256Fallback(text) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, (len * 8) >>> 0);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    const dv = new DataView(padded.buffer, off, 64);
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
export const _sha256Fallback = sha256Fallback;   // exported for the tests

function loadSession() {
  try {
    const s = JSON.parse(storageGet(SESSION_KEY) || 'null');
    return s && typeof s.key === 'string' && (typeof s.token === 'string' || typeof s.passwordHash === 'string') ? s : null;
  } catch { return null; }
}

let session = loadSession();

function emit() { for (const cb of [...listeners]) { try { cb(session); } catch { /* a listener's bug shouldn't break sign-in */ } } }

/** POSTs JSON to the account server. Never throws: failures come back as { ok:false, msg }. */
export async function api(base, action, body, { timeoutMs = 45000 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;   // a sleeping free server can take ~40s to wake
  try {
    const res = await fetch(`${hubUrl()}/api/${base}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl?.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !('ok' in data)) return { ok: false, msg: 'The account server had a problem — try again.' };
    return data;
  } catch {
    return { ok: false, offline: true, msg: "Couldn't reach the account server — check your connection and try again." };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let upgrading = null;
/** A session made before device tokens existed only has a password hash: trade it for a
 *  token once (so this device shows up in the list and can be signed out remotely), and
 *  stop keeping the hash. Failing (offline) just leaves the old session working. */
async function upgradeLegacySession() {
  if (!session || session.token || !session.passwordHash) return;
  if (!upgrading) {
    upgrading = (async () => {
      const s = session;
      const r = await api('profiles', 'login', { key: s.key, passwordHash: s.passwordHash, device: { label: deviceLabel() } }, { timeoutMs: 20000 });
      if (r.ok && r.token && session === s) {
        session = { key: s.key, name: s.name, token: r.token, deviceId: r.deviceId, dev: false, avatar: s.avatar || null, kartColor: s.kartColor || null };
        storageSet(SESSION_KEY, JSON.stringify(session));
      }
    })().finally(() => { upgrading = null; });
  }
  await upgrading;
}

export const Account = {
  /** The signed-in profile ({ key, name, passwordHash, ... }) or null. */
  session() { return session; },
  isSignedIn() { return !!session; },
  name() { return session?.name ?? null; },

  /** Calls `cb(session)` now and whenever someone signs in or out. Returns an unsubscribe function. */
  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  validate(name, password) {
    const n = String(name ?? '').trim();
    if (n.length < 2) return 'Pick a name with at least 2 characters.';
    if (n.length > 24) return 'Names can be up to 24 characters.';
    if (!/^[\p{L}\p{N} _.-]+$/u.test(n)) return 'Names can use letters, numbers, spaces, dots, dashes and underscores.';
    if (!password || String(password).length < 4) return 'Passwords need at least 4 characters.';
    return null;
  },

  async signUp(name, password) {
    const problem = Account.validate(name, password);
    if (problem) return { ok: false, msg: problem };
    const display = String(name).trim();
    const key = keyOf(display);
    const passwordHash = await hashPassword(key, password);
    const r = await api('profiles', 'create', { key, name: display, passwordHash, settings: {}, device: { label: deviceLabel() } });
    if (!r.ok) return r;
    session = { key, name: display, token: r.token, deviceId: r.deviceId, dev: false, avatar: null };
    storageSet(SESSION_KEY, JSON.stringify(session));
    emit();
    return { ok: true, msg: `Welcome, ${display}! You're signed in.` };
  },

  async signIn(name, password) {
    const key = keyOf(name);
    if (!key) return { ok: false, msg: 'Enter your name.' };
    if (!password) return { ok: false, msg: 'Enter your password.' };
    const passwordHash = await hashPassword(key, password);
    const r = await api('profiles', 'login', { key, passwordHash, device: { label: deviceLabel() } });
    if (!r.ok) return r;
    session = { key, name: r.name || name, token: r.token, deviceId: r.deviceId, dev: false, avatar: r.avatar || null, kartColor: r.kartColor || null };
    storageSet(SESSION_KEY, JSON.stringify(session));
    emit();
    return { ok: true, msg: `Signed in as ${session.name}.` };
  },

  /** Signs this device out (and tells the server to forget it, in the background). */
  signOut() {
    const old = session;
    session = null;
    storageSet(SESSION_KEY, null);
    emit();
    if (old?.token) api('profiles', 'logout', { key: old.key, token: old.token }, { timeoutMs: 10000 });
  },

  /** Permanently deletes the signed-in account (and its cloud worlds) after re-checking the password. */
  async deleteAccount(password) {
    if (!session) return { ok: false, msg: 'Not signed in.' };
    const passwordHash = await hashPassword(session.key, password || '');
    const r = await api('profiles', 'delete', { key: session.key, passwordHash });
    if (r.ok) Account.signOut();
    return r;
  },

  /** An authenticated call to a /api/<base>/<action> endpoint, or { ok:false, msg } if not signed in. */
  async call(base, action, body = {}, opts) {
    if (!session) return { ok: false, msg: 'Sign in first.', signedOut: true };
    await upgradeLegacySession();
    const s = session;
    if (!s) return { ok: false, msg: 'Sign in first.', signedOut: true };
    const creds = s.token ? { key: s.key, token: s.token } : { key: s.key, passwordHash: s.passwordHash };
    const r = await api(base, action, { ...creds, ...body }, opts);
    if (r.authFailed && session === s) {   // this device was signed out from another one (or the token expired)
      session = null;
      storageSet(SESSION_KEY, null);
      emit();
      return { ok: false, msg: 'You were signed out — sign in again.', signedOut: true };
    }
    return r;
  },

  /** The devices this account is signed in on: [{ id, label, createdAt, lastSeen, current }]. */
  async devices() {
    const r = await Account.call('profiles', 'devices');
    return r.ok ? { ok: true, devices: r.devices } : r;
  },

  /** Signs another device out. */
  async revokeDevice(id) {
    const r = await Account.call('profiles', 'revoke-device', { id });
    if (r.ok && !r.devices.some((d) => d.current)) Account.refreshLocalSignOut();   // (signed out our own device)
    return r.ok ? { ok: true, devices: r.devices } : r;
  },

  /** Signs every other device out. */
  async revokeOthers() {
    const r = await Account.call('profiles', 'revoke-others');
    return r.ok ? { ok: true, devices: r.devices } : r;
  },

  refreshLocalSignOut() {
    session = null;
    storageSet(SESSION_KEY, null);
    emit();
  },

  /** Re-reads the session (another tab may have signed in or out). */
  refresh() {
    const next = loadSession();
    if ((next?.key ?? null) !== (session?.key ?? null)) { session = next; emit(); }
  },
};

if (typeof addEventListener === 'function') addEventListener('storage', (e) => { if (e.key === SESSION_KEY) Account.refresh(); });
