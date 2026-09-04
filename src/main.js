import { Engine } from './engine/Engine.js';
import { Menu } from './ui/Menu.js';
import { showResults, showError } from './ui/Results.js';
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

engine.onExit = () => { location.hash = ''; };
engine.onEnd = (entry, score, detail) => {
  engine.freeze();
  engine.input.exitLock();
  showResults(uiRoot, entry, score, detail, {
    onReplay: () => play(entry.id),
    onMenu: () => { location.hash = ''; },
  });
};

async function play(id) {
  uiRoot.innerHTML = '';
  menu.hide();
  try {
    const { entry, GameClass } = await loadGame(id);
    if (location.hash.slice(2) !== id) return;   // navigated away mid-load
    current = id;
    engine.mount(entry, GameClass);
  } catch (err) {
    console.error(err);
    showError(uiRoot, err.message, () => { location.hash = ''; });
  }
}

function toMenu() {
  current = null;
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
  if (e.key === 'Escape' && location.hash) location.hash = '';

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
