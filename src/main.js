import './engine/NativePad.js';   // controllers in the Android app (see the file)
import { Engine } from './engine/Engine.js';
import { Menu } from './ui/Menu.js';
import { showResults, showError } from './ui/Results.js';
import { showStart, showPause } from './ui/Overlay.js';
import { loadGame } from './games/index.js';
import { buildBackdrop } from './ui/Backdrop.js';
import { mountEventCounter } from './ui/EventCounter.js';
import { Settings } from './engine/Settings.js';
import { Rocoins } from './engine/Rocoins.js';
import { runFinished, onEarned, minutesPlayed } from './engine/challenges.js';
import { createAdmin, notifyEarned } from './ui/AdminPanel.js';
import { startRocoinSync } from './engine/RocoinSync.js';
import { TouchControls } from './ui/TouchControls.js';
import './engine/Install.js';   // catches the browser's install prompt and registers the service worker (website only)

const canvas = document.getElementById('stage');
const hudRoot = document.getElementById('hud');
const uiRoot = document.getElementById('ui');

const engine = new Engine(canvas, hudRoot);
const touch = new TouchControls(document.getElementById('touch'));   // on-screen pad/buttons on touch devices
window.__mimiEngine = engine;   // handy for tests and debugging
const menu = new Menu(uiRoot, (id) => { location.hash = `#/${id}`; }, engine.input);
// The toggle only ever applies to the menu backdrop, which is the idle scene.
menu.onProps = (on) => engine.idleScene?.setProps?.(on);
menu.onBlackSky = (on) => engine.idleScene?.setBlack?.(on);
menu.onMusic = (on) => engine.idleScene?.setMusic?.(on);
const eventCounter = mountEventCounter();
menu.onSeasonal = (on) => { engine.idleScene?.setSeasonal?.(on); eventCounter.refresh(); };

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

/** Lets a gamepad drive whichever card is up (Start, Pause, Results, Error). A presses the highlighted button (the
 *  primary one to begin with), the D-pad or left stick moves the highlight between the primary and the secondary button
 *  (left/up = primary, right/down = secondary), and B or Select presses the secondary one straight away. So even a
 *  controller whose B button never arrives (some TV setups) can still reach "Quit to menu" with D-pad + A.
 *  Polls on its own rAF, edge-detecting locally rather than via input.gpHit(): that edge is tracked once per Engine
 *  frame and cleared by input.endFrame(), which — since Engine's own rAF callback is registered first — always runs
 *  before any later-registered loop's poll in a shared tick, so a later loop would never see it "freshly" pressed.
 *  Stops itself once the primary button is gone from the DOM (the card was dismissed). */
function gamepadConfirm(primarySelector, secondarySelector) {
  const held = new Set();
  const edge = (name, now) => { const was = held.has(name); if (now) held.add(name); else held.delete(name); return now && !was; };
  let sel = 0;
  let hinted = false;
  const tick = () => {
    const primary = uiRoot.querySelector(primarySelector);
    if (!primary) return;   // card dismissed — let the loop end
    const secondary = secondarySelector ? uiRoot.querySelector(secondarySelector) : null;
    const btns = [primary, secondary].filter(Boolean);
    const inp = engine.input;
    const padOn = inp.gamepadIndex !== null || inp.gpButton(0) || inp.gpButton(12) || inp.gpButton(13);

    if (padOn && !hinted) {   // say which buttons do what, once a controller is in use
      hinted = true;
      const row = primary.parentElement;
      const hint = document.createElement('p');
      hint.className = 'pad-hint';
      hint.textContent = secondary
        ? `A: ${primary.textContent.trim()}  ·  B: ${secondary.textContent.trim()}  ·  D-pad to choose`
        : `A: ${primary.textContent.trim()}`;
      row?.after(hint);
    }

    if (secondary) {
      const dir = (inp.gpButton(14) || inp.gpButton(12) || inp.gpAxis(0) < -0.5 || inp.gpAxis(1) < -0.5) ? -1
        : (inp.gpButton(15) || inp.gpButton(13) || inp.gpAxis(0) > 0.5 || inp.gpAxis(1) > 0.5) ? 1 : 0;
      if (edge('nav', dir !== 0)) sel = dir < 0 ? 0 : 1;
      if (edge('b', inp.gpButton(1)) || edge('select', inp.gpButton(8))) { secondary.click(); return; }
    }
    const cursorInUse = engine.domCursor && inp.usingGamepadPointer;   // A belongs to the cursor then (see the loop below)
    if (edge('a', inp.gpButton(0)) && !cursorInUse) { btns[Math.min(sel, btns.length - 1)].click(); return; }
    if (padOn) btns.forEach((b, i) => b.classList.toggle('gp-hover', i === Math.min(sel, btns.length - 1)));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

engine.onExit = () => { location.hash = ''; };
engine.onEnd = (entry, score, detail) => {
  paused = false;
  engine.freeze();
  engine.input.exitLock();
  touch.releaseAll();
  runFinished(entry, score);   // before showResults stores the score, so it can tell a personal best; pays out via onEarned
  showResults(uiRoot, entry, score, detail, {
    onReplay: () => play(entry.id),
    onMenu: () => { location.hash = ''; },
  });
  gamepadConfirm('[data-act="replay"]', '[data-act="menu"]');
};

async function play(id) {
  touch.hide();
  uiRoot.innerHTML = '';
  paused = false;
  engine.domCursor = false;
  menu.hide();
  try {
    const { entry, GameClass } = await loadGame(id);
    if (location.hash.slice(2) !== id) return;   // navigated away mid-load
    current = id;
    currentEntry = entry;
    engine.mount(entry, GameClass);
    touch.show(entry);
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
    engine.domCursor = false;
    uiRoot.innerHTML = '';
    engine.resume();
  } else {
    paused = true;
    engine.pause();
    engine.domCursor = !!currentEntry?.padCursor;
    showPause(uiRoot, currentEntry, {
      onResume: () => { paused = false; engine.domCursor = false; engine.resume(); },
      onMenu: () => { location.hash = ''; },
    });
    gamepadConfirm('[data-act="resume"]', '[data-act="menu"]');
  }
}

function toMenu() {
  touch.hide();
  engine.domCursor = false;
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

// A controller's Start button opens (and closes) the pause screen, like Escape does on a keyboard (a TV has no keyboard).
let startHeld = false;
setInterval(() => {
  const down = engine.input.gpButton(9);
  // Only mid-run (or to resume): on the Start card, or once the results are up, it does nothing. Kart Circuit has its own
  // pause on the same button, inside its frame.
  if (down && !startHeld && current && currentEntry?.id !== 'kart-circuit' && (engine.running || paused) && !engine.game?.padCursorActive?.()) togglePause();
  startHeld = down;
}, 50);

// A controller cursor over screens made of DOM buttons (Blockcraft's start and pause screens): the left stick moves it (Input
// does that), A clicks whatever is under it, the right stick scrolls the panel it is over. With no cursor out, A on a game's
// start screen does its primary action (Blockcraft: Play).
{
  let aHeld = false;
  let last = performance.now();
  let hover = null;
  const scrollable = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n;
    }
    return null;
  };
  const tick = (now) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const inp = engine.input;
    const g = engine.game;
    const on = engine.domCursor || (g?.padCursorActive?.() ?? false);
    const aNow = inp.gpButton(0);
    let el = null;
    if (on && inp.usingGamepadPointer) {
      const p = inp.gpPointer;
      el = document.elementFromPoint((p.x * 0.5 + 0.5) * innerWidth, (1 - (p.y * 0.5 + 0.5)) * innerHeight);
      const over = el?.closest?.('button, a, input, select, label, .bc-world-row, [role="button"]') ?? null;
      if (over !== hover) { hover?.classList.remove('gp-over'); hover = over; hover?.classList.add('gp-over'); }
      const v = inp.gpAxis(3);
      const box = v ? scrollable(el) : null;
      if (box) box.scrollTop += v * 700 * dt;
      if (aNow && !aHeld && el) {
        el.click();
        const field = el.closest?.('input, textarea');
        if (field) field.focus();
      }
    } else {
      if (hover) { hover.classList.remove('gp-over'); hover = null; }
      if (on && aNow && !aHeld && !engine.domCursor) g?.padPrimary?.();
    }
    aHeld = aNow;
  };
  requestAnimationFrame(tick);
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
