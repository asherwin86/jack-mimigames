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
    // Blockcraft shows its own landing screen (world picker, multiplayer
    // connect/host, a Play button) instead of the generic one — see main.js.
    customStart: true,
    // Its start screen and pause screen are full of DOM buttons (worlds, servers): give a controller a cursor there.
    padCursor: true,
  },
  {
    id: 'fruit-slice', n: 22, name: 'Fruit Slice', tags: ['arcade', 'aim'],
    blurb: 'Fruit arcs up from below. Drag through it to slice — just mind the bombs.',
    controls: 'Hold and drag across the fruit', unit: 'pts',
  },
  {
    id: 'wrecking-ball', n: 23, name: 'Wrecking Ball', tags: ['physics', 'aim'],
    blurb: 'Swing a chained ball into a tower of blocks and knock it flat.',
    controls: 'Move the mouse to swing the ball', unit: 'pts',
  },
  {
    id: 'frog-hopper', n: 24, name: 'Frog Hopper', tags: ['arcade', 'timing'],
    blurb: 'Cross traffic and ride the river logs to reach the far bank. Repeat, faster.',
    controls: 'WASD or arrows to hop', unit: 'crossings',
  },
  {
    id: 'hurdle-runner', n: 25, name: 'Hurdle Runner', tags: ['runner', 'reflex'],
    blurb: 'A neon track with hurdles to clear and bars to duck. Speed keeps climbing.',
    controls: 'A / D to change lane · Space to jump · S to duck', unit: 'm',
  },
  {
    id: 'free-throw', n: 26, name: 'Free Throw', tags: ['sport', 'aim'],
    blurb: 'Charge your shot and sink baskets from wherever the spot lands next.',
    controls: 'Hold click to charge, release to shoot', unit: 'pts',
  },
  {
    id: 'plate-spinner', n: 27, name: 'Plate Spinner', tags: ['skill', 'reflex'],
    blurb: 'Keep every plate spinning. Click one before it wobbles too far and falls.',
    controls: 'Click a wobbling plate to save it', unit: 's',
  },
  {
    id: 'grapple-gap', n: 28, name: 'Grapple Gap', tags: ['platformer', 'skill'],
    blurb: 'Fire a grapple to the floating anchors and swing yourself across the chasm.',
    controls: 'Space or click near an anchor to grapple it · A / D to steer', unit: 'm',
  },
  {
    id: 'skeet-range', n: 29, name: 'Skeet Range', tags: ['aim', 'reflex'],
    blurb: 'Clay pairs launch across the sky. Click fast before they land.',
    controls: 'Click a target while it is airborne', unit: 'pts',
  },
  {
    id: 'arena-fighter', n: 30, name: 'Arena Fighter', tags: ['fighting', 'arcade'],
    blurb: 'A 3D one-on-one brawl. Land punches and kicks, block theirs, outlast the clock.',
    controls: 'WASD to move · click or J to punch · K to kick · hold Shift to block',
    unit: 'dmg',
  },
  {
    id: 'kart-circuit', n: 31, name: 'Kart Circuit', tags: ['racing', 'arcade'],
    blurb: 'A 3D arcade kart racer: drift for mini-turbos, grab items and coins, race rivals across 14 tracks and cups.',
    controls: 'Arrows / WASD, mouse, touch or gamepad · Shift to drift · Space uses an item · Esc for the menu',
    unit: 'laps',
    // It brings its own front end (mode, driver, cup, track, difficulty), so skip the generic start card — see main.js.
    customStart: true,
  },
  {
    id: 'memory-match', n: 32, name: 'Memory Match', tags: ['puzzle', 'memory'],
    blurb: 'Flip cards two at a time and match all eight pairs. Every wrong pair costs a second.',
    controls: 'Click a card to flip it', unit: 's', higherIsBetter: false,
  },
  {
    id: 'sliding-puzzle', n: 33, name: 'Sliding Puzzle', tags: ['puzzle'],
    blurb: 'Slide the numbered tiles into the gap until 1 to 8 are back in order.',
    controls: 'Click a tile next to the gap · or arrow keys', unit: 's', higherIsBetter: false,
  },
  {
    id: 'lights-out', n: 34, name: 'Lights Out', tags: ['puzzle', 'timing'],
    blurb: 'Pressing a light flips it and its neighbours. Turn every light off, then do it again, against the clock.',
    controls: 'Click a light', unit: 'puzzles',
  },
  {
    id: 'color-flood', n: 35, name: 'Colour Flood', tags: ['puzzle'],
    blurb: 'Flood the board from the corner one colour at a time. Fill it all before your moves run out.',
    controls: 'Click a colour button (or any square)', unit: 'pts',
  },
  {
    id: 'connect-four', n: 36, name: 'Connect Four', tags: ['puzzle', 'strategy'],
    blurb: 'Drop discs and connect four before the bot does. Each win makes the next bot sharper.',
    controls: 'Click a column to drop a disc', unit: 'wins',
  },
  {
    id: 'invader-grid', n: 37, name: 'Invader Grid', tags: ['shooter', 'arcade'],
    blurb: 'Rows of invaders march down the screen. Shoot them before they land, and watch for the bonus saucer.',
    controls: 'A / D or ← → to move · Space or click to fire', unit: 'pts',
  },
  {
    id: 'pac-cube', n: 38, name: 'Pac-Cube', tags: ['arcade', 'chase'],
    blurb: 'Eat every pellet in the maze while three ghosts hunt you. A big pellet turns the tables.',
    controls: 'WASD or arrows to steer', unit: 'pts',
  },
  {
    id: 'flappy-cube', n: 39, name: 'Flappy Cube', tags: ['reflex', 'skill'],
    blurb: 'Flap through the gaps between the pipes. One touch and it is over.',
    controls: 'Click, tap or Space to flap', unit: 'gaps',
  },
  {
    id: 'gravity-flip', n: 40, name: 'Gravity Flip', tags: ['reflex', 'runner'],
    blurb: 'Race down a corridor and flip between the floor and the ceiling to slip past the blocks.',
    controls: 'Space, click or tap to flip gravity', unit: 'm',
  },
  {
    id: 'catch-the-stars', n: 41, name: 'Catch the Stars', tags: ['reflex', 'arcade'],
    blurb: 'Slide a basket under falling stars. Gold is worth triple; bombs cost a life.',
    controls: 'Mouse or A / D to move the basket', unit: 'pts',
  },
  {
    id: 'tank-battle', n: 42, name: 'Tank Battle', tags: ['shooter', 'arcade'],
    blurb: 'Drive a tank around a walled arena and blow up waves of enemy tanks before they wreck you.',
    controls: 'WASD to drive · mouse or right stick to aim · click / Space to fire', unit: 'pts',
  },
  {
    id: 'horde-survivor', n: 43, name: 'Horde Survivor', tags: ['arcade', 'chase'],
    blurb: 'Endless swarms close in. You shoot on your own — collect gems to level up and survive as long as you can.',
    controls: 'WASD to move (you fire automatically)', unit: 'kills',
  },
  {
    id: 'rocket-lander', n: 44, name: 'Rocket Lander', tags: ['skill', 'physics'],
    blurb: 'Tilt and thrust a rocket down onto a small landing pad. Land slowly and upright, with fuel to spare.',
    controls: 'A / D to tilt · W, Space or hold click to thrust', unit: 'pts',
  },
  {
    id: 'slalom-ski', n: 45, name: 'Slalom Ski', tags: ['skill', 'runner'],
    blurb: 'Carve down the mountain through the gates. Every gate adds time; missing one or hitting a tree costs it.',
    controls: 'A / D or ← → to carve', unit: 'gates',
  },
  {
    id: 'air-hockey', n: 46, name: 'Air Hockey', tags: ['sport', 'reflex'],
    blurb: 'A fast table game against a bot that improves with every goal you score. Concede five and you are out.',
    controls: 'Move the mouse (or stick) to slide your mallet', unit: 'goals',
  },
  {
    id: 'tetra-drop', n: 47, name: 'Tetra Drop', tags: ['puzzle', 'arcade'],
    blurb: 'Falling blocks: turn and slot them into complete rows to clear them. The stack speeds up as you go.',
    controls: '← → move · ↑ rotate · ↓ soft drop · Space hard drop', unit: 'pts',
  },
  {
    id: 'merge-2048', n: 48, name: '2048 Merge', tags: ['puzzle'],
    blurb: 'Slide the whole board and merge equal tiles to build bigger numbers. Run out of moves and it is over.',
    controls: 'Arrows / WASD or swipe', unit: 'pts',
  },
  {
    id: 'parking-panic', n: 49, name: 'Parking Panic', tags: ['skill', 'racing'],
    blurb: 'Squeeze the car into the one free bay before time runs out. Every bump costs seconds; every park adds them.',
    controls: 'W / S throttle and reverse · A / D steer', unit: 'cars',
  },
  {
    id: 'battleship', n: 50, name: 'Battleship', tags: ['puzzle', 'strategy'],
    blurb: 'Five ships are hidden on an eight-by-eight sea. Sink the fleet in as few shots as you can.',
    controls: 'Click a square to fire', unit: 'shots', higherIsBetter: false,
  },
];

export const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
export const ALL_TAGS = [...new Set(CATALOG.flatMap((e) => e.tags))].sort();
