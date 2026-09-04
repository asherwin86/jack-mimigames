import { CATALOG, ALL_TAGS, TARGET } from '../games/catalog.js';
import { isImplemented } from '../games/index.js';
import { Scores } from '../engine/Storage.js';
import { Settings } from '../engine/Settings.js';

export class Menu {
  constructor(root, onPlay) {
    this.root = root;
    this.onPlay = onPlay;
    this.query = '';
    this.tag = null;
    this.onProps = null;   // (on) => void, so the backdrop can follow the toggle
  }

  show() {
    this.root.innerHTML = `
      <div class="menu">
        <div class="menu-head">
          <h1><span class="red">100</span> <span class="blue">Mimi</span> <span class="red">Games</span></h1>
          <p>${CATALOG.length} of ${TARGET} built &middot; every one rendered in 3D</p>
          <div class="menu-tools">
            <input type="search" placeholder="Search games…" autocomplete="off" />
            <button class="toggle" aria-pressed="${Settings.get('bgProps', true)}">
              <span class="dot"></span>Background props <kbd>Shift</kbd>
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

    this.root.querySelector('.toggle').onclick = () => {
      const on = Settings.toggle('bgProps');
      this.syncProps(on);
      this.onProps?.(on);
    };

    this.$grid.onclick = (e) => {
      const t = e.target.closest('.tile');
      if (t && !t.classList.contains('soon')) this.onPlay(t.dataset.id);
    };

    this.render();
  }

  /** Reflects the props setting on the button, for when Shift flips it. */
  syncProps(on) {
    this.root.querySelector('.toggle')?.setAttribute('aria-pressed', String(on));
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

  hide() { this.root.innerHTML = ''; }
}

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));
