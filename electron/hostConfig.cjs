/**
 * What the desktop app remembers about hosting, kept in its data folder (host-config.json):
 *   - whether the Blockcraft PvP server runs (default yes), and
 *   - the account storage the local account server should use. To keep the accounts the website's server already has, it
 *     needs that server's three secrets: the Upstash database address and token (where accounts are kept) and the password
 *     pepper (without the same one nobody's password would match). They are encrypted with the operating system's own key
 *     (Electron safeStorage) when it is available, never leave this computer except to talk to Upstash, and are only ever
 *     shown masked.
 * Kept free of Electron so it can be checked on its own (scripts/check-host-config.mjs): `fs`, `safeStorage` and the folder
 * are passed in.
 */
const path = require('path');

const FILE = 'host-config.json';
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function createHostConfig({ dir, fs, safeStorage }) {
  const file = path.join(dir, FILE);
  const canEncrypt = () => { try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; } };

  function readFile() {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
  }
  function writeFile(obj) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 1), { mode: 0o600 });
  }

  /** { url, token, pepper } or null (nothing saved, or it cannot be read on this account). */
  function storage() {
    const s = readFile().storage;
    if (!s || typeof s.data !== 'string') return null;
    try {
      const text = s.enc ? safeStorage.decryptString(Buffer.from(s.data, 'base64')) : Buffer.from(s.data, 'base64').toString('utf8');
      const v = JSON.parse(text);
      const out = { url: clean(v.url, 300), token: clean(v.token, 600), pepper: clean(v.pepper, 300) };
      return out.url && out.token ? out : null;
    } catch { return null; }
  }

  /** Saves the storage settings. Resolves { ok } or { ok:false, msg }. */
  function saveStorage({ url, token, pepper }) {
    const u = clean(url, 300), t = clean(token, 600), p = clean(pepper, 300);
    // (Plain http is accepted for this computer's own addresses only, so a test can use a fake database.)
    if (!/^https:\/\/[^\s/]+\.[^\s/]+\/?$/i.test(u) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(u)) return { ok: false, msg: 'The database address should look like https://something.upstash.io' };
    if (t.length < 8) return { ok: false, msg: 'The token is missing or too short.' };
    if (!p) return { ok: false, msg: 'The password pepper is needed, or nobody\'s password would match. Copy HASH_PEPPER from the old server exactly.' };
    const json = JSON.stringify({ url: u, token: t, pepper: p });
    const enc = canEncrypt();
    const data = (enc ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')).toString('base64');
    const cur = readFile();
    writeFile({ ...cur, v: 1, storage: { enc, data } });
    return { ok: true, encrypted: enc };
  }

  function clearStorage() { const cur = readFile(); delete cur.storage; writeFile({ v: 1, ...cur }); }

  const pvpOn = () => readFile().pvp !== false;
  function setPvp(on) { writeFile({ v: 1, ...readFile(), pvp: !!on }); }

  /** The environment variables the local account server is started with for these settings. */
  function hubEnv() {
    const s = storage();
    return s ? { UPSTASH_REDIS_REST_URL: s.url, UPSTASH_REDIS_REST_TOKEN: s.token, HASH_PEPPER: s.pepper } : {};
  }

  /** What the Host window may see: never the secrets themselves. */
  function publicStatus() {
    const s = storage();
    let where = '';
    try { where = s ? new URL(s.url).hostname : ''; } catch { where = ''; }
    return { configured: !!s, where, tokenSet: !!s, pepperSet: !!s, encrypted: !!readFile().storage?.enc, pvp: pvpOn() };
  }

  return { storage, saveStorage, clearStorage, pvpOn, setPvp, hubEnv, publicStatus, file };
}

module.exports = { createHostConfig };
