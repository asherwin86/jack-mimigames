import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import { Scores } from '../engine/Storage.js';
import { hubUrl } from '../engine/Account.js';
import { BY_ID } from './catalog.js';
import { valueReached } from '../engine/challenges.js';
import { KART_FRAME_HTML } from './kart-circuit/frame.js';

const WINS_KEY = 'mg.kart-circuit.wins';
const LAPS_KEY = 'mg.kart-circuit.laps';

function readWins() {
  try { return Number(localStorage.getItem(WINS_KEY)) || 0; } catch { return 0; }
}

function readLaps() {
  try { return Number(localStorage.getItem(LAPS_KEY)) || 0; } catch { return 0; }
}


/**
 * Kart Circuit — a 3D arcade kart racer (its own front end, cups, 14 tracks,
 * items, drifting, split-screen and gamepad/touch support). It lives
 * in public/kart-circuit/ (a few small hooks aside, as it was written, with the
 * character roster renamed to generic dinos), and this wrapper just
 * puts it on screen inside the arcade: a full-window frame under the top bar.
 *
 * Scores: every lap you finish (the game tells us through a message) adds to a
 * running total that counts up for good, and the arcade keeps that as this
 * game's score — so it climbs however you place, and the lap challenges pay
 * out as it does. Race wins are still counted and celebrated.
 *
 * Escape (forwarded from inside the frame by bridge.js, or pressed while the
 * arcade itself has focus) returns to the menu rather than opening the
 * generic pause card, since the game has its own Pause (P).
 */
export default class KartCircuit extends Game {
  start() {
    this.genericPowers = false;   // the generic powers act on the arcade's canvas, which this game doesn't use
    // The game's online modes and profile calls read the account server's address from
    // here (it's a different site from this page). Signing in is shared too: the
    // arcade's session (mimiActiveSession) is exactly what the game looks for.
    try { localStorage.setItem('mimiServerOverride', hubUrl()); } catch { /* private mode: online modes just won't connect */ }

    // Nothing to draw in 3D — keep the arcade's own scene dark and empty.
    this.scene.background = new THREE.Color(0x0b0e16);

    this.hud.panel?.(`
      <style>
        .kc-frame { position:absolute; left:0; right:0; bottom:0; top:56px; pointer-events:auto; background:#0b0e16; z-index:10; }
        .kc-frame iframe { width:100%; height:100%; border:0; display:block; background:#0b0e16; }
      </style>
      <div class="kc-frame">
        <iframe title="Kart Circuit" allow="fullscreen *; gamepad *; autoplay *"></iframe>
      </div>`);

    const frame = this.hud.$panel?.querySelector?.('iframe');
    if (frame) {
      frame.addEventListener('load', () => frame.contentWindow?.focus());
      frame.srcdoc = KART_FRAME_HTML;   // same origin as the arcade — see kart-circuit/frame.js
    }

    this.laps = readLaps();
    this.hud.stat?.('Laps', this.laps);   // in the arcade's top bar, where the frame doesn't cover it

    this.onMessage = (e) => {
      if (e.data?.source !== 'kart-circuit' || (frame && e.source !== frame.contentWindow)) return;
      if (e.data.type === 'admin') {
        dispatchEvent(new Event('mimi:admin'));   // the backtick key, pressed inside the frame
      } else if (e.data.type === 'exit') {
        location.hash = '';
      } else if (e.data.type === 'lap-complete') {
        this.laps += 1;
        try { localStorage.setItem(LAPS_KEY, String(this.laps)); } catch { /* private mode: still counts this session */ }
        Scores.submit('kart-circuit', this.laps, true);
        this.hud.stat?.('Laps', this.laps);
        valueReached(BY_ID.get('kart-circuit'), this.laps);   // pays any "complete N laps" challenges
      } else if (e.data.type === 'race-finished' && e.data.won === true) {
        const wins = readWins() + 1;
        try { localStorage.setItem(WINS_KEY, String(wins)); } catch { /* private mode: still counts this session */ }
        this.hud.toast?.(`RACE WON · ${wins} win${wins === 1 ? '' : 's'}`, 2200);
      }
    };
    // Capture phase, so it runs before the arcade's own Escape handling (which would open its pause card).
    this.onEscape = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.rc-backdrop')) return;   // Escape is closing the Rocoins panel, not leaving the game
      e.stopImmediatePropagation();
      location.hash = '';
    };
    if (typeof addEventListener === 'function') {
      addEventListener('message', this.onMessage);
      addEventListener('keydown', this.onEscape, true);
    }
  }

  /** The frame has no arcade canvas to decorate, so it gets powers that act on the race itself. */
  adminPowers() {
    const send = (power) => new Promise((resolve) => {
      const win = this.hud.$panel?.querySelector?.('iframe')?.contentWindow;
      if (!win) { resolve({ ok: false, msg: 'The race is not ready.' }); return; }
      const done = (r) => { clearTimeout(timer); removeEventListener('message', on); resolve(r); };
      const on = (e) => {
        const d = e.data;
        if (d?.source === 'kart-circuit' && d.type === 'power-result' && d.power === power) done(d.ok ? { ok: true } : { ok: false, msg: d.why });
      };
      const timer = setTimeout(() => done({ ok: false, msg: 'The race did not answer.' }), 1500);
      addEventListener('message', on);
      win.postMessage({ source: 'arcade', type: 'power', power }, '*');
    });
    return [
      {
        id: 'turbo', name: 'Turbo boost', icon: '🚀', cost: 12,
        desc: 'A 3.5-second speed boost, right now. Offline races only.',
        run: async () => { const r = await send('boost'); return r.ok ? 'Boost!' : r; },
      },
      {
        id: 'item', name: 'Free item', icon: '🎁', cost: 6,
        desc: 'Fills your empty item slot with a random item. Offline races only.',
        run: async () => { const r = await send('item'); return r.ok ? 'Item ready.' : r; },
      },
    ];
  }

  dispose() {
    if (typeof removeEventListener === 'function') {
      removeEventListener('message', this.onMessage);
      removeEventListener('keydown', this.onEscape, true);
    }
  }
}
