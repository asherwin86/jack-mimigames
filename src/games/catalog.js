/**
 * The catalogue. One entry per mini-game; `id` must match the module filename
 * in this folder (src/games/<id>.js), which is loaded on demand.
 *
 *   unit             suffix shown after the score ('pts', 'm', 's', …)
 *   higherIsBetter   false for time-attack games
 *   sandbox          true for open-ended games with no score
 *   tags             used by the menu filter chips
 */
export const TARGET = 100;

export const CATALOG = [
  {
    id: 'cube-dodger', n: 1, name: 'Cube Dodger', tags: ['reflex', 'runner'],
    blurb: 'Sprint down a neon corridor and weave through the oncoming traffic.',
    controls: 'A / D or ← → to steer · Shift to boost', unit: 'm',
  },
  {
    id: 'sky-hoops', n: 2, name: 'Sky Hoops', tags: ['flight', 'skill'],
    blurb: 'Fly a glider through floating rings before the clock runs out.',
    controls: 'Move the mouse to steer · rings add time', unit: 'rings',
  },
  {
    id: 'block-stacker', n: 3, name: 'Block Stacker', tags: ['timing', 'puzzle'],
    blurb: 'Drop sliding slabs on top of each other. Overhang gets sliced off.',
    controls: 'Click or Space to drop', unit: 'floors',
  },
  {
    id: 'whack-a-cube', n: 4, name: 'Whack-a-Cube', tags: ['aim', 'reflex'],
    blurb: 'Cubes pop out of the grid. Smash the lit ones, spare the red.',
    controls: 'Click the glowing cubes', unit: 'pts',
  },
  {
    id: 'marble-maze', n: 5, name: 'Marble Maze', tags: ['physics', 'skill'],
    blurb: 'Tilt the board to roll a marble to the goal without dropping it.',
    controls: 'WASD or arrows to tilt the board', unit: 's', higherIsBetter: false,
  },
  {
    id: 'asteroid-blaster', n: 6, name: 'Asteroid Blaster', tags: ['aim', 'shooter'],
    blurb: 'Rocks are inbound. Shoot them down before they reach your hull.',
    controls: 'Aim with the mouse · click to fire', unit: 'pts',
  },
  {
    id: 'simon-cubes', n: 7, name: 'Simon Cubes', tags: ['memory', 'puzzle'],
    blurb: 'Watch the pillars flash, then repeat the sequence back. It grows.',
    controls: 'Click the pillars in order', unit: 'rounds',
  },
  {
    id: 'paddle-rally', n: 8, name: 'Paddle Rally', tags: ['reflex', 'sport'],
    blurb: 'Three-dimensional squash against a wall that keeps speeding up.',
    controls: 'Move the mouse to position the paddle', unit: 'rally',
  },
  {
    id: 'platform-hop', n: 9, name: 'Platform Hop', tags: ['platformer', 'skill'],
    blurb: 'Hop up a tower of drifting platforms. Miss one and it is a long way down.',
    controls: 'WASD to move · Space to jump', unit: 'floors',
  },
  {
    id: 'gem-grab', n: 10, name: 'Gem Grab', tags: ['arcade', 'chase'],
    blurb: 'Collect gems in an arena while hunter drones close in on you.',
    controls: 'WASD or arrows to run · Space to dash', unit: 'gems',
  },
  {
    id: 'snake-cube', n: 11, name: 'Snake Cube', tags: ['arcade', 'puzzle'],
    blurb: 'Snake on a floating board. Every meal makes you longer and faster.',
    controls: 'Arrows or WASD to turn', unit: 'long',
  },
  {
    id: 'sumo-arena', n: 12, name: 'Sumo Arena', tags: ['physics', 'chase'],
    blurb: 'Shoulder-barge rival spheres off a shrinking disc before they do it to you.',
    controls: 'WASD to shove · Space to dash', unit: 'pushed',
  },
  {
    id: 'tunnel-run', n: 13, name: 'Tunnel Run', tags: ['reflex', 'flight'],
    blurb: 'Walls rush at you with one gap each. Line up and thread it.',
    controls: 'WASD or arrows to fly', unit: 'walls',
  },
  {
    id: 'beat-lanes', n: 14, name: 'Beat Lanes', tags: ['rhythm', 'timing'],
    blurb: 'Notes stream down four lanes. Hit them as they cross the pads.',
    controls: 'D F J K or the arrow keys', unit: 'pts',
  },
  {
    id: 'colour-rush', n: 15, name: 'Colour Rush', tags: ['reflex', 'memory'],
    blurb: 'Match the beacon before the timer runs out — unless it says invert.',
    controls: 'Click the matching pad', unit: 'pts',
  },
  {
    id: 'maze-escape', n: 16, name: 'Maze Escape', tags: ['puzzle', 'first-person'],
    blurb: 'A fresh maze every run, seen from the inside. Find the green exit.',
    controls: 'Click to lock the mouse · WASD to walk · Q / E to turn',
    unit: 's', higherIsBetter: false,
  },
  {
    id: 'brick-wall', n: 17, name: 'Brick Wall', tags: ['arcade', 'sport'],
    blurb: 'Breakout with a paddle you steer by feel. Clear every brick.',
    controls: 'Move the mouse to slide the paddle', unit: 'pts',
  },
  {
    id: 'lava-floor', n: 18, name: 'Lava Floor', tags: ['platformer', 'survival'],
    blurb: 'Every tile you touch crumbles, and the lava is coming up. Keep moving.',
    controls: 'WASD to run · Space to jump', unit: 's',
  },
  {
    id: 'orbit-dodge', n: 19, name: 'Orbit Dodge', tags: ['space', 'skill'],
    blurb: 'Climb and drop between orbits to slip past debris rings and grab stars.',
    controls: 'W / S or ↑ ↓ to change orbit', unit: 'stars',
  },
  {
    id: 'artillery-duel', n: 20, name: 'Artillery Duel', tags: ['aim', 'physics'],
    blurb: 'Twelve shells, distant towers, and a crosswind that never sits still.',
    controls: 'Mouse aims · hold click to charge, release to fire', unit: 'pts',
  },
  {
    id: 'blockcraft', n: 21, name: 'Blockcraft', tags: ['sandbox', 'first-person'],
    blurb: 'A voxel world to mine and build in: hills, caves of ore, water, trees.',
    controls: 'Click to lock · WASD + Space · left click mines, right click places · 1-9 picks a block · F to fly',
    unit: 'blocks', sandbox: true,
  },
];

export const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
export const ALL_TAGS = [...new Set(CATALOG.flatMap((e) => e.tags))].sort();
