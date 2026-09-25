import { Rocoins } from './Rocoins.js';
import { Settings } from './Settings.js';
import { hashPassword } from './Account.js';

/**
 * The password-protected Rocoin tools in the account window: give yourself
 * coins, or switch on infinite Rocoins. Only a salted hash of the password is
 * kept here, so the password itself is not sitting in the source. (It is still
 * a client-side gate: it keeps casual clicking out, it is not real security.)
 */
const HASH = 'd56b1ef6728735e0aebe9d831cbc1ce7db695b4844c58e4078c0883104d7684e';
const UNLOCKED = 'rocoinToolsUnlocked';

export const RocoinTools = {
  isUnlocked() { return Settings.get(UNLOCKED, false) === true; },

  /** Checks the password; unlocks the tools on a match. */
  async unlock(password) {
    const ok = (await hashPassword('rocoin-tools', String(password ?? ''))) === HASH;
    if (ok) Settings.set(UNLOCKED, true);
    return ok;
  },

  lock() { Settings.set(UNLOCKED, false); },

  /** Gives coins. Returns the new balance, or null if the tools are locked / the amount is no good. */
  give(amount) {
    const n = Math.floor(Number(amount));
    if (!this.isUnlocked() || !(n > 0)) return null;
    return Rocoins.add(Math.min(n, 1e7));
  },

  setInfinite(on) {
    if (!this.isUnlocked()) return false;
    Rocoins.setInfinite(on);
    return true;
  },
};
