import { Rocoins } from './Rocoins.js';

/**
 * Powers: what the admin panel sells. Each power costs Rocoins, which come
 * only from challenges (see challenges.js). Every game gets the generic ones
 * below; a game can add its own by defining `adminPowers()` (Blockcraft and
 * Kart Circuit do) and can hide the generic set with `genericPowers = false`
 * (Kart Circuit draws in its own frame, so they'd do nothing there).
 *
 * A power looks like:
 *   { id, name, icon, cost, desc,
 *     toggle?    true = stays on until turned off again (turning it off is free)
 *     active?(ctx)     for toggles: is it on?
 *     available?(ctx)  true, or a string saying why not
 *     run(ctx)         does it; returns a message, false (nothing happened —
 *                      coins go back), { ok:false, msg } (same, with a reason)
 *                      or a Promise of any of these }
 *
 * ctx = { engine, game, entry }.
 */

const inGame = (ctx) => (ctx.game && !ctx.game.finished ? true : 'Start a game first.');
const genericOk = (ctx) => {
  if (!ctx.game) return 'Start a game first.';
  if (ctx.game.finished) return 'This run is over.';
  if (ctx.game.genericPowers === false) return 'This game has its own powers below.';
  return true;
};

/** A power that flips a class on the game canvas. */
function canvasFx(id, cls) {
  return (ctx) => {
    const c = ctx.engine.canvas;
    c.classList.add(cls);
    ctx.engine.fx.set(id, () => c.classList.remove(cls));
    return true;
  };
}

function confetti() {
  if (typeof document === 'undefined') return;
  const layer = document.createElement('div');
  layer.className = 'rc-confetti';
  const colours = ['#6ee7ff', '#ff6b9d', '#ffd166', '#a78bfa', '#7ee081'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colours[i % colours.length];
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.4}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`);
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3600);
}

export const GENERIC_POWERS = [
  {
    id: 'slowmo', name: 'Slow-mo', icon: '🐌', cost: 15,
    desc: 'The game runs at half speed for 25 seconds. Timers slow down too.',
    available: genericOk,
    run: ({ engine }) => { engine.setSlowmo(25, 0.5); return 'Slow-mo on for 25 seconds.'; },
  },
  {
    id: 'widecam', name: 'Wide view', icon: '🔭', cost: 8, toggle: true,
    desc: 'Pull the camera lens wide so you can see more around you.',
    available: (ctx) => {
      const ok = genericOk(ctx);
      if (ok !== true) return ok;
      return ctx.engine.camera?.isPerspectiveCamera ? true : "This game's camera can't be widened.";
    },
    active: (ctx) => ctx.engine.fx.has('widecam'),
    run: ({ engine }) => {
      const cam = engine.camera;
      const base = cam.fov;
      cam.fov = Math.min(110, base + 25);
      cam.updateProjectionMatrix();
      engine.fx.set('widecam', () => { cam.fov = base; cam.updateProjectionMatrix(); });
      return 'Wide view on.';
    },
  },
  {
    id: 'wireframe', name: 'Wireframe world', icon: '🕸️', cost: 5, toggle: true,
    desc: 'Draw everything as a see-through mesh. Just for the look.',
    available: genericOk,
    active: (ctx) => ctx.engine.fx.has('wireframe'),
    run: ({ engine }) => {
      const changed = [];
      engine.scene?.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          if (m && 'wireframe' in m && !m.wireframe) { m.wireframe = true; changed.push(m); }
        }
      });
      engine.fx.set('wireframe', () => { for (const m of changed) m.wireframe = false; });
      return 'Wireframe on.';
    },
  },
  {
    id: 'disco', name: 'Disco colours', icon: '🌈', cost: 4, toggle: true,
    desc: 'The whole screen cycles through every colour.',
    available: genericOk,
    active: (ctx) => ctx.engine.fx.has('disco'),
    run: canvasFx('disco', 'fx-disco'),
  },
  {
    id: 'retro', name: 'Retro screen', icon: '📺', cost: 4, toggle: true,
    desc: 'Faded, warm, old-television colours.',
    available: genericOk,
    active: (ctx) => ctx.engine.fx.has('retro'),
    run: canvasFx('retro', 'fx-retro'),
  },
  {
    id: 'confetti', name: 'Confetti', icon: '🎉', cost: 3,
    desc: 'A burst of confetti across the screen. Works in every game.',
    available: inGame,
    run: () => { confetti(); return 'Party time!'; },
  },
];

/** Every power you could use right now: the generic set (unless the game hides
 *  it) followed by the game's own. */
export function allPowers(ctx) {
  const own = (typeof ctx.game?.adminPowers === 'function' ? ctx.game.adminPowers() : []) || [];
  return [...GENERIC_POWERS, ...own.map((p) => ({ ...p, own: true }))];
}

/** Why a power can't be used right now, or null if it can. */
export function whyNot(p, ctx) {
  const ok = p.available ? p.available(ctx) : true;
  return ok === true ? null : String(ok);
}

const norm = (s) => String(s).toLowerCase().replace(/^\//, '').replace(/[^a-z0-9]/g, '');

/** Finds a power from what someone typed: id, name, or an unambiguous start of either. */
export function findPower(query, list) {
  const q = norm(query);
  if (!q) return null;
  const exact = list.find((p) => norm(p.id) === q || norm(p.name) === q);
  if (exact) return exact;
  const starts = list.filter((p) => norm(p.id).startsWith(q) || norm(p.name).startsWith(q));
  return starts.length === 1 ? starts[0] : null;
}

/**
 * Uses a power. Toggles that are already on switch off for free; everything
 * else is paid for first, and paid back if it turns out it couldn't be done.
 * Resolves to { ok, msg }.
 */
export async function usePower(p, ctx) {
  if (p.toggle && p.active?.(ctx)) {
    const undo = ctx.engine.fx.get(p.id);
    ctx.engine.fx.delete(p.id);
    try { undo?.(); } catch (e) { console.error(e); }
    return { ok: true, msg: `${p.name} off.` };
  }
  const why = whyNot(p, ctx);
  if (why) return { ok: false, msg: why };
  if (!Rocoins.spend(p.cost)) {
    const need = p.cost - Rocoins.balance();
    return { ok: false, msg: `${p.name} costs ${p.cost} Rocoins — you need ${need} more. Do challenges to earn them.` };
  }
  try {
    const r = await p.run(ctx);
    if (r === false || (r && typeof r === 'object' && r.ok === false)) {
      Rocoins.refund(p.cost);
      const why = r && r.msg ? `${r.msg} ` : '';
      return { ok: false, msg: `${why}You got your ${p.cost} Rocoins back.` };
    }
    if (r && typeof r === 'object') return { ok: true, msg: r.msg || `${p.name} used.` };
    return { ok: true, msg: typeof r === 'string' ? r : `${p.name} used.` };
  } catch (e) {
    console.error(e);
    Rocoins.refund(p.cost);
    return { ok: false, msg: `${p.name} failed — you got your ${p.cost} Rocoins back.` };
  }
}
