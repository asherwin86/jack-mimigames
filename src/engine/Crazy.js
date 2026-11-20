import { confetti } from './Powers.js';

/**
 * "Go crazy": a chaos mode for whatever is on screen (a game, or the menu backdrop). The colours cycle all the time, and
 * every couple of seconds one random thing happens: the screen spins, wobbles, zooms, flips, shakes or blurs, the game
 * speeds up or slows down, confetti falls. The camera also swings in and out where it can. It runs until it is turned off,
 * or until the game ends or another one starts (the engine clears its effects then).
 * It never strobes: nothing flashes faster than a slow colour cycle, so it is no worse than the Disco power.
 */
const BURSTS = [
  ['fx-crazy-spin', 2600], ['fx-crazy-wobble', 2400], ['fx-crazy-zoom', 2200], ['fx-crazy-flip', 1800],
  ['fx-crazy-shake', 1500], ['fx-crazy-blur', 2000],
];

export const crazyOn = (engine) => !!engine?.fx?.has('crazy');

/** Turns chaos on or off (`on` undefined = flip it). Returns whether it is on now. */
export function setCrazy(engine, on = !crazyOn(engine), rng = Math.random) {
  if (!engine) return false;
  const running = crazyOn(engine);
  if (!on) { if (running) engine.fx.get('crazy')?.(); return false; }
  if (running) return true;
  const canvas = engine.canvas;
  const cam = engine.camera?.isPerspectiveCamera ? engine.camera : null;
  const baseFov = cam?.fov;
  const timers = [];
  let burst = null;
  let t0 = performance.now();

  canvas.classList.add('fx-crazy');
  const doBurst = () => {
    if (burst) canvas.classList.remove(burst);
    const [cls, ms] = BURSTS[Math.floor(rng() * BURSTS.length)];
    burst = cls;
    canvas.classList.add(cls);
    timers.push(setTimeout(() => { canvas.classList.remove(cls); if (burst === cls) burst = null; }, ms));
    const r = rng();
    if (r < 0.3) engine.setSlowmo?.(3, 1.8);          // faster
    else if (r < 0.5) engine.setSlowmo?.(3, 0.45);    // slower
    if (rng() < 0.35) confetti();
  };
  doBurst();
  timers.push(setInterval(doBurst, 2800));
  if (cam) timers.push(setInterval(() => {              // the lens breathes in and out
    cam.fov = Math.max(30, Math.min(115, baseFov + Math.sin((performance.now() - t0) / 700) * 22));
    cam.updateProjectionMatrix();
  }, 40));

  engine.fx.set('crazy', () => {
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    canvas.classList.remove('fx-crazy', ...BURSTS.map((b) => b[0]));
    if (cam) { cam.fov = baseFov; cam.updateProjectionMatrix(); }
    engine.fx.delete('crazy');
    if (engine.slow) engine.slow = null;
  });
  return true;
}
