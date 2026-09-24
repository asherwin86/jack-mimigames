import { Account, hubUrl } from '../engine/Account.js';

/**
 * The sign-in / create-account / sign-out window. One dialog for the whole
 * arcade: the menu's account button opens it, and so does Blockcraft's
 * "Sign in" link. It lives on document.body so it works over the menu and
 * over a running game alike.
 */
let open = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function openAccountDialog() {
  if (open) { open.focus(); return; }
  const root = document.createElement('div');
  root.className = 'acct-backdrop';
  document.body.appendChild(root);

  let tab = 'signin';        // 'signin' | 'signup'
  let busy = false;
  let message = null;        // { ok, text }
  let confirmDelete = false;
  let unsub = null;

  const close = () => {
    unsub?.();
    root.remove();
    removeEventListener('keydown', onKey, true);
    open = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); }
  };
  addEventListener('keydown', onKey, true);
  open = { focus: () => root.querySelector('input')?.focus(), close };

  const setMessage = (ok, text) => { message = text ? { ok, text } : null; render(); };

  async function submit() {
    if (busy) return;
    const name = root.querySelector('[name="name"]')?.value ?? '';
    const pw = root.querySelector('[name="password"]')?.value ?? '';
    if (tab === 'signup' && pw !== (root.querySelector('[name="confirm"]')?.value ?? '')) { setMessage(false, "Those passwords don't match."); return; }
    busy = true; message = { ok: true, text: 'Contacting the account server… (if it has been asleep this can take up to a minute)' }; render();
    const r = tab === 'signup' ? await Account.signUp(name, pw) : await Account.signIn(name, pw);
    busy = false;
    if (r.ok) { message = null; close(); return; }
    setMessage(false, r.msg || 'Something went wrong.');
  }

  async function doDelete() {
    if (busy) return;
    const pw = root.querySelector('[name="delpw"]')?.value ?? '';
    if (!pw) { setMessage(false, 'Enter your password to confirm.'); return; }
    busy = true; message = { ok: true, text: 'Deleting…' }; render();
    const r = await Account.deleteAccount(pw);
    busy = false;
    if (r.ok) { confirmDelete = false; setMessage(true, 'Your account and its saved worlds were deleted.'); return; }
    setMessage(false, r.msg || 'Could not delete the account.');
  }

  function render() {
    // Re-rendering rebuilds the form, so carry over what's been typed (a mistake message shouldn't wipe the fields).
    const typed = {};
    root.querySelectorAll('input').forEach((i) => { typed[i.name] = i.value; });
    const s = Account.session();
    const msgHtml = message ? `<p class="acct-msg ${message.ok ? 'ok' : 'bad'}" role="status">${esc(message.text)}</p>` : '';
    root.innerHTML = `
      <div class="acct-card" role="dialog" aria-modal="true" aria-label="Account">
        <button class="acct-x" type="button" aria-label="Close">&times;</button>
        ${s ? `
          <h2>Signed in</h2>
          <p class="acct-hello">You're signed in as <strong>${esc(s.name)}</strong>.</p>
          <p class="acct-note">Your Blockcraft worlds are saved to this account, and Kart Circuit knows who you are for online races. Sign in with the same name and password on any device.</p>
          ${msgHtml}
          <div class="acct-row">
            <button class="acct-btn" type="button" data-act="signout">Sign out</button>
            <button class="acct-btn danger" type="button" data-act="delete-start">Delete account…</button>
          </div>
          ${confirmDelete ? `
            <div class="acct-danger">
              <p>This permanently deletes the account and every world saved to it. Type your password to confirm.</p>
              <input name="delpw" type="password" autocomplete="current-password" placeholder="Password" />
              <button class="acct-btn danger" type="button" data-act="delete-go">Delete for good</button>
            </div>` : ''}
        ` : `
          <h2>${tab === 'signin' ? 'Sign in' : 'Create an account'}</h2>
          <div class="acct-tabs">
            <button type="button" data-tab="signin" class="${tab === 'signin' ? 'on' : ''}">Sign in</button>
            <button type="button" data-tab="signup" class="${tab === 'signup' ? 'on' : ''}">Create account</button>
          </div>
          <p class="acct-note">${tab === 'signin'
            ? 'Sign in to keep your Blockcraft worlds on your account and use them on any device.'
            : 'Pick a name and a password. It only takes a moment, and there is no email to give.'}</p>
          <form class="acct-form" autocomplete="on">
            <label>Name<input name="name" type="text" autocomplete="username" maxlength="24" placeholder="Your name" /></label>
            <label>Password<input name="password" type="password" autocomplete="${tab === 'signup' ? 'new-password' : 'current-password'}" placeholder="Password" /></label>
            ${tab === 'signup' ? '<label>Confirm password<input name="confirm" type="password" autocomplete="new-password" placeholder="Password again" /></label>' : ''}
            ${msgHtml}
            <button class="acct-btn primary" type="submit"${busy ? ' disabled' : ''}>${tab === 'signin' ? 'Sign in' : 'Create account'}</button>
          </form>
          <p class="acct-fine">Server: ${esc(hubUrl().replace(/^https?:\/\//, ''))}</p>
        `}
      </div>`;
    root.querySelectorAll('input').forEach((i) => { if (typed[i.name]) i.value = typed[i.name]; });
    root.querySelector('.acct-x')?.addEventListener('click', close);
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; message = null; render(); }));
    root.querySelector('.acct-form')?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    root.querySelector('[data-act="signout"]')?.addEventListener('click', () => { Account.signOut(); message = null; confirmDelete = false; render(); });
    root.querySelector('[data-act="delete-start"]')?.addEventListener('click', () => { confirmDelete = !confirmDelete; message = null; render(); });
    root.querySelector('[data-act="delete-go"]')?.addEventListener('click', doDelete);
    // Typing here must never reach the game's own key handling (WASD, Space, Q/E…).
    for (const el of root.querySelectorAll('input')) {
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    root.querySelector('.acct-card')?.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (!busy) root.querySelector('input')?.focus();
  }

  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  unsub = Account.onChange(() => { if (open) render(); });
  render();
}
