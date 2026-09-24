import { Rocoins } from '../engine/Rocoins.js';
import {
  dailyChallenges, gameChallenges, EVERYWHERE, minutesSoFar, TIERS, todayKey,
} from '../engine/challenges.js';
import { allPowers, whyNot, findPower, usePower } from '../engine/Powers.js';
import { CATALOG } from '../games/catalog.js';
import { Account } from '../engine/Account.js';
import { SyncState, onSyncState, syncNow } from '../engine/RocoinSync.js';
import { openAccountDialog } from './AccountDialog.js';

/**
 * The Rocoins panel: your balance, the powers you can buy (in a list, or by
 * typing a command), and the challenges that earn the coins. Press ` or use the
 * coin button in the top bar / on the menu. It lives on document.body so it
 * works over the menu and over a running game alike.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// A drawn coin (see .rc-coin in styles.css) rather than the coin emoji, which older Windows versions can't show.
const COIN = '<span class="rc-coin" aria-hidden="true"></span>';

/** Small "+12 Rocoins" pop-ups for coins just earned. */
export function notifyEarned(list) {
  if (!list?.length || typeof document === 'undefined') return;
  let stack = document.querySelector('.rc-toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'rc-toasts';
    document.body.appendChild(stack);
  }
  list.forEach((c, i) => {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'rc-toast';
      el.innerHTML = `<b>${COIN} +${c.reward} Rocoins</b><span>${esc(c.text)}</span>`;
      stack.appendChild(el);
      setTimeout(() => el.remove(), 5200);
    }, i * 350);
  });
}

/**
 * @param {{ engine: object, getEntry: () => object|null,
 *           onOpen?: () => void, onClose?: () => void }} opts
 */
export function createAdmin({ engine, getEntry, onOpen, onClose }) {
  let root = null;
  let tab = 'powers';
  let outMsg = null;          // { ok, text } from the last command
  let busy = false;
  let unsub = null;
  let unsubSync = null;
  let unsubAcct = null;

  const ctx = () => ({ engine, game: engine.game, entry: getEntry() });

  const isOpen = () => Boolean(root);

  function close() {
    if (!root) return;
    unsub?.(); unsubSync?.(); unsubAcct?.();
    root.remove();
    root = null;
    removeEventListener('keydown', onKey, true);
    onClose?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); }
  }

  function open() {
    if (root) { root.querySelector('input')?.focus(); return; }
    onOpen?.();
    tab = engine.game ? 'powers' : 'challenges';   // in a game you want to shop; on the menu there is nothing to buy yet
    root = document.createElement('div');
    root.className = 'acct-backdrop rc-backdrop';
    document.body.appendChild(root);
    addEventListener('keydown', onKey, true);
    unsub = Rocoins.onChange(() => { updateBalance(); if (tab === 'powers') renderList(); else renderChallenges(); });
    unsubSync = onSyncState(updateSync);
    unsubAcct = Account.onChange(() => { if (root) { updateSync(); if (Account.isSignedIn()) syncNow(); } });
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    render();
    if (Account.isSignedIn()) syncNow();   // pick up anything your other devices earned or spent
  }

  const toggle = () => (isOpen() ? close() : open());

  /** The line under the balance: is it backed up to your account? */
  function updateSync() {
    const el = root?.querySelector('.rc-sync');
    if (!el) return;
    const who = Account.name();
    if (!who) {
      el.className = 'rc-sync';
      el.innerHTML = 'Only saved on this device. <button type="button" class="rc-link">Sign in</button> to back your Rocoins up to your account and use them anywhere.';
      el.querySelector('button').onclick = () => { close(); openAccountDialog(); };
      return;
    }
    const st = SyncState.status;
    el.className = `rc-sync ${st}`;
    el.textContent = st === 'syncing' ? `☁ Backing up to ${who}…`
      : st === 'error' ? `☁ ${SyncState.msg}`
      : `☁ Backed up to ${who}${SyncState.at ? '' : ' (as soon as it connects)'}`;
  }

  function updateBalance() {
    const b = root?.querySelector('.rc-bal');
    if (b) b.textContent = Rocoins.balance();
  }

  function render() {
    const entry = getEntry();
    root.innerHTML = `
      <div class="acct-card rc-card" role="dialog" aria-label="Rocoins and powers">
        <button class="acct-x" data-act="close" aria-label="Close">&times;</button>
        <h2>${COIN} Rocoins <span class="rc-bal">${Rocoins.balance()}</span></h2>
        <p class="rc-sync"></p>
        <p class="acct-note">Beat challenges to earn Rocoins, then spend them on powers in any game.${entry ? '' : ' Powers work while you are playing.'} Press <kbd>\`</kbd> any time to open this.</p>
        <div class="acct-tabs">
          <button data-tab="powers" class="${tab === 'powers' ? 'on' : ''}">Powers</button>
          <button data-tab="challenges" class="${tab === 'challenges' ? 'on' : ''}">Challenges</button>
        </div>
        <div class="rc-body"></div>
      </div>`;
    root.querySelector('[data-act="close"]').onclick = close;
    updateSync();
    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => { tab = b.dataset.tab; render(); };
    });
    if (tab === 'powers') renderPowers(); else renderChallenges();
  }

  // ---------- powers ----------

  function renderPowers() {
    const body = root.querySelector('.rc-body');
    body.innerHTML = `
      <form class="rc-cmd" autocomplete="off">
        <input name="cmd" type="text" placeholder="Type a command — try slowmo, or help" spellcheck="false" />
        <button class="acct-btn primary" type="submit">Run</button>
      </form>
      <p class="rc-out" aria-live="polite"></p>
      <ul class="rc-list"></ul>`;
    body.querySelector('form').onsubmit = (e) => { e.preventDefault(); runCommand(); };
    showOut();
    renderList();
    body.querySelector('input').focus();
  }

  function showOut() {
    const el = root?.querySelector('.rc-out');
    if (!el) return;
    el.textContent = outMsg?.text || '';
    el.className = `rc-out${outMsg ? (outMsg.ok ? ' ok' : ' bad') : ''}`;
  }

  function renderList() {
    const ul = root?.querySelector('.rc-list');
    if (!ul) return;
    const c = ctx();
    const list = allPowers(c);
    const bal = Rocoins.balance();
    ul.innerHTML = list.map((p) => {
      const on = p.toggle && p.active?.(c);
      const why = on ? null : whyNot(p, c);
      const poor = !on && !why && bal < p.cost;
      const note = why || (poor ? `Need ${p.cost - bal} more Rocoins` : '');
      return `
        <li class="rc-row${why || poor ? ' locked' : ''}${on ? ' on' : ''}" data-id="${esc(p.id)}">
          <span class="rc-ico" aria-hidden="true">${p.icon || '✨'}</span>
          <span class="rc-txt">
            <strong>${esc(p.name)}${p.own ? ' <em>this game</em>' : ''} <code>${esc(p.id)}</code></strong>
            <small>${esc(p.desc || '')}</small>
            ${note ? `<small class="rc-why">${esc(note)}</small>` : ''}
          </span>
          <button class="acct-btn rc-use${on ? '' : ' primary'}" data-use="${esc(p.id)}"${why || poor ? ' disabled' : ''}>
            ${on ? 'Turn off' : `${COIN} ${p.cost}`}
          </button>
        </li>`;
    }).join('');
    ul.querySelectorAll('[data-use]').forEach((b) => {
      b.onclick = () => run(list.find((p) => p.id === b.dataset.use));
    });
  }

  async function run(p) {
    if (!p || busy) return;
    busy = true;
    const r = await usePower(p, ctx());
    busy = false;
    outMsg = { ok: r.ok, text: r.msg };
    if (!root) return;
    showOut(); renderList(); updateBalance();
  }

  function runCommand() {
    const input = root.querySelector('[name="cmd"]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const word = text.replace(/^\//, '').toLowerCase();
    const list = allPowers(ctx());
    if (word === 'help' || word === '?') {
      outMsg = { ok: true, text: `Commands: ${list.map((p) => `${p.id} (${p.cost})`).join(', ')}, coins.` };
      showOut(); return;
    }
    if (word === 'coins' || word === 'balance') {
      outMsg = { ok: true, text: `You have ${Rocoins.balance()} Rocoins (${Rocoins.earned()} earned, ${Rocoins.spent()} spent).` };
      showOut(); return;
    }
    const p = findPower(word, list);
    if (!p) { outMsg = { ok: false, text: `No command called "${text}". Type help to see them all.` }; showOut(); return; }
    run(p);
  }

  // ---------- challenges ----------

  function row(ch, extra = '') {
    const done = Rocoins.isDone(ch.id);
    return `
      <li class="rc-ch${done ? ' done' : ''}">
        <span class="rc-tick" aria-hidden="true">${done ? '✓' : ''}</span>
        <span class="rc-txt"><strong>${esc(ch.text)}</strong>${extra ? `<small>${extra}</small>` : ''}</span>
        <span class="rc-pay">${done ? 'done' : `+${ch.reward}`}</span>
      </li>`;
  }

  function renderChallenges() {
    const body = root?.querySelector('.rc-body');
    if (!body) return;
    const entry = getEntry();
    const counters = Rocoins.counters();
    const daily = dailyChallenges();
    const parts = [];

    parts.push(`<h3 class="rc-h">Today <small>${esc(todayKey())} · new ones at midnight</small></h3>
      <ul class="rc-chs">${daily.map((d) => row(d)).join('')}</ul>`);

    if (entry) {
      const mins = entry.sandbox ? ` (${Math.floor(minutesSoFar(entry))} minutes so far)` : '';
      parts.push(`<h3 class="rc-h">${esc(entry.name)}${mins}</h3>
        <ul class="rc-chs">${gameChallenges(entry).map((c) => row(c, esc(c.tier))).join('')}</ul>`);
    }

    parts.push(`<h3 class="rc-h">Everywhere</h3>
      <ul class="rc-chs">${EVERYWHERE.map((c) => {
        const have = Math.min(c.have(counters), c.need);
        return row(c, `${have} / ${c.need}`);
      }).join('')}</ul>`);

    parts.push(`<details class="rc-all"><summary>All games</summary>
      <ul class="rc-games">${CATALOG.map((e) => `
        <li><span>${esc(e.name)}</span><span class="rc-chips">${gameChallenges(e).map((c, i) =>
          `<i class="${Rocoins.isDone(c.id) ? 'done' : ''}" title="${esc(c.text)} (+${c.reward})">${TIERS[i][0]}</i>`).join('')}</span></li>`).join('')}
      </ul></details>`);

    const keepOpen = body.querySelector('.rc-all')?.open;
    body.innerHTML = parts.join('');
    if (keepOpen) body.querySelector('.rc-all').open = true;
  }

  return { open, close, toggle, isOpen };
}
