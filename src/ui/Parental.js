import { CATALOG, ALL_TAGS } from '../games/catalog.js';
import { LINKED } from '../engine/LinkedGames.js';
import { parental, minutesText, timeLeftText } from '../engine/ParentalState.js';
import { Account } from '../engine/Account.js';
import { ParentalLink, onLinkChange, linkInfo, requestLink, unlinkNow, pullNow, acceptRequest, declineRequest } from '../engine/ParentalSync.js';

/**
 * The screens for the parental controls (the rules and the timer are in public/parental-core.js):
 *   - openParentalPanel(): the PIN, then the settings (play time, hours, breaks, blocked games...).
 *   - the lock screen: "that is all the play time for today" with a keypad where a parent can add time.
 *   - warnings (5 and 1 minute left) and break reminders.
 * The PIN keypad is made of buttons, so it works with a mouse, a finger or a controller's cursor (there is no keyboard on a TV).
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock12 = (hm) => new Date(2000, 0, 1, Number(hm.slice(0, 2)), Number(hm.slice(3))).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const LIMITS = [[0, 'No limit'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1 h 30 min'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];
const BREAKS = [[0, 'Off'], [20, 'Every 20 min'], [30, 'Every 30 min'], [45, 'Every 45 min'], [60, 'Every hour']];

/* ----------------------------------------------------------------- PIN keypad */

/** A keypad inside `host`. Calls onSubmit(pin) on OK / Enter. Returns { message(text, good), clear() }. */
function pinPad(host, { title, hint = '', submitLabel = 'OK', onSubmit }) {
  let value = '';
  host.innerHTML = `
    <div class="pc-pin" tabindex="-1">
      <div class="pc-title">${esc(title)}</div>
      ${hint ? `<p class="pc-note">${esc(hint)}</p>` : ''}
      <div class="pc-dots" aria-live="polite"></div>
      <p class="pc-msg" role="status"></p>
      <div class="pc-keys">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="back" aria-label="Delete">&#9003;</button>
        <button type="button" data-k="0">0</button>
        <button type="button" class="ok" data-k="ok">${esc(submitLabel)}</button>
      </div>
    </div>`;
  const pad = host.querySelector('.pc-pin');
  const dots = host.querySelector('.pc-dots');
  const msg = host.querySelector('.pc-msg');
  const draw = () => { dots.textContent = Array.from({ length: Math.max(4, value.length) }, (_, i) => (i < value.length ? '●' : '○')).join(' '); };
  const submit = () => { const v = value; if (v.length >= 4) onSubmit(v); else { api.message('The PIN is 4 to 8 digits.'); } };
  const press = (k) => {
    if (/^\d$/.test(k)) { if (value.length < 8) value += k; msg.textContent = ''; }
    else if (k === 'back') value = value.slice(0, -1);
    else if (k === 'ok') return submit();
    draw();
  };
  pad.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  // A real keyboard works too. Nothing typed here may reach the game underneath (WASD, Space, Escape...).
  pad.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
    else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
  });
  draw();
  const api = {
    message(text, good = false) { msg.textContent = text; msg.className = `pc-msg ${good ? 'ok' : 'bad'}`; },
    clear() { value = ''; draw(); },
    focus() { pad.focus(); },
  };
  api.focus();
  return api;
}

/* ---------------------------------------------------------------- the panel */

let panel = null;

/** Opens the parental controls. Asks for the PIN first (or makes one the first time) unless `verified` says it was just entered. */
export function openParentalPanel({ verified = false, onClose } = {}) {
  const P = parental();
  if (!P || panel) return;
  const root = document.createElement('div');
  root.className = 'acct-backdrop pc-backdrop';
  document.body.appendChild(root);
  let idleTimer = 0;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  const bump = () => { clearTimeout(idleTimer); idleTimer = setTimeout(close, 3 * 60 * 1000); };   // locks itself again after 3 idle minutes
  function close() {
    clearTimeout(idleTimer);
    removeEventListener('keydown', onKey, true);
    root.remove();
    panel = null;
    onClose?.();
  }
  addEventListener('keydown', onKey, true);
  panel = { close };
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.addEventListener('pointerdown', bump);
  root.addEventListener('keydown', bump);
  bump();

  const card = (inner) => { root.innerHTML = `<div class="acct-card pc-card" role="dialog" aria-modal="true" aria-label="Parental controls"><button class="acct-x" type="button" aria-label="Close">&times;</button>${inner}</div>`; root.querySelector('.acct-x').onclick = close; return root.querySelector('.pc-body'); };

  // ---- first time: make a PIN (twice)
  function setup() {
    const host = card('<h2>Parental controls</h2><div class="pc-body"></div>');
    let first = null;
    const ask = () => pinPad(host, {
      title: first ? 'Type the PIN again' : 'Choose a parent PIN',
      hint: first ? '' : '4 to 8 digits. You will need it to change these settings or to add play time. Keep it away from the kids.',
      submitLabel: first ? 'Save' : 'Next',
      onSubmit: async (pin) => {
        if (!first) { first = pin; ask(); return; }
        if (pin !== first) { first = null; const p = ask(); p.message("Those didn't match. Start again.", false); return; }
        const r = await P.setPin(pin);
        if (r.ok) main(); else { first = null; ask().message(r.msg, false); }
      },
    });
    ask();
  }

  // ---- every time after: type the PIN
  function askPin(next = main) {
    const host = card('<h2>Parental controls</h2><div class="pc-body"></div>');
    const pad = pinPad(host, {
      title: 'Parent PIN',
      onSubmit: async (pin) => {
        const r = await P.verifyPin(pin);
        if (r.ok) { next(); return; }
        pad.clear();
        if (r.wait) pad.message(`Too many wrong tries. Try again in ${Math.ceil(r.wait / 60)} minute${r.wait > 60 ? 's' : ''}.`, false);
        else pad.message(`Wrong PIN. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`, false);
      },
    });
  }

  // ---- change the PIN: current, new, again
  function changePin() {
    const host = card('<h2>Change PIN</h2><div class="pc-body"></div>');
    let old = null; let neu = null;
    const step = () => {
      const pad = pinPad(host, {
        title: old === null ? 'Current PIN' : neu === null ? 'New PIN' : 'New PIN again',
        submitLabel: old !== null && neu !== null ? 'Save' : 'Next',
        onSubmit: async (pin) => {
          if (old === null) { const r = await P.verifyPin(pin); if (!r.ok) { pad.clear(); pad.message(r.wait ? 'Too many wrong tries. Wait a few minutes.' : `Wrong PIN. ${r.left} tries left.`); return; } old = pin; step(); return; }
          if (neu === null) { neu = pin; step(); return; }
          if (pin !== neu) { neu = null; step().message("Those didn't match. Type the new PIN again.", false); return; }
          const r = await P.changePin(old, neu);
          if (r.ok) main(); else { old = null; neu = null; step().message(r.msg || 'Could not change the PIN.', false); }
        },
      });
      return pad;
    };
    step();
  }

  // ---- the settings
  function allGames() {
    return [...CATALOG.map((g) => ({ id: g.id, name: g.name, n: g.n, tags: g.tags })), ...LINKED.filter((l) => l.kind === 'page').map((l, i) => ({ id: l.id, name: `${l.name} (${l.badge})`, n: 1000 + i, tags: l.tags }))];
  }

  function main() {
    const s = P.load();
    const games = allGames();
    const body = card(`
      <h2>Parental controls</h2>
      <div class="pc-body pc-main">
        <div class="pc-today"><div class="pc-today-line"></div>
          <div class="pc-btns"><button class="acct-btn small" type="button" data-act="grant" data-min="15">+15 min</button><button class="acct-btn small" type="button" data-act="grant" data-min="30">+30 min</button><button class="acct-btn small" type="button" data-act="grant" data-min="60">+1 hour</button><button class="acct-btn small" type="button" data-act="reset">Reset timer</button></div>
        </div>
        <label class="acct-check pc-switch"><input type="checkbox" name="enabled"${s.enabled ? ' checked' : ''} /> Parental controls are <b>${s.enabled ? 'ON' : 'OFF'}</b></label>
        <section class="pc-link"><h3>Put these rules on your child's account</h3><div class="pc-link-body"></div></section>
        <section><h3>Play time each day</h3>
          <div class="pc-grid">
            <label>Monday to Friday<select name="weekday">${LIMITS.map(([v, l]) => `<option value="${v}"${v === s.limits.weekday ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>Saturday and Sunday<select name="weekend">${LIMITS.map(([v, l]) => `<option value="${v}"${v === s.limits.weekend ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          </div>
          <p class="pc-note">The timer only runs while the arcade is open on screen and someone is playing. It starts again each day at midnight.</p>
        </section>
        <section><h3>Play hours</h3>
          <label class="acct-check pc-switch"><input type="checkbox" name="hoursOn"${s.hours.on ? ' checked' : ''} /> Only allow playing between</label>
          <div class="pc-grid"><label>From<input type="time" name="from" value="${s.hours.from}" /></label><label>Until<input type="time" name="to" value="${s.hours.to}" /></label></div>
        </section>
        <section><h3>Break reminder</h3>
          <label>A friendly nudge to rest<select name="breakEvery">${BREAKS.map(([v, l]) => `<option value="${v}"${v === s.breakEvery ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </section>
        <section><h3>Keep inside the arcade</h3>
          <label class="acct-check pc-switch"><input type="checkbox" name="keepInside"${s.keepInside ? ' checked' : ''} /> Hide links to other sites (51 Mimi Games), sign-in, bug reports and the app download</label>
          <p class="pc-note">Time limits only count in this arcade and its Unity games. 51 Mimi Games is a separate site with no limits, so leave this on to stop switching to it. In the Windows and Android apps the Unity games open in a browser that cannot be limited, so they are hidden there while the controls are on.</p>
        </section>
        <section><h3>Blocked games</h3>
          <div class="pc-chips"></div>
          <input type="search" class="pc-search" placeholder="Find a game…" autocomplete="off" />
          <div class="pc-list">${games.sort((a, b) => a.n - b.n).map((g) => `<label class="acct-check pc-game" data-name="${esc(g.name.toLowerCase())}"><input type="checkbox" data-game="${esc(g.id)}"${s.blocked.includes(g.id) ? ' checked' : ''} /> ${esc(g.name)}</label>`).join('')}</div>
        </section>
        <section><h3>Parent PIN</h3><button class="acct-btn" type="button" data-act="pin">Change PIN</button></section>
        <div class="acct-row"><button class="acct-btn primary" type="button" data-act="close">Done</button><span class="pc-saved" aria-live="polite"></span></div>
      </div>`);

    const q = (sel) => body.querySelector(sel);
    const saved = () => { const el = q('.pc-saved'); if (el) { el.textContent = 'Saved'; clearTimeout(saved.t); saved.t = setTimeout(() => { el.textContent = ''; }, 1500); } };
    const todayLine = () => {
      const st = P.status();
      const used = Math.round(st.used / 60);
      q('.pc-today-line').innerHTML = st.limit
        ? `<strong>Today:</strong> played ${minutesText(used)} · ${st.remaining === 0 ? '<b class="bad">no time left</b>' : `${minutesText(Math.ceil(st.remaining / 60))} left`} <span class="pc-note">(limit ${minutesText(st.limit + st.bonus)}${st.bonus ? `, includes ${minutesText(st.bonus)} extra` : ''})</span>`
        : `<strong>Today:</strong> played ${minutesText(used)} · no daily limit`;
    };
    const syncBlocked = () => {
      const blocked = new Set(P.load().blocked);
      body.querySelectorAll('[data-game]').forEach((c) => { c.checked = blocked.has(c.dataset.game); });
      q('.pc-chips').innerHTML = ALL_TAGS.map((t) => {
        const ids = games.filter((g) => g.tags.includes(t)).map((g) => g.id);
        const on = ids.length > 0 && ids.every((id) => blocked.has(id));
        return `<button type="button" class="chip${on ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`;
      }).join('');
    };
    todayLine(); syncBlocked();
    const tick = setInterval(() => { if (!document.body.contains(root)) clearInterval(tick); else todayLine(); }, 5000);

    const linkView = () => {
      const host = q('.pc-link-body');
      if (!host || host.querySelector('input:focus')) return;   // (do not rebuild it while someone is typing)
      const me = Account.session();
      const info = linkInfo();
      const msgHtml = '<p class="pc-link-msg pc-note" aria-live="polite"></p>';
      const listen = () => { for (const el of host.querySelectorAll('input')) { el.addEventListener('keydown', (ev) => ev.stopPropagation()); el.addEventListener('keyup', (ev) => ev.stopPropagation()); } };
      if (info?.role === 'parent') {
        const mine = me && me.key === JSON.parse(localStorage.getItem('mg.parental.link.v1') || '{}').parent;
        const state = ParentalLink.state;   // pending | active
        const line = !mine ? `Sign in to your own account to see or change this.`
          : ParentalLink.status === 'error' ? `<b class="bad">${esc(ParentalLink.msg)}</b>`
          : state === 'pending' ? `<b>Waiting for ${esc(info.name)} to accept.</b> On their account (on any device) they will be asked to accept parental controls from you. Until they do, nothing changes on their account.`
          : `<b>${esc(info.name)}'s account has these rules, and you manage them.</b> They follow ${esc(info.name)} to every device they sign in on. Change anything here and it changes there. ${ParentalLink.status === 'syncing' ? 'Saving…' : 'Saved.'}`;
        host.innerHTML = `<p class="pc-note">${line}</p><div class="pc-btns"><button class="acct-btn small" type="button" data-act="unlink">${state === 'pending' ? 'Cancel the request' : 'Remove from their account'}</button></div>${msgHtml}`;
      } else if (info?.role === 'child') {
        host.innerHTML = `<p class="pc-note">These rules came from <b>${esc(info.name)}'s</b> account, which is managed by a parent. They can only be changed from the parent's own account (sign in with it on any device and open Parental controls).</p>${msgHtml}`;
      } else if (!me) {
        host.innerHTML = `<p class="pc-note">Rules set here only apply on this device. To have them follow your child to every device, they go on your child's account, managed by <b>your own</b> account. First sign in to your own account (or make one):</p>
          <div class="pc-grid"><label>Your account name<input type="text" name="parentName" autocomplete="off" /></label><label>Your password<input type="password" name="parentPass" autocomplete="off" /></label></div>
          <div class="pc-btns"><button class="acct-btn small primary" type="button" data-act="parent-signin">Sign in</button><button class="acct-btn small" type="button" data-act="parent-signup">Create my account</button></div>${msgHtml}`;
        listen();
      } else {
        host.innerHTML = `<p class="pc-note">You are signed in as <b>${esc(me.name)}</b> (your own account). Type your child's account name to ask their account to take these rules. They sign in to their account and accept, and from then on you manage the rules from yours. Nothing is changed on their account until they accept.</p>
          <div class="pc-grid"><label>Your child's account name<input type="text" name="childName" autocomplete="off" /></label></div>
          <div class="pc-btns"><button class="acct-btn small primary" type="button" data-act="request">Send request</button><button class="acct-btn small" type="button" data-act="parent-signout">Sign out of ${esc(me.name)}</button></div>${msgHtml}`;
        listen();
      }
    };
    const linkMsg = (text, bad) => { const el = q('.pc-link-msg'); if (el) { el.textContent = text; el.classList.toggle('bad', !!bad); } };
    linkView();
    const offAccount = Account.onChange(() => { if (!document.body.contains(root)) offAccount(); else linkView(); });
    const offLink = onLinkChange(() => { if (!document.body.contains(root)) offLink(); else linkView(); });
    const refreshLink = () => pullNow().then(() => { todayLine(); syncBlocked(); linkView(); });
    if (Account.isSignedIn()) refreshLink();

    body.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        const ids = games.filter((g) => g.tags.includes(chip.dataset.tag)).map((g) => g.id);
        const cur = new Set(P.load().blocked);
        if (chip.classList.contains('on')) ids.forEach((id) => cur.delete(id)); else ids.forEach((id) => cur.add(id));
        P.save({ blocked: [...cur] }); syncBlocked(); saved(); return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'grant') { P.grant(Number(b.dataset.min)); todayLine(); saved(); }
      else if (act === 'reset') { P.resetToday(); todayLine(); saved(); }
      else if (act === 'pin') changePin();
      else if (act === 'request' || act === 'parent-signin' || act === 'parent-signup') linkAction(act);
      else if (act === 'parent-signout') { Account.signOut(); }
      else if (act === 'unlink') { linkMsg('Working…'); unlinkNow().then((r) => { if (!r.ok) linkMsg(r.msg || 'Could not do that.', true); else linkView(); }); }
      else if (act === 'close') close();
    });
    body.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.game) {
        const list = [...body.querySelectorAll('[data-game]')].filter((c) => c.checked).map((c) => c.dataset.game);
        P.save({ blocked: list }); syncBlocked(); saved(); return;
      }
      if (t.name === 'enabled') { P.save({ enabled: t.checked }); const b = q('.pc-switch b'); if (b) b.textContent = t.checked ? 'ON' : 'OFF'; }
      else if (t.name === 'weekday' || t.name === 'weekend') P.save({ limits: { [t.name]: Number(t.value) } });
      else if (t.name === 'hoursOn') P.save({ hours: { on: t.checked } });
      else if (t.name === 'from' || t.name === 'to') { if (t.value) P.save({ hours: { [t.name]: t.value } }); }
      else if (t.name === 'breakEvery') P.save({ breakEvery: Number(t.value) });
      else if (t.name === 'keepInside') P.save({ keepInside: t.checked });
      else return;
      todayLine(); saved();
    });
    async function linkAction(act) {
      linkMsg('Working…');
      if (act === 'parent-signin' || act === 'parent-signup') {
        const name = q('[name=parentName]').value, pass = q('[name=parentPass]').value;
        const r = act === 'parent-signup' ? await Account.signUp(name, pass) : await Account.signIn(name, pass);
        if (!r.ok) linkMsg(r.msg || 'Could not sign in.', true);
        return;   // (signing in redraws this section)
      }
      const r = await requestLink(q('[name=childName]').value);
      if (!r.ok) { linkMsg(r.msg || 'Could not send the request.', true); return; }
      linkView(); saved();
    }

    q('.pc-search').addEventListener('input', (e) => {
      const needle = e.target.value.trim().toLowerCase();
      body.querySelectorAll('.pc-game').forEach((l) => { l.style.display = !needle || l.dataset.name.includes(needle) ? '' : 'none'; });
    });
    for (const el of body.querySelectorAll('input, select')) { el.addEventListener('keydown', (ev) => ev.stopPropagation()); el.addEventListener('keyup', (ev) => ev.stopPropagation()); }
  }

  if (!P.hasPin()) setup();
  else if (verified) main();
  else askPin();
}

/* ---------------------------------------------------------------- lock screen */

let lock = null;   // { el, wasRunning, prevCursor, prevMuted }

function lockMessage(st) {
  const l = st.locked;
  if (l.kind === 'hours') return { title: 'Not play time right now', text: `Playing is allowed between ${clock12(l.from)} and ${clock12(l.to)}.`, sub: 'Come back then, or ask a parent.' };
  return { title: "That's all the play time for today", text: `Today's limit is ${minutesText(l.limit + l.bonus)}.`, sub: 'Come back tomorrow, or ask a parent for more time.' };
}

function showLock(ctx, st) {
  const P = parental();
  if (lock) { lock.el.querySelector('.pc-lock-msg').innerHTML = renderMsg(st); return; }
  const engine = ctx.engine;
  lock = { wasRunning: !!engine.running, prevCursor: engine.domCursor, prevMuted: engine.audio?.muted };
  if (lock.wasRunning) engine.pause();
  if (ctx.getCurrent()) engine.domCursor = true;        // in a game a controller gets its cursor to reach the keypad (the menu has its own cursor handling)
  if (engine.audio) { engine.audio.muted = true; engine.audio.ctx?.suspend?.(); }   // (muted in memory only: the saved sound setting is untouched)
  const el = document.createElement('div');
  el.className = 'pc-lock';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="pc-lock-card"><div class="pc-lock-icon" aria-hidden="true">&#128274;</div><div class="pc-lock-msg">${renderMsg(st)}</div><div class="pc-lock-actions"><button class="acct-btn primary" type="button" data-act="parent">I am a parent</button></div><div class="pc-lock-pad"></div></div>`;
  document.body.appendChild(el);
  lock.el = el;
  // Nothing underneath may react to the keyboard while this is up.
  const swallow = (e) => { if (!e.target.closest?.('.pc-pin') && !e.target.closest?.('.pc-backdrop')) { e.stopPropagation(); if (e.key === 'Escape' || e.key === '`') e.preventDefault(); } };
  lock.swallow = swallow;
  addEventListener('keydown', swallow, true);
  const actions = el.querySelector('.pc-lock-actions');
  const padHost = el.querySelector('.pc-lock-pad');
  const askParent = () => {
    actions.hidden = true;
    const pad = pinPad(padHost, {
      title: 'Parent PIN',
      onSubmit: async (pin) => {
        const r = await P.verifyPin(pin);
        if (r.ok) { choices(); return; }
        pad.clear();
        if (r.wait) pad.message(`Too many wrong tries. Try again in ${Math.ceil(r.wait / 60)} minute${r.wait > 60 ? 's' : ''}.`);
        else pad.message(`Wrong PIN. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`);
      },
    });
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'acct-btn small'; back.textContent = 'Cancel';
    back.onclick = () => { padHost.innerHTML = ''; actions.hidden = false; };
    padHost.appendChild(back);
  };
  const choices = () => {
    padHost.innerHTML = `<div class="pc-title">Add play time</div><div class="pc-btns"><button class="acct-btn" type="button" data-min="15">+15 minutes</button><button class="acct-btn" type="button" data-min="30">+30 minutes</button><button class="acct-btn" type="button" data-min="60">+1 hour</button></div><div class="pc-btns"><button class="acct-btn small" type="button" data-act="settings">Open parental controls</button><button class="acct-btn small" type="button" data-act="cancel">Cancel</button></div>`;
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'parent') askParent();
    else if (b.dataset.act === 'cancel') { padHost.innerHTML = ''; actions.hidden = false; }
    else if (b.dataset.act === 'settings') openParentalPanel({ verified: true });
    else if (b.dataset.min) P.grant(Number(b.dataset.min));   // unlocking happens through the timer's onUnlock
  });
}

const renderMsg = (st) => { const m = lockMessage(st); return `<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p><p class="pc-note">${esc(m.sub)}</p>`; };

function hideLock(ctx) {
  if (!lock) return;
  const engine = ctx.engine;
  removeEventListener('keydown', lock.swallow, true);
  lock.el.remove();
  engine.domCursor = lock.prevCursor;
  if (engine.audio) { engine.audio.muted = lock.prevMuted; engine.audio.ctx?.resume?.(); }
  const resume = lock.wasRunning && ctx.getCurrent();
  lock = null;
  if (resume) engine.resume();
}

/* ------------------------------------------------------------------ banners */

function banner(text) {
  const el = document.createElement('div');
  el.className = 'pc-banner';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

/* ------------------------------------------------- a parent's request, shown to the child */

let requestCard = null;
const dismissed = new Set();   // requests the child chose "Not now" for, until the page is reloaded

function showRequest(fromName) {
  if (requestCard || dismissed.has(fromName)) return;
  const root = document.createElement('div');
  root.className = 'acct-backdrop pc-backdrop pc-request';
  root.innerHTML = `<div class="acct-card pc-card" role="dialog" aria-modal="true" aria-label="Parental controls request">
    <h2>Parental controls request</h2>
    <div class="pc-body">
      <p><b>${esc(fromName)}</b> wants to turn on parental controls for your account.</p>
      <p class="pc-note">If you accept, play time limits, play hours and blocked games from ${esc(fromName)} apply to your account on every device you sign in on, and ${esc(fromName)} manages them from their own account. Only ${esc(fromName)} can change or remove them.</p>
      <div class="acct-row"><button class="acct-btn primary" type="button" data-r="accept">Accept</button><button class="acct-btn" type="button" data-r="later">Not now</button><button class="acct-btn" type="button" data-r="decline">No thanks</button></div>
      <p class="pc-msg" aria-live="polite"></p>
    </div></div>`;
  document.body.appendChild(root);
  requestCard = root;
  const close = () => { root.remove(); requestCard = null; };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    const msg = root.querySelector('.pc-msg');
    if (b.dataset.r === 'later') { dismissed.add(fromName); close(); return; }
    msg.textContent = 'One moment…';
    const r = b.dataset.r === 'accept' ? await acceptRequest() : await declineRequest();
    if (r.ok) close(); else { msg.textContent = r.msg || 'Something went wrong. Try again.'; msg.classList.add('bad'); }
  });
}

/* -------------------------------------------------------------------- mount */

/** Starts the timer and wires it to the screens. ctx: { engine, menu, getCurrent }. Returns the core, or null if it did not load. */
export function mountParental(ctx) {
  const P = parental();
  if (!P) return null;
  P.onSettings(() => ctx.menu.refreshParental?.());
  onLinkChange(() => {
    if (ParentalLink.request) showRequest(ParentalLink.request.fromName);
    else if (requestCard) { requestCard.remove(); requestCard = null; }
  });
  P.start({
    onChange: () => ctx.menu.refreshParental?.(false),
    onWarn: (m) => banner(`${m} minute${m === 1 ? '' : 's'} of play time left today`),
    onBreak: (n) => banner(`You have been playing for ${n} minutes. Time for a short break!`),
    onLock: (st) => showLock(ctx, st),
    onUnlock: () => hideLock(ctx),
  });
  return P;
}

/** A short message at the top of the screen (used by main.js for blocked games). */
export const notify = banner;
export { timeLeftText };
