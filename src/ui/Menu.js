import { CATALOG, ALL_TAGS, TARGET } from '../games/catalog.js';
import { isImplemented } from '../games/index.js';
import { Scores } from '../engine/Storage.js';
import { Settings } from '../engine/Settings.js';
import { Account } from '../engine/Account.js';
import { openAccountDialog } from './AccountDialog.js';
import { CHANGELOG } from '../changelog.js';

export class Menu {
  constructor(root, onPlay, input) {
    this.root = root;
    this.onPlay = onPlay;
    this.input = input;   // the app's shared Input instance — drives the gamepad cursor here too
    this.query = '';
    this.tag = null;
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
          <p>${CATALOG.length} of ${TARGET} built &middot; every one rendered in 3D</p>

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
            <input type="search" placeholder="Search games…" autocomplete="off" />
            <button class="settings-btn" aria-expanded="${settingsOpen}" aria-controls="settings-box">
              <span class="gear" aria-hidden="true">&#9881;</span>Settings
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
              <button class="toggle" data-setting="noSpin" data-default="0" aria-pressed="${prefs['no-spin']}">
                <span class="dot"></span>Stop spinning
              </button>
              <button class="toggle" data-setting="highContrast" data-default="0" aria-pressed="${prefs['high-contrast']}">
                <span class="dot"></span>High contrast
              </button>
              <button class="toggle" data-setting="compact" data-default="0" aria-pressed="${prefs.compact}">
                <span class="dot"></span>Compact
              </button>
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

    $search.oninput = () => { this.query = $search.value.trim().toLowerCase(); this.render(); };

    // One delegated handler for every display-preference toggle — each just
    // flips its own Settings key and applies the matching effect.
    this.root.querySelector('.menu-tools').addEventListener('click', (e) => {
      if (e.target.closest('.account-btn')) { openAccountDialog(); return; }
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
      const t = e.target.closest('.tile');
      if (t && !t.classList.contains('soon')) this.onPlay(t.dataset.id);
    };

    this.render();
    this._syncAccountButton();
    this._startGamepadNav();
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
    else if (key === 'noSpin') menuEl?.classList.toggle('no-spin', on);
    else if (key === 'highContrast') menuEl?.classList.toggle('high-contrast', on);
    else if (key === 'compact') menuEl?.classList.toggle('compact', on);
  }

  render() {
    const q = this.query;
    const list = CATALOG.filter((e) => {
      if (this.tag && !e.tags.includes(this.tag)) return false;
      if (!q) return true;
      return (e.name + ' ' + e.blurb + ' ' + e.tags.join(' ')).toLowerCase().includes(q);
    });

    if (!list.length) {
      this.$grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No games match “${q}”.</div>`;
      return;
    }

    this.$grid.innerHTML = list.map((e, i) => {
      const best = Scores.best(e.id);
      const ready = isImplemented(e.id);
      // Negative delay starts each tile part-way through its turn.
      const delay = `animation-delay:-${(i * 0.37).toFixed(2)}s`;
      return `
        <button class="tile${ready ? '' : ' soon'}" data-id="${e.id}" style="${delay}" ${ready ? '' : 'disabled'}>
          <span class="num">#${String(e.n).padStart(3, '0')}</span>
          <span class="name">${e.name}</span>
          <span class="blurb">${e.blurb}</span>
          <span class="foot">
            <span class="tag">${e.tags[0]}</span>
            ${best !== null ? `<span class="pb">best ${fmt(best)} ${e.unit || ''}</span>` : ''}
          </span>
        </button>`;
    }).join('');
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

  _pollGamepadNav() {
    if (!this.input.usingGamepadPointer) { this._clearHover(); this._gpAHeld = false; return; }

    const p = this.input.gpPointer;
    const x = (p.x * 0.5 + 0.5) * innerWidth;
    const y = (1 - (p.y * 0.5 + 0.5)) * innerHeight;
    const el = document.elementFromPoint(x, y);
    this._setHover(el);

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
    const target = el?.closest?.('.tile, .toggle, .chip, .settings-btn, .account-btn') ?? null;
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
    this._stopGamepadNav();
    this.root.innerHTML = '';
  }
}

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
