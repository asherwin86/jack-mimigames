import { setAutoHub } from './Account.js';
import { setAutoPvp } from './PvpAddress.js';

/**
 * The home server: the stable public address of the computer that hosts the servers (its Tailscale Funnel address, like
 * https://my-pc.tail1234.ts.net). Empty until one is chosen. When it is set, every device (the website, the phone and TV apps,
 * the Windows app on other computers) tries it first and quietly keeps using the website's own servers if it does not
 * answer within a few seconds, so a computer that is switched off never breaks sign-in. Someone's own saved address
 * (the admin console's `hub` command) still wins, and a page served by a host already uses that host.
 */
export const HOME_SERVER = '';

const TIMEOUT_MS = 3500;

export async function chooseHomeServer(home = HOME_SERVER) {
  if (!home || typeof window === 'undefined' || window.MIMI_LOCAL_HOST === true || window.mimiDesktop?.host) return false;
  const base = home.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/health`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    setAutoHub(base);
    setAutoPvp(`wss://${new URL(base).hostname}:8443`);
    return true;
  } catch { return false; }
}

