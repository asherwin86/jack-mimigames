/**
 * "Outside your Wi-Fi": makes the servers inside the app reachable from anywhere through Tailscale Funnel (free, no card,
 * a stable https address like https://my-pc.tail1234.ts.net). Funnel exposes a local port on one of three public ports
 * (443, 8443, 10000), so the account server and the game page go out on 443 and the PvP arena on 8443.
 *
 * This only drives the `tailscale` program the person installed and signed in to; it never handles their Tailscale login.
 * Kept free of Electron, with the program runner passed in, so it can be checked without Tailscale (scripts/check-host.mjs).
 *   run(file, args) -> Promise<{ code, stdout, stderr }>   (never rejects; a missing program is code -1)
 */
const path = require('path');

const HUB_PUBLIC_PORT = 443;
const PVP_PUBLIC_PORT = 8443;

function candidates(env = process.env) {
  const list = [];
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\Program Files']) if (base) list.push(path.join(base, 'Tailscale', 'tailscale.exe'));
  list.push('tailscale');   // on the PATH (macOS and Linux, or a custom install)
  return [...new Set(list)];
}

function createTailscale({ run, existsSync, env = process.env, hubPort, pvpPort }) {
  let cli = null;

  async function find() {
    if (cli) return cli;
    for (const c of candidates(env)) {
      if (c !== 'tailscale' && !existsSync(c)) continue;
      const r = await run(c, ['version']);
      if (r.code === 0) { cli = c; return cli; }
    }
    return null;
  }

  /** { state: 'missing' | 'stopped' | 'needs-login' | 'ready', name?, funnel: [{port, target}] } */
  async function status() {
    const c = await find();
    if (!c) return { state: 'missing', funnel: [] };
    const st = await run(c, ['status', '--json']);
    let j = null;
    try { j = JSON.parse(st.stdout); } catch { j = null; }
    if (!j) return { state: 'stopped', funnel: [] };
    const backend = String(j.BackendState || '');
    if (backend === 'NeedsLogin' || backend === 'NeedsMachineAuth') return { state: 'needs-login', funnel: [] };
    if (backend !== 'Running') return { state: 'stopped', funnel: [] };
    const name = String(j.Self?.DNSName || '').replace(/\.$/, '');
    const f = await run(c, ['funnel', 'status', '--json']);
    let fj = null;
    try { fj = JSON.parse(f.stdout); } catch { fj = null; }
    // The funnel status lists which public host:port answer; we only care whether ours are on.
    const on = (port) => !!fj && Object.keys(fj.AllowFunnel || {}).some((k) => k.endsWith(`:${port}`) && fj.AllowFunnel[k]);
    const hub = on(HUB_PUBLIC_PORT), pvp = on(PVP_PUBLIC_PORT);
    return { state: 'ready', name, funnel: [hub && { port: HUB_PUBLIC_PORT }, pvp && { port: PVP_PUBLIC_PORT }].filter(Boolean), on: hub && pvp };
  }

  /** The addresses people use once it is on. */
  const urls = (name) => (name ? { page: `https://${name}/`, arena: `wss://${name}:${PVP_PUBLIC_PORT}` } : null);

  const firstUrl = (text) => (String(text).match(/https:\/\/[^\s"']+/) || [null])[0];

  /** Turns both on. Resolves { ok, urls?, msg?, link? } (link: a page Tailscale wants the person to visit, e.g. to allow Funnel). */
  async function enable() {
    const c = await find();
    if (!c) return { ok: false, msg: 'Tailscale is not installed.' };
    const s = await status();
    if (s.state !== 'ready') return { ok: false, msg: s.state === 'needs-login' ? 'Open Tailscale and sign in first.' : 'Tailscale is not running. Open it and sign in.' };
    const a = await run(c, ['funnel', '--bg', `--https=${HUB_PUBLIC_PORT}`, `localhost:${hubPort}`]);
    const b = a.code === 0 ? await run(c, ['funnel', '--bg', `--https=${PVP_PUBLIC_PORT}`, `localhost:${pvpPort}`]) : null;
    const bad = [a, b].find((r) => r && r.code !== 0);
    if (bad) {
      const out = `${bad.stdout}\n${bad.stderr}`.trim();
      const link = firstUrl(out);
      return { ok: false, msg: link ? 'Tailscale needs you to allow Funnel for this computer first. Open the link, then press the button again.' : (out.split('\n').find((l) => l.trim()) || 'Tailscale could not turn it on.'), link };
    }
    return { ok: true, urls: urls(s.name) };
  }

  /** Turns both off. */
  async function disable() {
    const c = await find();
    if (!c) return { ok: true };
    await run(c, ['funnel', `--https=${HUB_PUBLIC_PORT}`, 'off']);
    await run(c, ['funnel', `--https=${PVP_PUBLIC_PORT}`, 'off']);
    return { ok: true };
  }

  return { find, status, enable, disable, urls, HUB_PUBLIC_PORT, PVP_PUBLIC_PORT };
}

module.exports = { createTailscale, HUB_PUBLIC_PORT, PVP_PUBLIC_PORT };
