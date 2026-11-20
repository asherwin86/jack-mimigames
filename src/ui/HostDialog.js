import { desktopHost, alwaysUseLocalHub, setAlwaysUseLocalHub, applyDesktopChoice } from '../engine/Host.js';
import { defaultHubUrl } from '../engine/Account.js';

/**
 * "Host for other devices" — the Windows app only. Shows the addresses other devices on the same Wi-Fi can open (with a
 * QR code for the first), whether this computer is announced on the website so a visitor on the same network is
 * offered a link, and the "always use this computer's server in this app" choice. The server lives in the app's own
 * process (see electron/main.js); this only asks it, through the preload bridge. Lives on document.body like the others.
 */
let open = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function openHostDialog() {
  if (open) return;
  const host = desktopHost();
  if (!host) return;
  const root = document.createElement('div');
  root.className = 'acct-backdrop';
  document.body.appendChild(root);
  const close = () => { root.remove(); removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  open = { close };

  root.innerHTML = `
    <div class="acct-card inst" role="dialog" aria-label="Host for other devices">
      <button class="acct-x" data-act="close" aria-label="Close">&times;</button>
      <h2>Host for other devices</h2>
      <p class="acct-note">Phones, tablets and computers on the same Wi-Fi can play from this computer instead of the website. Open one of these addresses on them, or scan the code.</p>
      <div data-el="body"><p class="acct-note">Looking…</p></div>
    </div>`;
  root.querySelector('[data-act="close"]').onclick = close;
  const body = root.querySelector('[data-el="body"]');

  let selected = '';
  async function showQr(box, url) {
    selected = url;
    try {
      const { default: qrcode } = await import('qrcode-generator');
      if (selected !== url || !box.isConnected) return;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      const svg = box.querySelector('svg');
      if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
      box.hidden = false;
    } catch { box.hidden = true; }
  }

  /** The account storage form: the website's database address, token and password pepper, saved on this computer only. */
  async function renderStorage(box, info) {
    const st = info.storage || { configured: false };
    if (st.configured) {
      const remote = await fetch(`${defaultHubUrl()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
      if (!open || !box.isConnected) return;
      box.innerHTML = `
        <p class="acct-note"><b>Using the website's account storage</b> (${esc(st.where)}). The accounts, Rocoins and parental controls here are the same ones the website has, and this computer's server is the default address in this app.${st.encrypted ? '' : ' (Saved without encryption: this system could not encrypt it.)'}</p>
        ${remote ? '<p class="acct-note bad" style="color:#ffb86b"><b>The website\'s account server is running too.</b> Two servers writing the same storage can overwrite each other\'s newest accounts. Use this computer\'s server only while the website\'s is down: remove the storage here when it is back.</p>' : ''}
        <div class="inst-row"><button class="acct-btn" data-el="clear">Remove the saved storage</button></div>`;
      box.querySelector('[data-el="clear"]').onclick = async (e) => { e.target.disabled = true; await host.clearStorage().catch(() => {}); setTimeout(async () => { await applyDesktopChoice(); render(); }, 2200); };
      return;
    }
    box.innerHTML = `
      <p class="acct-note">To keep every account the website has, give this computer's server the same storage. Open the old server on Render (Environment tab) and copy three values. They are saved on this computer only, encrypted, and never shown again.</p>
      <label class="acct-label">UPSTASH_REDIS_REST_URL<input type="text" data-el="s-url" placeholder="https://something.upstash.io" autocomplete="off" spellcheck="false"></label>
      <label class="acct-label">UPSTASH_REDIS_REST_TOKEN<input type="password" data-el="s-token" autocomplete="off"></label>
      <label class="acct-label">HASH_PEPPER (exactly the same one, or no password will match)<input type="password" data-el="s-pepper" autocomplete="off"></label>
      <div class="inst-row"><button class="acct-btn primary" data-el="save">Save and use this computer's server</button></div>
      <p class="acct-fine" data-el="s-msg" aria-live="polite"></p>`;
    for (const el of box.querySelectorAll('input')) { el.addEventListener('keydown', (e) => e.stopPropagation()); el.addEventListener('keyup', (e) => e.stopPropagation()); }
    box.querySelector('[data-el="save"]').onclick = async (e) => {
      const msg = box.querySelector('[data-el="s-msg"]');
      e.target.disabled = true; msg.textContent = 'Saving…';
      const r = await host.saveStorage({ url: box.querySelector('[data-el="s-url"]').value, token: box.querySelector('[data-el="s-token"]').value, pepper: box.querySelector('[data-el="s-pepper"]').value }).catch(() => ({ ok: false, msg: 'Could not save.' }));
      if (!r.ok) { msg.textContent = r.msg || 'Could not save.'; e.target.disabled = false; return; }
      msg.textContent = 'Saved. Restarting this computer\'s server… (sign out and in once if you were signed in)';
      setTimeout(async () => { await applyDesktopChoice(); render(); }, 3000);
    };
  }

  async function render() {
    const info = await host.info().catch(() => null);
    if (!open) return;
    if (!info || !info.ok) {
      body.innerHTML = `<p class="acct-note">The server inside this app is not running, so there is nothing to share. If another copy of the app is open, close it and reopen this one.</p>`;
      return;
    }
    const hb = info.heartbeat || {};
    const pvp = info.pvp || { on: false, running: false, port: 7443 };
    const sharing = info.sharing !== false;
    const status = !sharing ? "Hosting is stopped. Other devices can't connect until you start it again. This app still works as normal."
      : !info.announcing ? 'Not announced on the website. Other devices need the address above.'
      : hb.ok === true ? 'Announced on the website. A phone or computer on your network that opens it will be offered a link here.'
      : hb.ok === false ? `Not announced yet: ${hb.error || "couldn't reach the website."} The address above still works.`
      : 'Announcing…';
    body.innerHTML = `
      <div class="inst-row" style="margin:0 0 10px"><button class="acct-btn${sharing ? '' : ' primary'}" data-el="power">${sharing ? '&#9209; Stop hosting' : '&#9654; Start hosting'}</button></div>
      <div data-el="list" style="display:flex;flex-direction:column;gap:6px;margin:0 0 10px${sharing ? '' : ';opacity:.45'}">
        ${info.addresses.length ? '' : '<p class="acct-note">No Wi-Fi or network connection found. Connect this computer to your network, then reopen this window.</p>'}
      </div>
      <div data-el="qr" hidden style="width:168px;height:168px;background:#fff;border-radius:8px;padding:6px;box-sizing:border-box;margin:0 0 10px${sharing ? '' : ';opacity:.25'}"></div>
      <label class="acct-check"><input type="checkbox" data-el="announce"${info.announce !== false ? ' checked' : ''}${sharing ? '' : ' disabled'}> <span>Announce this computer on the website, so devices on the same network that open it are offered a link here.</span></label>
      <p class="acct-fine" data-el="status">${esc(status)}</p>
      <label class="acct-check"><input type="checkbox" data-el="always"${alwaysUseLocalHub() ? ' checked' : ''}${info.storage?.configured ? ' disabled' : ''}> <span>Always use this computer's server for accounts in this app.${info.storage?.configured ? ' (On already: it has the same account storage as the website.)' : ' Otherwise it is only used when the website\'s server is down. Without account storage (below), accounts are separate on each server.'}</span></label>
      <h3 class="inst-h" style="margin:14px 0 6px">Blockcraft PvP arena</h3>
      <div class="inst-row" style="margin:0 0 6px"><button class="acct-btn${pvp.on ? '' : ' primary'}" data-el="pvp">${pvp.on ? '&#9209; Stop the arena' : '&#9654; Start the arena'}</button></div>
      <p class="acct-fine" data-el="pvpstatus">${pvp.on ? (pvp.running ? `Running on port ${pvp.port}${pvp.maxPlayers ? `, ${pvp.players} of ${pvp.maxPlayers} players` : ''}. In this app, Blockcraft's "Join PvP Arena" goes here. Devices on your Wi-Fi that open this computer's address get it too.` : 'Starting…') : "Stopped. Blockcraft's PvP arena button uses the website's arena."}</p>
      <h3 class="inst-h" style="margin:14px 0 6px">Account storage</h3>
      <div data-el="storage"></div>
      <p class="acct-fine">The first time, Windows may ask to allow network access. Choose Private networks.</p>`;
    const list = body.querySelector('[data-el="list"]');
    const qrBox = body.querySelector('[data-el="qr"]');
    info.addresses.forEach((a, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const addr = document.createElement('button');
      addr.type = 'button'; addr.className = 'acct-btn'; addr.style.fontFamily = 'monospace'; addr.textContent = a.url;
      addr.title = `Show the QR code for this address (${a.iface})`;
      addr.onclick = () => showQr(qrBox, a.url);
      const copy = document.createElement('button');
      copy.type = 'button'; copy.className = 'acct-btn small'; copy.textContent = 'Copy';
      copy.onclick = () => { navigator.clipboard?.writeText(a.url).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); }).catch(() => {}); };
      row.append(addr, copy);
      list.appendChild(row);
      if (i === 0) showQr(qrBox, a.url);
    });
    const power = body.querySelector('[data-el="power"]');
    power.onclick = async () => {
      power.disabled = true;
      await host.sharing(!sharing).catch(() => {});
      setTimeout(render, 1200);
    };
    const announce = body.querySelector('[data-el="announce"]');
    announce.onchange = async () => {
      announce.disabled = true;
      await host.announce(announce.checked).catch(() => {});
      setTimeout(async () => { await render(); }, 1500);
    };
    body.querySelector('[data-el="always"]').onchange = (e) => setAlwaysUseLocalHub(e.target.checked);
    body.querySelector('[data-el="pvp"]').onclick = async (e) => { e.target.disabled = true; await host.pvp(!pvp.on).catch(() => {}); setTimeout(async () => { await applyDesktopChoice(); render(); }, 1800); };
    renderStorage(body.querySelector('[data-el="storage"]'), info);
  }
  render();
}
