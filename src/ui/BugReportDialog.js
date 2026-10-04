import { Account } from '../engine/Account.js';
import { keepInside } from '../engine/ParentalState.js';

/**
 * "Report a problem": a small form anyone can use (signed in or not). Reports
 * go to the account server; only the arcade owner's account can read them, and
 * for that account this window also shows the inbox.
 */
let open = null;

const CATEGORIES = [['bug', 'Something is broken'], ['suggestion', 'An idea'], ['other', 'Something else']];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const when = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

export function openBugReport({ game = '' } = {}) {
  if (keepInside()) return;   // parental controls
  if (open) { open.focus(); return; }
  const root = document.createElement('div');
  root.className = 'acct-backdrop';
  document.body.appendChild(root);

  let tab = 'send';           // 'send' | 'inbox'
  let busy = false;
  let message = null;         // { ok, text }
  let sent = false;
  let inbox = null;           // null = not asked / not the owner, else array
  let isOwner = false;

  const close = () => { root.remove(); removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener('keydown', onKey, true);
  open = { focus: () => root.querySelector('textarea')?.focus(), close };

  async function send() {
    if (busy) return;
    const cat = root.querySelector('[name="category"]:checked')?.value || 'bug';
    const text = root.querySelector('[name="message"]')?.value ?? '';
    const includeInfo = root.querySelector('[name="info"]')?.checked ?? true;
    if (text.trim().length < 5) { message = { ok: false, text: 'Tell us a little more: at least a few words.' }; render(); return; }
    busy = true; message = { ok: true, text: 'Sending... (if the server was asleep this can take up to a minute)' }; render();
    const r = await Account.reportBug({ category: cat, message: text, game, includeInfo });
    busy = false;
    if (r.ok) { sent = true; message = null; } else message = { ok: false, text: r.msg || 'Could not send that. Try again in a moment.' };
    render();
  }

  async function loadInbox() {
    const r = await Account.reports();
    if (!open) return;
    if (r.ok) { isOwner = true; inbox = r.reports; } else { isOwner = false; inbox = null; }
    render();
  }

  async function done(id) {
    const r = await Account.closeReport(id);
    if (r.ok) inbox = r.reports;
    render();
  }

  function render() {
    const typed = root.querySelector('[name="message"]')?.value ?? '';
    const cat = root.querySelector('[name="category"]:checked')?.value || 'bug';
    const info = root.querySelector('[name="info"]')?.checked ?? true;
    const msg = message ? `<p class="acct-msg ${message.ok ? 'ok' : 'bad'}" role="status">${esc(message.text)}</p>` : '';
    const tabs = isOwner ? `<div class="acct-tabs"><button type="button" data-tab="send" class="${tab === 'send' ? 'on' : ''}">Send a report</button><button type="button" data-tab="inbox" class="${tab === 'inbox' ? 'on' : ''}">Inbox (${inbox?.length ?? 0})</button></div>` : '';
    let body;
    if (tab === 'inbox' && isOwner) {
      body = `<div class="bug-list">${(inbox || []).map((r) => `
        <div class="bug-item">
          <div class="bug-meta"><strong>${esc(r.category)}</strong> &middot; ${esc(r.name)} &middot; ${esc(r.context?.game || 'no game')} &middot; ${esc(when(r.createdAt))}</div>
          <p>${esc(r.message)}</p>
          <small>${esc([r.context?.platform, r.context?.build, r.context?.screen].filter(Boolean).join(' · '))}</small>
          <button class="acct-btn small" type="button" data-done="${esc(r.id)}">Done</button>
        </div>`).join('') || '<p class="acct-note">No reports right now.</p>'}</div>`;
    } else if (sent) {
      body = `<p class="acct-hello">Thank you! Your report was sent.</p><p class="acct-note">It goes straight to the person who makes the arcade. If you gave a name by signing in, they can see who it was from.</p>
        <div class="acct-row"><button class="acct-btn primary" type="button" data-act="close">Close</button><button class="acct-btn" type="button" data-act="another">Send another</button></div>`;
    } else {
      body = `<p class="acct-note">Found something broken, or have an idea? Tell us what happened${game ? ` in <strong>${esc(game)}</strong>` : ''}. Please don't put passwords or private details in here.</p>
        <form class="acct-form">
          <div class="bug-cats">${CATEGORIES.map(([v, l]) => `<label class="acct-check"><input type="radio" name="category" value="${v}"${v === cat ? ' checked' : ''} /> ${l}</label>`).join('')}</div>
          <label>What happened?<textarea name="message" rows="5" maxlength="2000" placeholder="For example: the pieces stop falling after level 3 and I can't move."></textarea></label>
          <label class="acct-check"><input type="checkbox" name="info"${info ? ' checked' : ''} /> Include the game and my device (helps us fix it)</label>
          ${msg}
          <button class="acct-btn primary" type="submit"${busy ? ' disabled' : ''}>Send report</button>
        </form>`;
    }
    root.innerHTML = `<div class="acct-card bug-card" role="dialog" aria-modal="true" aria-label="Report a problem"><button class="acct-x" type="button" aria-label="Close">&times;</button><h2>Report a problem</h2>${tabs}${body}</div>`;
    const ta = root.querySelector('[name="message"]');
    if (ta) ta.value = typed;
    root.querySelector('.acct-x')?.addEventListener('click', close);
    root.querySelector('[data-act="close"]')?.addEventListener('click', close);
    root.querySelector('[data-act="another"]')?.addEventListener('click', () => { sent = false; message = null; render(); });
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    root.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => done(b.dataset.done)));
    root.querySelector('.acct-form')?.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    // Typing here must never reach the game's own key handling.
    for (const el of root.querySelectorAll('input, textarea')) {
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    root.querySelector('.acct-card')?.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (!busy && tab === 'send' && !sent) root.querySelector('textarea')?.focus();
  }

  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  render();
  if (Account.isSignedIn()) loadInbox();   // only the arcade owner's account gets an inbox tab
}
