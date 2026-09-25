/**
 * On-screen controls for touch devices (the Android app, or a phone browser).
 *
 * Nothing here talks to a game: it presses and releases the same keys a
 * keyboard would (by dispatching keydown / keyup on the window, which is what
 * engine/Input.js listens for), so every game works unchanged. Games that are
 * played entirely with the pointer (tap, drag, swipe) need no pad — touches
 * already arrive as pointer events — and only get the pause button.
 *
 *   pad    'wasd' | 'lr' | 'ud'   a thumb-stick on the left
 *   keys   [{ label, code, hold? }]  round buttons on the right
 *   row    [{ label, code }]       a wide row of big buttons along the bottom
 */
const TABLE = {
  'cube-dodger':   { pad: 'lr', keys: [{ label: 'BOOST', code: 'ShiftLeft' }] },
  'hurdle-runner': { pad: 'lr', keys: [{ label: 'JUMP', code: 'Space' }, { label: 'DUCK', code: 'KeyS' }] },
  'gem-grab':      { pad: 'wasd', keys: [{ label: 'DASH', code: 'Space' }] },
  'snake-cube':    { pad: 'wasd' },
  'frog-hopper':   { pad: 'wasd' },
  'platform-hop':  { pad: 'wasd', keys: [{ label: 'JUMP', code: 'Space' }] },
  'lava-floor':    { pad: 'wasd', keys: [{ label: 'JUMP', code: 'Space' }] },
  'sumo-arena':    { pad: 'wasd', keys: [{ label: 'DASH', code: 'Space' }] },
  'marble-maze':   { pad: 'wasd' },
  'tunnel-run':    { pad: 'wasd' },
  'orbit-dodge':   { pad: 'ud' },
  'maze-escape':   { pad: 'wasd', keys: [{ label: '⟲', code: 'KeyQ' }, { label: '⟳', code: 'KeyE' }, { label: 'RUN', code: 'ShiftLeft' }] },
  'grapple-gap':   { pad: 'lr', keys: [{ label: 'GRAPPLE', code: 'Space' }] },
  'arena-fighter': { pad: 'wasd', keys: [{ label: 'PUNCH', code: 'KeyJ' }, { label: 'KICK', code: 'KeyK' }, { label: 'BLOCK', code: 'ShiftLeft' }, { label: 'SUPER', code: 'KeyL' }] },
  'invader-grid': { pad: 'lr', keys: [{ label: 'FIRE', code: 'Space' }] },
  'pac-cube': { pad: 'wasd' },
  'catch-the-stars': { pad: 'lr' },
  'tank-battle': { pad: 'wasd', keys: [{ label: 'FIRE', code: 'Space' }] },
  'horde-survivor': { pad: 'wasd' },
  'rocket-lander': { pad: 'lr', keys: [{ label: 'THRUST', code: 'Space' }] },
  'slalom-ski': { pad: 'lr' },
  'tetra-drop': { pad: 'wasd', keys: [{ label: 'ROTATE', code: 'KeyW' }, { label: 'DROP', code: 'Space' }] },
  'parking-panic': { pad: 'wasd' },
  'crane-claw': { pad: 'wasd', keys: [{ label: 'DROP', code: 'Space' }] },
  'minesweeper': { keys: [{ label: 'FLAG', code: 'KeyF' }] },
  'crate-push': { pad: 'wasd', keys: [{ label: 'UNDO', code: 'KeyZ' }, { label: 'RESET', code: 'KeyR' }] },
  'star-fighter': { pad: 'wasd', keys: [{ label: 'FIRE', code: 'Space' }] },
  'turret-defence': { keys: [{ label: 'RELOAD', code: 'KeyR' }] },
  'light-cycles': { pad: 'wasd' },
  'sky-climb': { pad: 'lr' },
  'tightrope': { pad: 'lr' },
  'highway-rush': { pad: 'wasd' },
  'numbers-blast': { pad: 'lr' },
  'goalkeeper': { pad: 'wasd' },
  'curling': { keys: [{ label: 'SWEEP', code: 'Space' }, { label: 'CURL', code: 'KeyC' }] },
  'track-sprint': { pad: 'lr' },
  'ski-jump': { pad: 'ud', keys: [{ label: 'JUMP', code: 'Space' }] },
  'beat-lanes':    { row: [{ label: 'D', code: 'KeyD' }, { label: 'F', code: 'KeyF' }, { label: 'J', code: 'KeyJ' }, { label: 'K', code: 'KeyK' }] },
};

const KEY_NAMES = { Space: ' ', ShiftLeft: 'Shift', Escape: 'Escape' };
const keyName = (code) => KEY_NAMES[code] ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code);

/** Touch screen? A phone/tablet's primary pointer is "coarse". (A TV in the Android app has a controller or remote,
 *  not a touch screen, so it correctly gets no on-screen pad.) */
export function touchWanted() {
  try { if (localStorage.getItem('mimiTouch') === '1') return true; } catch { /* storage blocked */ }
  if (typeof window === 'undefined') return false;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.held = new Set();
    this.cleanups = [];
  }

  press(code) {
    if (this.held.has(code)) return;
    this.held.add(code);
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: keyName(code), bubbles: true }));
  }

  release(code) {
    if (!this.held.delete(code)) return;
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key: keyName(code), bubbles: true }));
  }

  releaseAll() { for (const c of [...this.held]) this.release(c); }

  hide() {
    this.releaseAll();
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    if (this.root) this.root.innerHTML = '';
  }

  /** Builds the controls for a game (or nothing, if this isn't a touch device / the game has its own). */
  show(entry) {
    this.hide();
    if (!this.root || !touchWanted() || entry.customStart) return;
    const cfg = TABLE[entry.id] || {};
    const el = document.createElement('div');
    el.className = 'tc';
    this.root.appendChild(el);

    // A pointer-driven control: `down`/`up` run on press and on release/cancel, with the pointer captured
    // so a thumb that slides off the button still lets go properly.
    const wire = (node, { down, move, up }) => {
      const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
      node.addEventListener('pointerdown', (e) => { stop(e); try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ } node.classList.add('on'); down?.(e); });
      node.addEventListener('pointermove', (e) => { if (node.classList.contains('on')) { stop(e); move?.(e); } });
      const end = (e) => { if (!node.classList.contains('on')) return; stop(e); node.classList.remove('on'); up?.(e); };
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
      node.addEventListener('lostpointercapture', end);
    };

    // Pause: the same Escape a keyboard would press.
    const pause = document.createElement('button');
    pause.className = 'tc-pause';
    pause.textContent = 'II';
    pause.setAttribute('aria-label', 'Pause');
    wire(pause, { down: () => { this.press('Escape'); }, up: () => { this.release('Escape'); } });
    el.appendChild(pause);

    if (cfg.pad) el.appendChild(this.buildPad(cfg.pad, wire));

    if (cfg.keys?.length) {
      const box = document.createElement('div');
      box.className = `tc-keys n${cfg.keys.length}`;
      for (const k of cfg.keys) box.appendChild(this.buildButton(k, 'tc-btn', wire));
      el.appendChild(box);
    }
    if (cfg.row?.length) {
      const row = document.createElement('div');
      row.className = 'tc-row';
      for (const k of cfg.row) row.appendChild(this.buildButton(k, 'tc-lane', wire));
      el.appendChild(row);
    }
    this.cleanups.push(() => el.remove());
  }

  buildButton({ label, code }, cls, wire) {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    wire(b, { down: () => this.press(code), up: () => this.release(code) });
    return b;
  }

  /** A thumb-stick: slide from the centre and the matching direction keys are held. */
  buildPad(mode, wire) {
    const pad = document.createElement('div');
    pad.className = `tc-pad ${mode}`;
    const knob = document.createElement('div');
    knob.className = 'tc-knob';
    pad.appendChild(knob);
    const DEAD = 0.28;
    const apply = (e) => {
      const r = pad.getBoundingClientRect();
      const half = r.width / 2;
      const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + half)) / half));
      const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + half)) / half));
      const horizontal = mode !== 'ud';
      const vertical = mode !== 'lr';
      knob.style.transform = `translate(${(horizontal ? dx : 0) * half * 0.55}px, ${(vertical ? dy : 0) * half * 0.55}px)`;
      const want = {
        KeyD: horizontal && dx > DEAD, KeyA: horizontal && dx < -DEAD,
        KeyW: vertical && dy < -DEAD, KeyS: vertical && dy > DEAD,
      };
      for (const [code, on] of Object.entries(want)) { if (on) this.press(code); else this.release(code); }
    };
    wire(pad, {
      down: apply,
      move: apply,
      up: () => {
        knob.style.transform = '';
        for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) this.release(c);
      },
    });
    return pad;
  }
}
