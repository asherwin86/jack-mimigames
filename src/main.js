import { Engine } from './engine/Engine.js';
import { Menu } from './ui/Menu.js';
import { showResults, showError } from './ui/Results.js';
import { showStart, showPause } from './ui/Overlay.js';
import { loadGame } from './games/index.js';
import { buildBackdrop } from './ui/Backdrop.js';
import { Settings } from './engine/Settings.js';

const canvas = document.getElementById('stage');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

const engine = new Engine(canvas, hudRoot);
const menu = new Menu(uiRoot, (id) => { location.hash = `#/${id}`; });
// The toggle only ever applies to the menu backdrop, which is the idle scene.
menu.onProps = (on) => engine.idleScene?.setProps?.(on);

let current = null;
let currentEntry = null;
let paused = false;

engine.onExit = () => { location.hash = ''; };
engine.onEnd = (entry, score, detail) => {
  paused = false;
  engine.freeze();
  engine.input.exitLock();
  showResults(uiRoot, entry, score, detail, {
    onReplay: () => play(entry.id),
    onMenu: () => { location.hash = ''; },
  });
};

async function play(id) {
  uiRoot.innerHTML = '';
  paused = false;
  menu.hide();
  try {
    const { entry, GameClass } = await loadGame(id);
    if (location.hash.slice(2) !== id) return;   // navigated away mid-load
    current = id;
    currentEntry = entry;
    engine.mount(entry, GameClass);
    // A game that manages its own landing screen (currently just Blockcraft)
    // needs the update loop running right away so that screen — built from
    // inside the game itself — can actually respond to anything; the generic
    // card is just for everyone else.
    if (entry.customStart) engine.resume();
    else showStart(uiRoot, entry, () => engine.resume());
  } catch (err) {
    console.error(err);
    showError(uiRoot, err.message, () => { location.hash = ''; });
  }
}

/** Escape mid-run: pause and show the card, rather than leaving straight to
 *  the menu — a second Escape (or the card's own buttons) does the rest.
 *  Escape at the Start screen (nothing running or paused yet) still bails
 *  straight out, same as before there was a Start screen to dismiss. */
function togglePause() {
  if (!engine.running && !paused) { location.hash = ''; return; }
  if (paused) {
    paused = false;
    uiRoot.innerHTML = '';
    engine.resume();
  } else {
    paused = true;
    engine.pause();
    showPause(uiRoot, currentEntry, {
      onResume: () => { paused = false; engine.resume(); },
      onMenu: () => { location.hash = ''; },
    });
  }
}

function toMenu() {
  current = null;
  currentEntry = null;
  paused = false;
  engine.setIdle(buildBackdrop);
  menu.show();
}

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  if (!id) toMenu();
  else if (id !== current) play(id);
}

addEventListener('hashchange', route);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (current) togglePause();
    else if (location.hash) location.hash = '';
    return;
  }

  // Shift strips the sky back to the rainbow and leaves the game tiles alone.
  // Only on the menu: in a game Shift belongs to the game, and while the search
  // box has focus it belongs to whoever is typing capitals.
  if (e.key !== 'Shift' || e.repeat) return;
  if (!engine.idleScene?.setProps) return;
  if (e.target instanceof HTMLInputElement) return;
  const on = Settings.toggle('bgProps');
  engine.idleScene.setProps(on);
  menu.syncProps(on);
});
route();
