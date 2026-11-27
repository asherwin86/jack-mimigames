import { Rocoins } from '../engine/Rocoins.js';
import { isInstalledCopy } from '../engine/Install.js';
import { openInstallDialog } from './InstallDialog.js';
import { openHostDialog } from './HostDialog.js';
import { desktopHost } from '../engine/Host.js';
import { openBugReport } from './BugReportDialog.js';
import { OTHER_ARCADE, switchToOtherArcade, switchUsesApp, chooseOtherAppLocation } from '../engine/OtherArcade.js';
import { LINKED, openLinked } from '../engine/LinkedGames.js';
import { openParentalPanel } from './Parental.js';
import { controlsOn, isBlocked, keepInside, timeLeftText } from '../engine/ParentalState.js';
import { CATALOG, ALL_TAGS, TARGET } from '../games/catalog.js';
import { isImplemented } from '../games/index.js';
import { Scores } from '../engine/Storage.js';
import { Settings } from '../engine/Settings.js';
import { themeFor, seasonOverride } from '../engine/Seasons.js';
import { Account } from '../engine/Account.js';
import { openAccountDialog } from './AccountDialog.js';
import { openAdminConsole } from './AdminConsole.js';
import { findGames, didYouMean, surprise } from '../engine/GameFinder.js';
import { CHANGELOG } from '../changelog.js';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class Menu {
  constructor(root, onPlay, input) {
    this.root = root;
    this.onPlay = onPlay;
    this.input = input;   // the app's shared Input instance — drives the gamepad cursor here too
    this.query = '';
    this.tag = null;
    this.onSeasonal = null;   // (on) => void: the holiday colours toggle
    this.onProps = null;   // (on) => void, so the backdrop can follow the toggle
    this._navRaf = null;
    this._gpAHeld = false;
    this._hoverEl = null;
    Account.onChange(() => this._syncAccountButton());   // signing in or out (from anywhere) updates the button
  }

  show() {
    // Every display preference is read once here and folded straight into
    // the root class list — _applyToggle() just flips these same classes
    // reactively afterward when a button is clicked.
    const prefs = {
      'no-spin': Settings.get('noSpin', false),
      'high-contrast': Settings.get('highContrast', false),
      compact: Settings.get('compact', false),
    };
    const settingsOpen = Settings.get('settingsOpen', false);
    const prefClasses = Object.entries(prefs).filter(([, on]) => on).map(([c]) => ` ${c}`).join('');
    this.root.innerHTML = `
      <div class="menu${prefClasses}">
        <div class="menu-head">
          <h1><span class="red">100</span> <span class="blue">Mimi</span> <span class="red">Games</span></h1>
          <p>${this._tagline(Settings.get('seasonal', true))}</p>

          <div class="showcase">
            <video class="trailer" controls preload="metadata" poster="trailer-poster.jpg">
              <source src="trailer.webm" type="video/webm" />
              <source src="trailer.mp4" type="video/mp4" />
            </video>
            <div class="whats-new">
              <h2>What's new</h2>
              <ul>
                ${CHANGELOG.map((c) => `<li><strong>${c.title}</strong><span>${c.detail}</span></li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="menu-tools">
            <input type="search" placeholder="Search, or say what you feel like: relaxing, racing, like Tetra Drop…" autocomplete="off" aria-label="Find a game" />
            <button class="surprise-btn" type="button" title="Open a game you might like (favours ones you have not played)">&#127922; Surprise me</button>
            <button class="settings-btn" aria-expanded="${settingsOpen}" aria-controls="settings-box">
              <span class="gear" aria-hidden="true">&#9881;</span>Settings
            </button>
            <button class="coins-btn" type="button" aria-haspopup="dialog" title="Rocoins, powers and challenges (\`)">
              <span class="rc-coin" aria-hidden="true"></span><span class="coins-n">0</span>
            </button>
            ${isInstalledCopy() ? '' : `<button class="install-btn" type="button" aria-haspopup="dialog" title="Install 100 Mimi Games as an app, or download the Windows / Android app">
              <span aria-hidden="true">&#11015;</span><span>Get the app</span>
            </button>`}
            <button class="switch-btn" type="button" title="${switchUsesApp() ? `Opens your ${OTHER_ARCADE.name} app and closes this one. Right-click to change where that app is.` : `Leave this arcade and open ${OTHER_ARCADE.name}`}">
              <span aria-hidden="true">&#8644;</span><span>Switch to ${OTHER_ARCADE.name}</span>
            </button>
            <button class="bug-btn" type="button" aria-haspopup="dialog" title="Report a bug or send an idea">
              <span aria-hidden="true">&#128030;</span><span>Report a bug</span>
            </button>
            <button class="account-btn" type="button" aria-haspopup="dialog">
              <span class="acct-icon" aria-hidden="true">&#128100;</span><span class="acct-label">Sign in</span>
            </button>
            <div class="tools-break"></div>
            <div class="settings-box" id="settings-box"${settingsOpen ? '' : ' hidden'}>
              <h3>Display &amp; sound</h3>
              <button class="toggle" data-setting="bgProps" data-default="1" aria-pressed="${Settings.get('bgProps', true)}">
                <span class="dot"></span>Background props <kbd>Shift</kbd>
              </button>
              <button class="toggle" data-setting="music" data-default="1" aria-pressed="${Settings.get('music', true)}">
                <span class="dot"></span>Music
              </button>
              <button class="toggle" data-setting="bgBlack" data-default="0" aria-pressed="${Settings.get('bgBlack', false)}">
                <span class="dot"></span>Black sky
              </button>
              <button class="toggle" data-setting="seasonal" data-default="1" aria-pressed="${Settings.get('seasonal', true)}">
                <span class="dot"></span>Holiday colours
              </button>
              <button class="toggle" data-setting="noSpin" data-default="0" aria-pressed="${prefs['no-spin']}">
                <span class="dot"></span>Stop spinning
              </button>
              <button class="toggle" data-setting="highContrast" data-default="0" aria-pressed="${prefs['high-contrast']}">
                <span class="dot"></span>High contrast
              </button>
              <button class="toggle" data-setting="compact" data-default="0" aria-pressed="${prefs.compact}">
                <span class="dot"></span>Compact
              </button>
              ${desktopHost() ? `<button class="host-btn" type="button" aria-haspopup="dialog" title="Let phones, tablets and other computers on your Wi-Fi play from this computer">&#128421; Host</button>` : ''}
              <button class="pc-btn" type="button" title="Play time limits, blocked games and more (needs a parent PIN)">&#128737; Parental controls</button>
              <button class="ad-btn" type="button" title="Admin console: Rocoins, commands, tools (needs the admin password)">&#128295; Admin</button>
            </div>
          </div>
          <div class="chips"></div>
        </div>
        <div class="grid"></div>
      </div>`;

    this.$grid = this.root.querySelector('.grid');
    const $chips = this.root.querySelector('.chips');
    const $search = this.root.querySelector('input');

    $chips.innerHTML = ['All', ...ALL_TAGS]
      .map((t) => `<button class="chip" data-tag="${t === 'All' ? '' : t}">${t}</button>`)
      .join('');
    $chips.onclick = (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      this.tag = b.dataset.tag || null;
      $chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      this.render();
    };
    $chips.firstElementChild.classList.add('on');

    this.$note = document.createElement('p');
    this.$note.className = 'find-note';
    this.$note.setAttribute('aria-live', 'polite');
    this.root.querySelector('.menu-tools').after(this.$note);
    this.$search = $search;
    $search.oninput = () => { this.query = $search.value.trim().toLowerCase(); this.render(); this._autoOpen(); };
    $search.onkeydown = (e) => {
      if (e.key === 'Escape') { if (this._autoTimer) { this._cancelAuto(); e.stopPropagation(); e.preventDefault(); } return; }
      if (e.key === 'Enter') { e.preventDefault(); this._enter(); }
    };

    // One delegated handler for every display-preference toggle — each just
    // flips its own Settings key and applies the matching effect.
    // Right-click Switch (Windows app only): choose where the other app is.
    this.root.querySelector('.menu-tools').addEventListener('contextmenu', (e) => {
      if (switchUsesApp() && e.target.closest('.switch-btn')) { e.preventDefault(); chooseOtherAppLocation(); }
    });
    this.root.querySelector('.menu-tools').addEventListener('click', (e) => {
      if (e.target.closest('.account-btn')) { openAccountDialog(); return; }
      if (e.target.closest('.coins-btn')) { this.onAdmin?.(); return; }
      if (e.target.closest('.install-btn')) { openInstallDialog(); return; }
      if (e.target.closest('.host-btn')) { openHostDialog(); return; }
      if (e.target.closest('.bug-btn')) { openBugReport(); return; }
      if (e.target.closest('.switch-btn')) { switchToOtherArcade(); return; }
      if (e.target.closest('.pc-btn')) { openParentalPanel(); return; }
      if (e.target.closest('.ad-btn')) { openAdminConsole(); return; }
      if (e.target.closest('.surprise-btn')) { this._surprise(); return; }
      const opener = e.target.closest('.settings-btn');
      if (opener) {
        const box = this.root.querySelector('.settings-box');
        box.hidden = !box.hidden;
        opener.setAttribute('aria-expanded', String(!box.hidden));
        Settings.set('settingsOpen', !box.hidden);   // remembered, so it stays how you left it
        return;
      }
      const btn = e.target.closest('.toggle');
      if (!btn) return;
      const key = btn.dataset.setting;
      const on = Settings.toggle(key, btn.dataset.default === '1');
      btn.setAttribute('aria-pressed', String(on));
      this._applyToggle(key, on);
    });

    this.$grid.onclick = (e) => {
      const tc = e.target.closest('.try-chip');
      if (tc) { $search.value = tc.dataset.try; this.query = tc.dataset.try.toLowerCase(); this.render(); this._autoOpen(); return; }
      const t = e.target.closest('.tile');
      if (t?.dataset.link) { const entry = LINKED.find((l) => l.id === t.dataset.link); if (entry) openLinked(entry); return; }
      if (t && !t.classList.contains('soon')) this.onPlay(t.dataset.id);
    };

    this.render();
    this.root.querySelector('.menu')?.classList.toggle('keep-inside', keepInside());
    this._syncAccountButton();
    this.setCoins(Rocoins.balance());
    this._startGamepadNav();
  }

  /** The coin button shows your Rocoin balance. */
  setCoins(n) {
    const el = this.root.querySelector('.coins-n');
    if (el) el.textContent = n === Infinity ? '\u221e' : String(n);
  }

  /** The menu's account button says who you're signed in as (or invites you to sign in). */
  _syncAccountButton() {
    const btn = this.root.querySelector('.account-btn');
    if (!btn) return;
    const who = Account.name();
    btn.classList.toggle('signed-in', !!who);
    const label = btn.querySelector('.acct-label');
    if (label) label.textContent = who ? who : 'Sign in';
    btn.title = who ? `Signed in as ${who} — click to manage your account` : 'Sign in to keep your worlds on your account';
  }

  /** Parental controls changed (or a minute passed): hide or show the links to other sites, redraw the tiles, update the time-left line. */
  refreshParental(full = true) {
    const menuEl = this.root.querySelector('.menu');
    if (!menuEl) return;
    menuEl.classList.toggle('keep-inside', keepInside());
    const p = this.root.querySelector('.menu-head > p');
    if (p) p.innerHTML = this._tagline(Settings.get('seasonal', true));
    if (full && this.$grid) this.render();
  }

  /** The line under the title, with the special day / school holiday greeting when there is one. */
  _tagline(seasonal) {
    const theme = seasonal ? themeFor(new Date(), seasonOverride()) : null;
    const left = timeLeftText();
    return `${CATALOG.length} of ${TARGET} built &middot; every one rendered in 3D${theme ? ` &middot; <span class="season-tag">${theme.label}</span>` : ''}${left ? ` &middot; <span class="pc-left">${left}</span>` : ''}`;
  }

  /** Reflects the props setting on the button, for when Shift flips it. */
  syncProps(on) {
    this.root.querySelector('[data-setting="bgProps"]')?.setAttribute('aria-pressed', String(on));
  }

  /** Applies one display-preference toggle's effect — the flip side of
   *  reading it back with Settings.get() in show()/buildBackdrop(). */
  _applyToggle(key, on) {
    const menuEl = this.root.querySelector('.menu');
    if (key === 'bgProps') this.onProps?.(on);
    else if (key === 'music') this.onMusic?.(on);
    else if (key === 'bgBlack') this.onBlackSky?.(on);
    else if (key === 'seasonal') { this.onSeasonal?.(on); const p = this.root.querySelector('.menu-head > p'); if (p) p.innerHTML = this._tagline(on); }
    else if (key === 'noSpin') menuEl?.classList.toggle('no-spin', on);
    else if (key === 'highContrast') menuEl?.classList.toggle('high-contrast', on);
    else if (key === 'compact') menuEl?.classList.toggle('compact', on);
  }

  /** The one game left in the results: say so, and open it after a moment unless the person keeps typing or presses Escape. */
  _autoOpen() {
    this._cancelAuto();
    const one = this._single;
    if (!one || !this.query) return;
    const q = this.query;
    this.$note.textContent = `Opening ${one.name}… (keep typing or press Escape to stay here)`;
    this.$note.classList.add('on');
    this._autoTimer = setTimeout(() => {
      this._autoTimer = 0;
      if (this.query !== q || !this.$search?.isConnected) return;   // they typed more, or the menu is gone
      this._openOne(one);
    }, 900);
  }

  _cancelAuto() {
    clearTimeout(this._autoTimer);
    this._autoTimer = 0;
    if (this.$note) { this.$note.textContent = ''; this.$note.classList.remove('on'); }
  }

  _openOne(one) {
    this._cancelAuto();
    if (one.link) { const entry = LINKED.find((l) => l.id === one.id); if (entry) openLinked(entry); } else this.onPlay(one.id);
  }

  /** Enter in the search box: open the game if only one is left or the typed text is exactly a game's name; otherwise ask for more. */
  _enter() {
    const q = this.query;
    if (!q) return;
    if (this._single) { this._openOne(this._single); return; }
    this._cancelAuto();
    const n = this.$grid.querySelectorAll('.tile').length;
    if (n > 1) { this.$note.textContent = `${n} games match. Type more of the name, or press one.`; this.$note.classList.add('on'); }
  }

  /** Games and tiles that may be shown at all (not hidden by parental controls), for the finder. */
  _findable() {
    const inside = keepInside();
    const hideApps = controlsOn() && isInstalledCopy();
    return [
      ...CATALOG.filter((e) => !isBlocked(e.id)).map((e) => ({ ...e, kind: 'game' })),
      ...LINKED.filter((e) => !(inside && e.kind === 'arcade') && !(hideApps && e.kind === 'page') && !isBlocked(e.id)),
    ];
  }

  /** "Surprise me": a game you may like, favouring ones you have not played. */
  _surprise() {
    const pick = surprise(CATALOG.filter((e) => isImplemented(e.id) && !isBlocked(e.id)), { best: (id) => Scores.best(id) });
    if (pick) this.onPlay(pick.id);
  }

  render() {
    const q = this.query;
    let found = null;   // id -> why[] when the finder ranked the results
    let list;
    if (q.length >= 3) {
      const ranked = findGames(q, this._findable(), { best: (id) => Scores.best(id) });
      found = new Map(ranked.map((r) => [r.entry.id, r.why]));
      const order = new Map(ranked.map((r, i) => [r.entry.id, i]));
      list = CATALOG.filter((e) => found.has(e.id) && (!this.tag || e.tags.includes(this.tag))).sort((a, b) => order.get(a.id) - order.get(b.id));
    } else {
      list = CATALOG.filter((e) => {
        if (this.tag && !e.tags.includes(this.tag)) return false;
        if (!q) return true;
        return (e.name + ' ' + e.blurb + ' ' + e.tags.join(' ')).toLowerCase().includes(q);
      });
    }

    // The sister arcade and the Unity games sit after the built-in games (see engine/LinkedGames.js).
    const inside = keepInside();
    const hideApps = controlsOn() && isInstalledCopy();   // in the apps the Unity games open in a browser that cannot be limited
    const links = LINKED.filter((e) => {
      if (inside && e.kind === 'arcade') return false;     // 51 Mimi Games has no limits
      if (hideApps && e.kind === 'page') return false;
      if (this.tag && !e.tags.includes(this.tag)) return false;
      if (!q) return true;
      if (found) return found.has(e.id);
      return (e.name + ' ' + e.blurb + ' ' + e.badge + ' ' + e.tags.join(' ')).toLowerCase().includes(q);
    });
    if (found) links.sort((a, b) => [...found.keys()].indexOf(a.id) - [...found.keys()].indexOf(b.id));

    // Exactly one game left: the menu can open it for you (see _autoOpen). The sister arcade is never opened by itself (it switches apps).
    const only = list.length + links.length === 1 ? (list[0] ? { id: list[0].id, name: list[0].name, ok: isImplemented(list[0].id) && !isBlocked(list[0].id), link: false } : { id: links[0].id, name: links[0].name, ok: links[0].kind === 'page' && !isBlocked(links[0].id), link: true }) : null;
    // Typing a game's whole name means that game, even when other games also match some of the words (Beat Lanes / Bowling Lane).
    const named = q.length >= 3 ? this._findable().find((e) => e.name.toLowerCase() === q || e.id === q) : null;
    const namedOne = named && named.kind !== 'arcade' ? { id: named.id, name: named.name, ok: true, link: named.kind === 'page' } : null;
    this._single = q.length >= 3 ? (namedOne || (only?.ok ? only : null)) : null;
    if (!list.length && !links.length) {
      const close = q ? didYouMean(q, this._findable()) : [];
      const tries = ['relaxing', 'racing', 'with friends', 'quick', 'shoot', 'like Tetra Drop'];
      this.$grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No games match “${esc(q)}”.${close.length ? ` Did you mean ${close.map((e) => `<button class="try-chip" data-try="${esc(e.name)}">${esc(e.name)}</button>`).join(' ')}?` : ''}
        <div class="try-row">Try asking for: ${tries.map((t) => `<button class="try-chip" data-try="${esc(t)}">${esc(t)}</button>`).join(' ')}</div></div>`;
      return;
    }

    this.$grid.innerHTML = list.map((e, i) => {
      const best = Scores.best(e.id);
      const blocked = isBlocked(e.id);
      const ready = isImplemented(e.id) && !blocked;
      // Negative delay starts each tile part-way through its turn.
      const delay = `animation-delay:-${(i * 0.37).toFixed(2)}s`;
      return `
        <button class="tile${blocked ? ' blocked' : ready ? '' : ' soon'}" data-id="${e.id}" style="${delay}" ${ready ? '' : 'disabled'}>
          <span class="num">#${String(e.n).padStart(3, '0')}</span>
          <span class="name">${e.name}</span>
          <span class="blurb">${e.blurb}</span>
          <span class="foot">
            <span class="tag">${e.tags[0]}</span>
            ${found?.get(e.id)?.length ? `<span class="why">&#10024; ${esc(found.get(e.id).join(' · '))}</span>` : ''}
            ${blocked ? '<span class="pb">&#128274; blocked by a parent</span>' : best !== null ? `<span class="pb">best ${fmt(best)} ${e.unit || ''}</span>` : ''}
          </span>
        </button>`;
    }).join('') + links.map((e, i) => `
        <button class="tile linked${isBlocked(e.id) ? ' blocked' : ''}" data-link="${e.id}" ${isBlocked(e.id) ? 'disabled' : ''} style="animation-delay:-${((list.length + i) * 0.37).toFixed(2)}s">
          <span class="num">${e.badge.toUpperCase()}</span>
          <span class="name">${e.name}</span>
          <span class="blurb">${e.blurb}</span>
          <span class="foot">
            <span class="tag">${e.tags[0]}</span>
            <span class="pb">${isBlocked(e.id) ? '&#128274; blocked by a parent' : 'opens its own page &#8599;'}</span>
          </span>
        </button>`).join('');
  }

  /* -------------------------------------------------------- gamepad cursor */

  /** Runs its own rAF loop (independent of Engine's, which only ticks a
   *  mounted game or the idle scene) for as long as the menu is showing,
   *  hover-highlighting and A-clicking whatever's under the shared gamepad
   *  cursor — the exact same one a game with showCursor shows, so the menu
   *  and every game behave like one real mouse throughout. */
  _startGamepadNav() {
    if (this._navRaf || !this.input) return;
    const tick = () => {
      this._pollGamepadNav();
      this._navRaf = requestAnimationFrame(tick);
    };
    this._navRaf = requestAnimationFrame(tick);
  }

  _stopGamepadNav() {
    if (this._navRaf) cancelAnimationFrame(this._navRaf);
    this._navRaf = null;
    this._clearHover();
  }

  /** Scrolls the game list from a controller: right stick, D-pad up/down and the bumpers (a TV has no wheel), and
   *  the left-stick cursor pushed against the top or bottom edge. */
  _scrollWithPad(dt, cursorY) {
    const menu = this.root.querySelector('.menu');
    if (!menu) return;
    let v = this.input.gpAxis(3);                                   // right stick, up/down
    if (this.input.gpButton(13) || this.input.gpButton(5)) v = Math.max(v, 0.7);    // D-pad down / right bumper
    if (this.input.gpButton(12) || this.input.gpButton(4)) v = Math.min(v, -0.7);   // D-pad up / left bumper
    if (!v && cursorY !== null) {   // the cursor at the edge of the screen keeps scrolling that way
      if (cursorY > innerHeight * 0.92) v = 0.6;
      else if (cursorY < innerHeight * 0.08) v = -0.6;
    }
    if (v) menu.scrollTop += v * 900 * dt;
  }

  _pollGamepadNav() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._navT ?? now)) / 1000);
    this._navT = now;
    if (!this.input.usingGamepadPointer) {
      this._scrollWithPad(dt, null);
      this._clearHover(); this._gpAHeld = false; return;
    }

    const p = this.input.gpPointer;
    const x = (p.x * 0.5 + 0.5) * innerWidth;
    const y = (1 - (p.y * 0.5 + 0.5)) * innerHeight;
    const el = document.elementFromPoint(x, y);
    this._setHover(el);
    this._scrollWithPad(dt, y);

    // Not this.input.gpHit(0): that edge is tracked once per Engine frame,
    // reset by input.endFrame() — which, since Engine's own rAF callback was
    // registered before this loop's, always runs first in any tick they
    // share, clearing the edge before this poll ever sees it "just pressed".
    // A plain held/not-held read, edge-detected locally, sidesteps that.
    const aNow = this.input.gpButton(0);
    if (aNow && !this._gpAHeld) el?.click();   // a real click, wherever the cursor actually is
    this._gpAHeld = aNow;
  }

  /** Highlights whichever tile/button/chip the cursor is over, the closest
   *  thing to a real `:hover` a script can drive — CSS :hover only follows
   *  the actual mouse, never something moved by JS. */
  _setHover(el) {
    const target = el?.closest?.('.tile, .toggle, .chip, .settings-btn, .account-btn, .coins-btn, .install-btn, .host-btn, .bug-btn, .switch-btn, .pc-btn, .ad-btn, .surprise-btn, .try-chip') ?? null;
    if (target === this._hoverEl) return;
    this._hoverEl?.classList.remove('gp-hover');
    this._hoverEl = target;
    this._hoverEl?.classList.add('gp-hover');
  }

  _clearHover() {
    this._hoverEl?.classList.remove('gp-hover');
    this._hoverEl = null;
  }

  hide() {
    this._cancelAuto();
    this._stopGamepadNav();
    this.root.innerHTML = '';
  }
}

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
