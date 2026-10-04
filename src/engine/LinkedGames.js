import { isInstalledCopy } from './Install.js';
import { switchToOtherArcade } from './OtherArcade.js';

/**
 * Things the menu lists that are not built-in games: the sister arcade and the
 * Unity games. They open in a page of their own, not inside the arcade's 3D
 * engine, so they are kept apart from CATALOG (no scores, challenges or smoke
 * tests apply to them).
 *
 *   kind 'arcade' : 51 Mimi Games (the Windows app starts the other app; see OtherArcade.js)
 *   kind 'page'   : a Unity WebGL build in unity-builds/<id>/, served by the website at unity/<id>/
 *                   (left out of the Windows and Android apps because it is big; there the tile opens the website)
 */
export const SITE_URL = 'https://mimi-games-hzi0.onrender.com/';

export const LINKED = [
  {
    id: 'kart-racer', kind: 'page', name: 'Island Kart Rush', badge: 'Unity', tags: ['racing'],
    blurb: 'Four realms, twenty tracks, one island. A kart racer made in Unity that runs in your browser. W or arrows drive, A and D steer, Space drifts. It opens in its own page, and the first visit is a big download.',
    path: 'unity/kart-racer/index.html',
  },
  {
    id: 'sky-hop-party', kind: 'page', name: 'Sky Hop Party', badge: 'Unity', tags: ['platformer'],
    blurb: 'Race over floating islands: first to the flag wins. Pick a course, then play solo or go online. WASD or arrows move, Space jumps (twice for a double jump). It opens its own page, and the first visit is a big download.',
    path: 'unity/sky-hop-party/index.html',
  },
  {
    id: 'tag-game', kind: 'page', name: 'Tag Game', badge: 'Unity', tags: ['chase'],
    blurb: 'Tag in 3D: dodge the taggers in practice mode, or play online against other people. Made in Unity. It opens its own page, and the first visit is a big download.',
    path: 'unity/tag-game/index.html',
  },
  {
    id: 'mimi-51', kind: 'arcade', name: '51 Mimi Games', badge: 'Arcade', tags: ['arcade'],
    blurb: 'The sister arcade: dozens more mini-games, plus Kart Circuit, Block Realm and Rival Arena. Opens 51 Mimi Games.',
  },
];

/** Where a tile goes: the page next to this one on the website, or the website's address from an installed copy. */
export function linkedUrl(entry, installed = isInstalledCopy()) {
  if (entry.kind !== 'page') return null;
  return `${installed ? SITE_URL : ''}${entry.path}?fs=1`;
}

/** Opens a linked tile. */
export function openLinked(entry) {
  if (entry.kind === 'arcade') { switchToOtherArcade(); return; }
  const installed = isInstalledCopy();
  const url = linkedUrl(entry, installed);
  if (!url) return;
  if (installed) { try { window.open(url, '_blank', 'noopener'); return; } catch { /* fall through */ } }
  location.href = url;
}
