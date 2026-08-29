# 100 Mimi Games

A 3D mini-game arcade in the browser: one engine, one hub, and a catalogue that
grows toward 100 games. Built with [Three.js](https://threejs.org) and Vite.

**21 of 100 games are built**, including a voxel sandbox. The engine, hub, scoring and lazy-loading are
finished — remaining work is authoring games against the API below.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static bundle in dist/
npm run smoke    # headless logic test across every catalogued game
```

## How it fits together

```
src/
  main.js              hash router: #/<game-id> plays a game, no hash is the hub
  engine/
    Engine.js          renderer, render loop, mount/unmount, resize, pause
    Game.js            base class every mini-game extends
    Input.js           keyboard + pointer, edge-triggered, with raycast helpers
    Audio.js           WebAudio blip synth — no audio assets anywhere
    Hud.js             top stat bar, centre toast, bottom hint line
    Storage.js         per-game personal bests in localStorage
    utils.js           mesh/lighting/particle/maths helpers shared by all games
  ui/
    Menu.js            the hub grid, search and tag filters
    Results.js         end-of-run card
    Backdrop.js        ambient scene behind the menu
  games/
    catalog.js         metadata for every game — the menu reads only this
    index.js           lazy loader (Vite glob → one JS chunk per game)
    <game-id>.js       one file per game
    blockcraft.js      the voxel sandbox: chunked meshing, terrain, block editing
```

Each game is code-split into its own chunk, so the hub loads Three.js plus the
engine and nothing else. Adding the 100th game does not slow down the first.

## Adding a game

**1. Add an entry to `src/games/catalog.js`:**

```js
{
  id: 'ring-runner', n: 11, name: 'Ring Runner', tags: ['reflex'],
  blurb: 'One line the hub shows on the tile.',
  controls: 'Shown as a hint at the bottom of the screen',
  unit: 'pts',              // suffix on the score
  higherIsBetter: true,     // set false for time-attack games
}
```

**2. Create `src/games/ring-runner.js`** — the filename must match the `id`, and
the module must default-export a `Game` subclass:

```js
import { Game } from '../engine/Game.js';
import { box, lights, sky, PALETTE } from '../engine/utils.js';

export default class RingRunner extends Game {
  start() {                      // build the scene once
    sky(this.scene, '#1b2a52', '#080b14');
    lights(this.scene);
    this.player = this.add(box(1, 1, 1, PALETTE.cyan));
    this.camera.position.set(0, 5, 10);
  }

  update(dt) {                   // every frame; dt is seconds, clamped to 1/20
    this.player.position.x += this.input.axisX() * 8 * dt;
    this.hud.stat('Score', Math.floor(this.time));
    if (someLoseCondition) this.end(score, 'Optional one-line summary.');
  }
}
```

That is the whole contract. The engine builds the scene, camera, HUD and input,
tears everything down on exit, and records the score against the personal best.

### What you get on `this`

| | |
|---|---|
| `this.scene` `this.camera` `this.renderer` | Three.js objects, fresh per run |
| `this.add(obj)` | add to the scene and return it |
| `this.input` | `axisX()` `axisY()` `key()` `hit()` `clicked` `down` `pointer` `pick(camera, objs)` `pickPlane(camera)` |
| `this.hud` | `stat(label, value, warn)` `toast(text)` `hint(text)` |
| `this.audio` | `blip(semitone)` `pickup()` `good()` `bad()` `thud()` `boom()` `win()` `lose()` `tone(freq, dur, opts)` |
| `this.time` | seconds since the run started |
| `this.end(score, detail)` | finish the run and show the results card |
| `this.useCamera(cam)` / `this.orthoCamera(h)` | swap in your own camera |

`input` is edge-triggered: `hit('Space')` is true only on the frame the key goes
down, `key('Space')` is true while it is held. `clicked` works the same way.

`engine/utils.js` carries the shared toolkit — `box` `ball` `cyl` `torus`
`ground` `lights` `sky` `starfield` `glow` `mat`, the `Burst` particle pool,
`clamp` `lerp` `damp` `rand` `randInt` `pick` `shuffle` `seeded`, `overlaps`
`chase`, and the `PALETTE` / `COLORS` shared by every game so the arcade reads
as one product.

## Testing

`npm run smoke` boots every catalogued game with stubbed input, audio and HUD,
runs it for 20 simulated seconds of random-but-legal play, and fails on thrown
errors, NaN transforms or non-finite scores. It needs no browser or GPU, so it
stays fast as the catalogue grows. Pass a duration to run longer:

```bash
npm run smoke -- 60
```

`npm run check:voxels` runs extra assertions specific to Blockcraft — terrain
composition, that all 36 chunks mesh, that the player lands on solid ground,
and that mining a buried pocket exposes the cavity walls.

It does not exercise rendering — that is stock Three.js. Check visuals with
`npm run dev`.

## Conventions

- Desktop-first: mouse-driven games work on touch, keyboard-driven ones do not.
- No external assets. Every mesh is generated and every sound is synthesised,
  so the whole arcade is a single small bundle with no loading screens.
- Games must be readable in one sitting — roughly 100–200 lines each. Anything
  reusable belongs in `engine/utils.js`.
