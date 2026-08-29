import { BY_ID } from './catalog.js';

// Vite turns this into a map of id -> dynamic import, so a game's code is only
// fetched when someone actually plays it. Scales to 100 entries for free.
const modules = import.meta.glob(['./*.js', '!./catalog.js', '!./index.js']);

export async function loadGame(id) {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`Unknown game: ${id}`);
  const loader = modules[`./${id}.js`];
  if (!loader) throw new Error(`Missing module for "${id}" (expected src/games/${id}.js)`);
  const mod = await loader();
  const GameClass = mod.default;
  if (typeof GameClass !== 'function') {
    throw new Error(`src/games/${id}.js must default-export a Game subclass`);
  }
  return { entry, GameClass };
}

export function isImplemented(id) {
  return Boolean(modules[`./${id}.js`]);
}
