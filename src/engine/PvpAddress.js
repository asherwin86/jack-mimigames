/**
 * Where Blockcraft's PvP arena is. Like the account server (see Account.js), the answer depends on where the page runs:
 *   - served by a computer that is hosting (window.MIMI_LOCAL_HOST): that computer's arena, on the port it stamped into the page
 *     (window.MIMI_PVP_PORT), at the address this page was opened from;
 *   - the Windows app with its own arena running (engine/Host.js tells us): this computer's arena;
 *   - otherwise the public arena on the website's side (VITE_PVP_SERVER can point a build somewhere else; an empty value hides it).
 * Looked up when it is needed, never saved, so a change in what is running is picked up on the next use.
 */
const PUBLIC_PVP = 'wss://blockcraft-pvp.onrender.com';
let autoPvp = null;

/** Set (or, with null, cleared) by engine/Host.js when this computer's own arena is running. */
export function setAutoPvp(url) { autoPvp = url ? String(url).replace(/\/+$/, '') : null; }

/** The arena's websocket address ('' when a build turned it off). */
export function pvpUrl() {
  if (typeof window !== 'undefined' && window.MIMI_LOCAL_HOST === true && Number(window.MIMI_PVP_PORT) > 0) {
    // Through the https tunnel (Tailscale Funnel) the arena is on its own public port with TLS; on the home network it is plain.
    const secure = location.protocol === 'https:';
    const port = secure ? Number(window.MIMI_PVP_TLS_PORT) || 8443 : Number(window.MIMI_PVP_PORT);
    return `${secure ? 'wss' : 'ws'}://${location.hostname}:${port}`;
  }
  if (autoPvp) return autoPvp;
  const env = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PVP_SERVER : undefined;
  return env ?? PUBLIC_PVP;
}

/** The same server over http, for its public server list. */
export const registryUrl = () => pvpUrl().replace(/^ws/i, 'http').replace(/\/+$/, '');
