import * as THREE from 'three';
import { Game } from '../engine/Game.js';

/**
 * Kart Circuit — an original arcade kart racer (canvas-based, with its own
 * menus, cups, tracks, difficulty levels and gamepad/touch support). It lives
 * in public/kart-circuit/ exactly as it was written, and this wrapper just
 * puts it on screen inside the arcade: a full-window frame under the top bar.
 *
 * Escape (forwarded from inside the frame by bridge.js, or pressed while the
 * arcade itself has focus) returns to the menu rather than opening the
 * generic pause card, since the game has its own Pause (P).
 */
export default class KartCircuit extends Game {
  start() {
    // Nothing to draw in 3D — keep the arcade's own scene dark and empty.
    this.scene.background = new THREE.Color(0x0b0e16);

    this.hud.panel?.(`
      <style>
        .kc-frame { position:absolute; left:0; right:0; bottom:0; top:56px; pointer-events:auto; background:#0b0e16; z-index:10; }
        .kc-frame iframe { width:100%; height:100%; border:0; display:block; background:#0b0e16; }
      </style>
      <div class="kc-frame">
        <iframe src="kart-circuit/index.html" title="Kart Circuit" allow="fullscreen; gamepad; autoplay"></iframe>
      </div>`);

    const frame = this.hud.$panel?.querySelector?.('iframe');
    if (frame) frame.addEventListener('load', () => frame.contentWindow?.focus());

    this.onMessage = (e) => {
      if (e.data?.source === 'kart-circuit' && e.data.type === 'exit' && (!frame || e.source === frame.contentWindow)) {
        location.hash = '';
      }
    };
    // Capture phase, so it runs before the arcade's own Escape handling (which would open its pause card).
    this.onEscape = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      location.hash = '';
    };
    if (typeof addEventListener === 'function') {
      addEventListener('message', this.onMessage);
      addEventListener('keydown', this.onEscape, true);
    }
  }

  dispose() {
    if (typeof removeEventListener === 'function') {
      removeEventListener('message', this.onMessage);
      removeEventListener('keydown', this.onEscape, true);
    }
  }
}
