import { Rocoins } from '../engine/Rocoins.js';
import { RocoinTools } from '../engine/RocoinTools.js';
import { Account, hubUrl, setHubUrl } from '../engine/Account.js';
import { CATALOG } from '../games/catalog.js';
import { LINKED } from '../engine/LinkedGames.js';
import { controlsOn, parental } from '../engine/ParentalState.js';
import { makeCommands } from '../engine/AdminCommands.js';

/**
 * The admin console: a password-gated window with commands (give Rocoins, infinite Rocoins, open any game, change the
 * account server, refresh the app...) and a few quick buttons. Open it from Settings > Admin, or press Shift + ` .
 * The password is the same one that unlocks the Rocoin tools in the account window (only its hash is in the code). It is a
 * client-side gate: it keeps casual clicking out, it is not real security.
 * It refuses to open while parental controls are on for this device, so a child cannot use it to get around them.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let panel = null;

function infoText() {
  const s = Account.session();
  const p = parental();
  const st = p?.status();
  return [
    `Build: ${typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'}`,
    `Address: ${location.origin}${location.pathname}`,
    `Account: ${s ? s.name : 'signed out'}   Account server: ${hubUrl()}`,
    `Rocoins: ${Rocoins.infinite() ? 'infinite' : Rocoins.balance()}`,
    `Parental controls: ${p?.hasPin() ? (p.enabled() ? 'on' : 'set up, off here') : 'not set up'}${st?.enabled ? `, played ${Math.round(st.used / 60)} min today` : ''}`,
    `Device: ${navigator.userAgent.slice(0, 110)}`,
    `Screen: ${innerWidth}x${innerHeight}   Online: ${navigator.onLine ? 'yes' : 'no'}`,
  ].join('\n');
}

async function pingHub() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${hubUrl()}/health`, { signal: AbortSignal.timeout(50000) });
    const j = await r.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    return r.ok ? { ok: true, text: `Account server answered in ${ms} ms${j.profiles !== undefined ? ` (${j.profiles} accounts)` : ''}.` } : { ok: false, text: `Account server answered ${r.status}${r.status === 503 ? ' (suspended or asleep)' : ''}.` };
  } catch {
    return { ok: false, text: "Couldn't reach the account server (offline, or the address is wrong)." };
  }
}

async function refreshApp() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await globalThis.caches?.keys?.()) || [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* nothing to clear */ }
  location.reload();
}

export function openAdminConsole() {
  if (panel) { panel.focus(); return; }
  const root = document.createElement('div');
  root.className = 'acct-backdrop ad-backdrop';
  document.body.appendChild(root);
  const log = [];
  const history = [];
  let hpos = 0;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener('keydown', onKey, true);
  function close() { removeEventListener('keydown', onKey, true); root.remove(); panel = null; }
  panel = { focus: () => root.querySelector('input')?.focus() };
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  const card = (inner) => { root.innerHTML = `<div class="acct-card ad-card" role="dialog" aria-modal="true" aria-label="Admin console"><button class="acct-x" type="button" aria-label="Close">&times;</button>${inner}</div>`; root.querySelector('.acct-x').onclick = close; return root.querySelector('.ad-card'); };
  const stop = (el) => { for (const x of el.querySelectorAll('input')) { x.addEventListener('keydown', (e) => e.stopPropagation()); x.addEventListener('keyup', (e) => e.stopPropagation()); } };

  if (controlsOn()) {
    card('<h2>Admin console</h2><p class="acct-note">Parental controls are on for this device, so the admin console is switched off. A parent can turn the controls off for this device in Settings &gt; Parental controls.</p>');
    return;
  }

  const games = [...CATALOG.map((g) => ({ id: g.id, name: g.name })), ...LINKED.filter((l) => l.kind === 'page').map((l) => ({ id: l.id, name: l.name }))];
  const env = {
    Rocoins, tools: RocoinTools, games,
    go: (hash) => { close(); location.hash = hash; },
    info: infoText,
    hub: { url: hubUrl, set: setHubUrl, ping: pingHub },
    season: (v) => { const u = new URL(location.href); if (v === 'auto') u.searchParams.delete('season'); else u.searchParams.set('season', v); setTimeout(() => location.assign(u.toString()), 400); },
    refresh: () => setTimeout(refreshApp, 400),
    lock: () => { RocoinTools.setInfinite(false); RocoinTools.lock(); setTimeout(gate, 0); },
    clear: () => { log.length = 0; },
  };
  const cmds = makeCommands(env);

  function gate(msg = '') {
    const c = card(`<h2>Admin console</h2><p class="acct-note">Enter the admin password.</p>
      <form class="ad-form" autocomplete="off"><input type="password" name="pw" placeholder="Password" autocomplete="off" /><button class="acct-btn primary" type="submit">Unlock</button></form>
      <p class="ad-msg bad" aria-live="polite">${esc(msg)}</p>`);
    stop(c);
    c.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const ok = await RocoinTools.unlock(c.querySelector('[name=pw]').value);
      if (ok) consoleView(); else gate('That is not the password.');
    };
    c.querySelector('input').focus();
  }

  function consoleView() {
    const c = card(`<h2>Admin console</h2>
      <div class="ad-bal"><span class="ad-bal-n"></span>
        <span class="ad-quick"><button class="acct-btn small" data-run="give 100">+100</button><button class="acct-btn small" data-run="give 1000">+1,000</button><button class="acct-btn small" data-run="give 100000">+100,000</button><button class="acct-btn small" data-run="infinite toggle">&infin; Infinite</button></span></div>
      <pre class="ad-log" aria-live="polite" tabindex="0"></pre>
      <form class="ad-form" autocomplete="off"><input type="text" name="cmd" placeholder="Type a command, or help" spellcheck="false" autocapitalize="off" /><button class="acct-btn primary" type="submit">Run</button></form>
      <div class="ad-quick ad-foot"><button class="acct-btn small" data-run="help">Help</button><button class="acct-btn small" data-run="info">Info</button><button class="acct-btn small" data-run="hub ping">Test server</button><button class="acct-btn small" data-run="refresh">Refresh app</button><button class="acct-btn small" data-run="lock">Lock</button></div>`);
    stop(c);
    const out = c.querySelector('.ad-log'), input = c.querySelector('[name=cmd]'), bal = c.querySelector('.ad-bal-n');
    const draw = () => { out.innerHTML = log.map((l) => `<div class="${l.cls}">${esc(l.text)}</div>`).join(''); out.scrollTop = out.scrollHeight; bal.textContent = `Rocoins: ${Rocoins.infinite() ? '∞' : Rocoins.balance()}`; };
    const say = (cls, text) => { if (text) { log.push({ cls, text }); if (log.length > 80) log.shift(); } draw(); };
    if (!log.length) say('ok', 'Unlocked. Type help to see the commands.');
    else draw();
    async function exec(line) {
      line = line === 'infinite toggle' ? `infinite ${Rocoins.infinite() ? 'off' : 'on'}` : line;
      say('cmd', `> ${line}`);
      if (!/^\s*(clear|lock)\b/.test(line)) { history.push(line); hpos = history.length; }
      const r = await cmds.run(line);
      if (root.isConnected && c.isConnected) say(r.ok ? 'ok' : 'bad', r.text); else return;
    }
    c.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ''; if (v.trim()) exec(v); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && hpos > 0) { input.value = history[--hpos]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hpos = Math.min(history.length, hpos + 1); input.value = history[hpos] || ''; e.preventDefault(); }
    });
    c.querySelectorAll('[data-run]').forEach((b) => { b.onclick = () => exec(b.dataset.run); });
    const off = Rocoins.onChange(() => { if (!root.isConnected) off(); else bal.textContent = `Rocoins: ${Rocoins.infinite() ? '∞' : Rocoins.balance()}`; });
    input.focus();
  }

  if (RocoinTools.isUnlocked()) consoleView(); else gate();
}
