import { Engine } from './engine/Engine.js';
import { Menu } from './ui/Menu.js';
import { showResults, showError } from './ui/Results.js';
import { showStart, showPause } from './ui/Overlay.js';
import { loadGame } from './games/index.js';
import { buildBackdrop } from './ui/Backdrop.js';
import { Settings } from './engine/Settings.js';
import { Rocoins } from './engine/Rocoins.js';
import { runFinished, onEarned, minutesPlayed } from './engine/challenges.js';
import { createAdmin, notifyEarned } from './ui/AdminPanel.js';
import { startRocoinSync } from './engine/RocoinSync.js';

const canvas = document.getElementById('stage');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

const engine = new Engine(canvas, hudRoot);
const menu = new Menu(uiRoot, (id) => { location.hash = `#/${id}`; }, engine.input);
// The toggle only ever applies to the menu backdrop, which is the idle scene.
menu.onProps = (on) => engine.idleScene?.setProps?.(on);
menu.onBlackSky = (on) => engine.idleScene?.setBlack?.(on);
menu.onMusic = (on) => engine.idleScene?.setMusic?.(on);

let current = null;
let currentEntry = null;
let paused = false;

// ---------- Rocoins: the wallet, the admin panel (` key) and challenge pay-outs ----------
let adminWasRunning = false;
const admin = createAdmin({
  engine,
  getEntry: () => currentEntry,
  // Opening the panel freezes the game underneath (like a pause) and closing it carries on.
  onOpen: () => { adminWasRunning = engine.running; if (adminWasRunning) engine.pause(); },
  onClose: () => { if (adminWasRunning && current) engine.resume(); adminWasRunning = false; },
});
engine.onAdmin = () => admin.toggle();
menu.onAdmin = () => admin.toggle();
const syncCoins = () => { engine.hud.coins(Rocoins.balance()); menu.setCoins?.(Rocoins.balance()); };
Rocoins.onChange(syncCoins);
syncCoins();
onEarned(notifyEarned);
startRocoinSync();   // signed in: the wallet is backed up to the account and follows you between devices
addEventListener('mimi:admin', () => admin.toggle());   // Kart Circuit forwards the key from inside its frame

// Sandbox games (Blockcraft) have no score, so their challenge is time spent playing.
setInterval(() => {
  if (currentEntry?.sandbox && engine.running && !document.hidden) minutesPlayed(currentEntry, 10 / 60);
}, 10000);

/** Lets a gamepad "click" whichever card is up (Start, Pause, Results,
 *  Error) — A for the primary button, B for the secondary one, if there is
 *  one. Polls on its own rAF, edge-detecting locally rather than via
 *  input.gpHit(): that edge is tracked once per Engine frame and cleared by
 *  input.endFrame(), which — since Engine's own rAF callback is registered
 *  first — always runs before any later-registered loop's poll in a shared
 *  tick, so a later loop would never see it "freshly" pressed. Stops itself
 *  once the primary button is gone from the DOM (the card was dismissed). */
function gamepadConfirm(primarySelector, secondarySelector) {
  let aHeld = false;
  let bHeld = false;
  const tick = () => {
    const primary = uiRoot.querySelector(primarySelector);
    if (!primary) return;   // card dismissed — let the loop end
    const aNow = engine.input.gpButton(0);
    if (aNow && !aHeld) primary.click();
    aHeld = aNow;
    if (secondarySelector) {
      const bNow = engine.input.gpButton(1);
      if (bNow && !bHeld) uiRoot.querySelector(secondarySelector)?.click();
      bHeld = bNow;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

engine.onExit = () => { location.hash = ''; };
engine.onEnd = (entry, score, detail) => {
  paused = false;
  engine.freeze();
  engine.input.exitLock();
  runFinished(entry, score);   // before showResults stores the score, so it can tell a personal best; pays out via onEarned
  showResults(uiRoot, entry, score, detail, {
    onReplay: () => play(entry.id),
    onMenu: () => { location.hash = ''; },
  });
  gamepadConfirm('[data-act="replay"]', '[data-act="menu"]');
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
    if (entry.customStart) {
      engine.resume();
    } else {
      showStart(uiRoot, entry, () => engine.resume());
      gamepadConfirm('[data-act="play"]');
    }
  } catch (err) {
    console.error(err);
    showError(uiRoot, err.message, () => { location.hash = ''; });
    gamepadConfirm('[data-act="menu"]');
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
    gamepadConfirm('[data-act="resume"]', '[data-act="menu"]');
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
  // ` opens/closes the Rocoins panel from anywhere — except while typing somewhere else (Blockcraft's chat).
  if (e.code === 'Backquote' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing || e.target.closest?.('.rc-card')) { e.preventDefault(); admin.toggle(); }
    return;
  }
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
