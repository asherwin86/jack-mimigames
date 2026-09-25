import { WINDOWS_URL, ANDROID_URL, platform, canPromptInstall, promptInstall } from '../engine/Install.js';

/**
 * The "Get the app" window on the website: download the Windows app or the Android app, or install the site straight
 * from the browser. The choice that fits this device comes first. Lives on document.body like the account window.
 */
let open = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function openInstallDialog() {
  if (open) return;
  const here = platform();
  const root = document.createElement('div');
  root.className = 'acct-backdrop';
  document.body.appendChild(root);

  const close = () => { root.remove(); removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener('keydown', onKey, true);
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  open = { close };

  const browserInstall = () => {
    if (canPromptInstall()) {
      return { note: 'Adds 100 Mimi Games to your apps. It runs full-screen and keeps working offline.', button: '<button class="acct-btn primary" data-act="pwa">Install in this browser</button>' };
    }
    if (here === 'ios') {
      return { note: 'On iPhone/iPad: tap the Share button, then "Add to Home Screen". It runs full-screen and keeps working offline.', button: '' };
    }
    return { note: 'Your browser\'s menu (⋮ or the install icon in the address bar) has "Install app" / "Add to Home Screen" when the site is installable. It runs full-screen and keeps working offline.', button: '' };
  };

  const cards = () => {
    const web = browserInstall();
    const list = [
      { id: 'windows', title: 'Windows app', note: 'A normal installer. Updates itself, works offline and can host Blockcraft games.',
        button: `<a class="acct-btn primary" href="${WINDOWS_URL}" rel="noopener">Download for Windows</a>` },
      { id: 'android', title: 'Android app (APK)', note: 'Works fully offline, with on-screen touch controls and controller support (phones, tablets, Android TV). After downloading, open it and allow "install unknown apps" for your browser when Android asks.',
        button: `<a class="acct-btn primary" href="${ANDROID_URL}" rel="noopener">Download APK</a>` },
      { id: 'web', title: 'Install from the browser', note: web.note, button: web.button },
    ];
    // Put what fits this device first.
    const first = here === 'windows' ? 'windows' : here === 'android' ? 'android' : 'web';
    list.sort((a, b) => (a.id === first ? -1 : b.id === first ? 1 : 0));
    return list.map((c, i) => `
      <div class="inst-card${i === 0 ? ' best' : ''}">
        <h3>${esc(c.title)}${i === 0 ? ' <em>for this device</em>' : ''}</h3>
        <p>${esc(c.note)}</p>
        ${c.button ? `<div class="inst-row">${c.button}</div>` : ''}
      </div>`).join('');
  };

  root.innerHTML = `
    <div class="acct-card inst" role="dialog" aria-label="Get the app">
      <button class="acct-x" data-act="close" aria-label="Close">&times;</button>
      <h2>Get 100 Mimi Games</h2>
      <p class="acct-note">Play offline, full-screen, with no browser bars. Pick what suits your device — they're all free.</p>
      ${cards()}
    </div>`;
  root.querySelector('[data-act="close"]').onclick = close;
  root.querySelector('[data-act="pwa"]')?.addEventListener('click', async () => {
    const r = await promptInstall();
    if (r === 'accepted') close();
  });
}
