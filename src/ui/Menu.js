import { CATALOG, ALL_TAGS, TARGET } from '../games/catalog.js';
import { isImplemented } from '../games/index.js';
import { Scores } from '../engine/Storage.js';
import { Settings } from '../engine/Settings.js';
import { CHANGELOG } from '../changelog.js';

export class Menu {
  constructor(root, onPlay, input) {
    this.root = root;
    this.onPlay = onPlay;
    this.input = input;   // the app's shared Input instance — for gamepad tile navigation
    this.query = '';
    this.tag = null;
    this.onProps = null;   // (on) => void, so the backdrop can follow the toggle
    this.focusIndex = 0;
    this._navDir = { x: 0, y: 0 };
    this._navRepeatAt = 0;
    this._navRaf = null;
    this._gpAHeld = false;
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
    this._startGamepadNav();
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

    this._syncFocus();
  }

  /* ---------------------------------------------------------- gamepad nav */

  /** Runs its own rAF loop (independent of Engine's, which only ticks a
   *  mounted game) for as long as the menu is showing, polling the shared
   *  Input instance for D-pad/left-stick movement between tiles and an A
   *  press to launch the focused one. */
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
  }

  _navTiles() {
    return [...(this.$grid?.querySelectorAll('.tile:not(.soon)') ?? [])];
  }

  /** Re-focuses whatever tile focusIndex now points at after a re-render
   *  (search/filter changes rebuild the grid from scratch, so any actual
   *  DOM focus was just destroyed with the old elements) — clamped in case
   *  the new list is shorter. Harmless no-op with no gamepad connected. */
  _syncFocus() {
    if (!this.input) return;
    const tiles = this._navTiles();
    if (!tiles.length) return;
    this.focusIndex = Math.min(this.focusIndex, tiles.length - 1);
  }

  _pollGamepadNav() {
    const tiles = this._navTiles();
    if (!tiles.length) return;
    if (this.focusIndex >= tiles.length) this.focusIndex = tiles.length - 1;

    const dx = this.input.gpAxis(0) > 0.5 || this.input.gpButton(15) ? 1
      : this.input.gpAxis(0) < -0.5 || this.input.gpButton(14) ? -1 : 0;
    const dy = this.input.gpAxis(1) > 0.5 || this.input.gpButton(13) ? 1
      : this.input.gpAxis(1) < -0.5 || this.input.gpButton(12) ? -1 : 0;

    const now = performance.now();
    if (dx || dy) {
      const changed = dx !== this._navDir.x || dy !== this._navDir.y;
      if (changed || now >= this._navRepeatAt) {
        this._navDir = { x: dx, y: dy };
        this._navRepeatAt = now + (changed ? 320 : 130);   // a longer pause before the first repeat
        this._moveFocus(dx, dy, tiles);
      }
    } else {
      this._navDir = { x: 0, y: 0 };
    }

    // The gamepad "cursor" is this.focusIndex, not whatever has real DOM
    // focus (the player may have clicked the search box since) — A always
    // activates whichever tile it's currently on.
    // Not this.input.gpHit(0): that edge is tracked once per Engine frame,
    // reset by input.endFrame() — which, since Engine's own rAF callback was
    // registered before this loop's, always runs first in any tick they
    // share, clearing the edge before this poll ever sees it "just pressed".
    // A plain held/not-held read, edge-detected locally, sidesteps that.
    const aNow = this.input.gpButton(0);
    if (aNow && !this._gpAHeld) tiles[this.focusIndex]?.click();
    this._gpAHeld = aNow;
  }

  /** Moves focus one step in a direction across the tile grid, grouping by
   *  on-screen row (via offsetTop) rather than assuming a fixed column
   *  count — the grid's column count is responsive, so it can't be hard-coded. */
  _moveFocus(dx, dy, tiles) {
    const rows = [];
    for (const t of tiles) {
      const top = t.offsetTop;
      let row = rows.find((r) => Math.abs(r.top - top) < 4);
      if (!row) { row = { top, cells: [] }; rows.push(row); }
      row.cells.push(t);
    }
    rows.sort((a, b) => a.top - b.top);
    for (const r of rows) r.cells.sort((a, b) => a.offsetLeft - b.offsetLeft);

    const current = tiles[this.focusIndex] ?? tiles[0];
    let ri = 0;
    let ci = 0;
    outer: for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].cells.length; c++) {
        if (rows[r].cells[c] === current) { ri = r; ci = c; break outer; }
      }
    }

    if (dy) {
      ri = clampIndex(ri + dy, rows.length);
      ci = Math.min(ci, rows[ri].cells.length - 1);
    }
    if (dx) {
      ci += dx;
      if (ci < 0) {
        if (ri > 0) { ri--; ci = rows[ri].cells.length - 1; } else ci = 0;
      } else if (ci >= rows[ri].cells.length) {
        if (ri < rows.length - 1) { ri++; ci = 0; } else ci = rows[ri].cells.length - 1;
      }
    }

    const next = rows[ri].cells[ci];
    this.focusIndex = tiles.indexOf(next);
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  hide() {
    this._stopGamepadNav();
    this.root.innerHTML = '';
  }
}

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
const clampIndex = (i, len) => Math.max(0, Math.min(i, len - 1));
