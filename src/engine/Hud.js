/** DOM overlay: top bar of stats, a centre toast, and a bottom hint line. */
export class Hud {
  constructor(root) {
    this.root = root;
    this.stats = new Map();
    this._toastTimer = 0;
    this.onExit = null;
  }

  mount(title, hint = '') {
    this.stats.clear();
    this.root.innerHTML = `
      <div class="hud-bar">
        <button class="hud-back" type="button">&larr; All games</button>
        <div class="hud-title"></div>
        <div class="hud-spacer"></div>
        <div class="hud-stats" style="display:flex;gap:22px"></div>
      </div>
      <div class="hud-toast"></div>
      <div class="hud-panel"></div>
      <div class="hud-hint" hidden></div>`;
    this.$title = this.root.querySelector('.hud-title');
    this.$stats = this.root.querySelector('.hud-stats');
    this.$toast = this.root.querySelector('.hud-toast');
    this.$hint = this.root.querySelector('.hud-hint');
    this.$panel = this.root.querySelector('.hud-panel');
    this.$title.textContent = title;
    this.root.querySelector('.hud-back').onclick = () => this.onExit?.();
    this.hint(hint);
  }

  /** Create or update a labelled stat in the top-right cluster. */
  stat(label, value, warn = false) {
    let el = this.stats.get(label);
    if (!el) {
      el = document.createElement('div');
      el.className = 'hud-stat';
      el.innerHTML = `<small></small><span></span>`;
      el.querySelector('small').textContent = label;
      this.$stats.appendChild(el);
      this.stats.set(label, el);
    }
    el.querySelector('span').textContent = value;
    el.classList.toggle('warn', warn);
  }

  /** Bespoke overlay markup for games that need more than stats. Returns the
   *  container so the game can update it directly each frame. */
  panel(html = '') {
    if (!this.$panel) return null;
    this.$panel.innerHTML = html;
    return this.$panel;
  }

  toast(text, ms = 900) {
    if (!this.$toast) return;
    this.$toast.textContent = text;
    this.$toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.$toast.classList.remove('show'), ms);
  }

  hint(text) {
    if (!this.$hint) return;
    this.$hint.textContent = text || '';
    this.$hint.hidden = !text;
  }

  clear() {
    clearTimeout(this._toastTimer);
    this.root.innerHTML = '';
    this.stats.clear();
  }
}
