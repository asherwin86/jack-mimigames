import { isInstalledCopy } from './Install.js';

/**
 * The sister arcade: 51 Mimi Games, a separate site (its own repo and server).
 * "Switching" is a jump to its address. On the website it opens in the same
 * tab, so Back returns here; in the desktop app, the Android app or an
 * installed web app it opens the normal browser instead, because those
 * windows only hold this arcade.
 */
export const OTHER_ARCADE = { name: '51 Mimi Games', url: 'https://mimi-games-bvpj.onrender.com/' };

export function switchToOtherArcade() {
  if (isInstalledCopy()) {
    try { window.open(OTHER_ARCADE.url, '_blank', 'noopener'); return; } catch { /* fall through */ }
  }
  location.href = OTHER_ARCADE.url;
}
