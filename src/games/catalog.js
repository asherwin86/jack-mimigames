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
  {
    id: 'bubble-pop', n: 51, name: 'Bubble Pop', tags: ['aim', 'reflex'],
    blurb: 'Bubbles float up the screen. Pop as many as you can in 45 seconds; chain pops for a multiplier and avoid the black bombs.',
    controls: 'Click or tap the bubbles', unit: 'pts',
  },
  {
    id: 'dart-board', n: 52, name: 'Dart Board', tags: ['aim', 'sport'],
    blurb: 'Fifteen darts at the board with a wobbling sight. Time your throw for the bullseye.',
    controls: 'Move the mouse to aim · click to throw', unit: 'pts',
  },
  {
    id: 'reaction-test', n: 53, name: 'Reaction Test', tags: ['reflex'],
    blurb: 'Wait for the light to turn green, then click as fast as you can. Five rounds; jump the light and it costs you.',
    controls: 'Click (or Space) when it turns green', unit: 'ms', higherIsBetter: false,
  },
  {
    id: 'fishing-pond', n: 54, name: 'Fishing Pond', tags: ['skill', 'timing'],
    blurb: 'Cast into the pond, hook the bite, then reel in before the fish gets away. Bigger fish fight harder.',
    controls: 'Click the water to cast · click to hook and reel', unit: 'pts',
  },
  {
    id: 'crane-claw', n: 55, name: 'Crane Claw', tags: ['skill', 'arcade'],
    blurb: 'Steer the claw over the prizes, drop it, and carry your catch to the chute. Eight tries.',
    controls: 'WASD or stick to move · Space or click to drop', unit: 'pts',
  },
  {
    id: 'bowling-lane', n: 56, name: 'Bowling Lane', tags: ['sport', 'aim'],
    blurb: 'Five frames of ten-pin bowling. Pick your line, time the power bar and knock them all down.',
    controls: 'Mouse to aim · click to roll (middle of the power bar is straightest)', unit: 'pts',
  },
  {
    id: 'mini-golf', n: 57, name: 'Mini Golf', tags: ['sport', 'skill'],
    blurb: 'Three holes of crazy golf. Hold, pull back and let go to putt. Fewest strokes wins.',
    controls: 'Hold, pull back and release to putt', unit: 'strokes', higherIsBetter: false,
  },
  {
    id: 'archery-range', n: 58, name: 'Archery Range', tags: ['aim', 'sport'],
    blurb: 'Ten arrows at a distant target. Draw the bow, allow for drop and the wind, and aim for the gold.',
    controls: 'Mouse to aim · hold click to draw, release to shoot', unit: 'pts',
  },
  {
    id: 'skee-ball', n: 59, name: 'Skee-Ball', tags: ['aim', 'arcade'],
    blurb: 'Roll balls up the ramp and launch them into the scoring holes. Roll harder to fly further; the 100 is at the back.',
    controls: 'Mouse to aim · hold click to charge, release to roll', unit: 'pts',
  },
  {
    id: 'bubble-shooter', n: 60, name: 'Bubble Shooter', tags: ['puzzle', 'aim'],
    blurb: 'Fire bubbles up into the cluster. Match three or more to pop them, and anything left hanging falls too.',
    controls: 'Mouse to aim · click to fire', unit: 'pts',
  },
  {
    id: 'minesweeper', n: 61, name: 'Minesweeper', tags: ['puzzle', 'strategy'],
    blurb: 'The classic mine field. Dig safe tiles, read the numbers, flag the mines and clear the board as fast as you can.',
    controls: 'Click to dig · right-click or F to flag · click a number to clear around it', unit: 'pts',
  },
  {
    id: 'crate-push', n: 62, name: 'Crate Push', tags: ['puzzle', 'strategy'],
    blurb: 'Push every crate onto a goal. You can only push, never pull, so plan ahead. Seven warehouse levels.',
    controls: 'Arrows or WASD to move · Z to undo · R to restart the level', unit: 'pts',
  },
  {
    id: 'tower-of-hanoi', n: 63, name: 'Tower of Hanoi', tags: ['puzzle', 'strategy'],
    blurb: 'Move the whole stack of discs to the far tower, one at a time, never a big disc on a small one. Each round adds a disc.',
    controls: 'Click a tower to lift its top disc, click another to drop it', unit: 'pts',
  },
  {
    id: 'peg-solitaire', n: 64, name: 'Peg Solitaire', tags: ['puzzle', 'strategy'],
    blurb: 'Jump pegs over each other to capture them. Leave just one peg, ideally in the centre, and you have cracked it.',
    controls: 'Click a peg, then click the empty hole to jump into', unit: 'pts',
  },
  {
    id: 'knights-tour', n: 65, name: 'Knight\'s Tour', tags: ['puzzle', 'strategy'],
    blurb: 'Hop a chess knight around the board, landing on every square exactly once. Look ahead or get stuck.',
    controls: 'Click a square to start, then click where the knight jumps next', unit: 'squares',
  },
  {
    id: 'eight-queens', n: 66, name: 'Eight Queens', tags: ['puzzle', 'strategy'],
    blurb: 'Place queens so that none can capture another. The board grows from 5x5 up to the full eight queens.',
    controls: 'Click a square to place or remove a queen', unit: 'pts',
  },
  {
    id: 'water-sort', n: 67, name: 'Water Sort', tags: ['puzzle', 'skill'],
    blurb: 'Pour coloured liquid between tubes until every tube holds a single colour. More colours every level.',
    controls: 'Click a tube, then click where to pour (or press 1-9)', unit: 'pts',
  },
  {
    id: 'pipe-turn', n: 68, name: 'Pipe Turn', tags: ['puzzle', 'skill'],
    blurb: 'Turn the pipe pieces until every one is connected to the glowing source. The network grows with each level.',
    controls: 'Click a tile to turn it a quarter', unit: 'pts',
  },
  {
    id: 'gem-swap', n: 69, name: 'Gem Swap', tags: ['puzzle', 'arcade'],
    blurb: 'Swap neighbouring gems to line up three or more. Chain reactions score big and buy you extra seconds.',
    controls: 'Click a gem, then click a neighbour to swap', unit: 'pts',
  },
  {
    id: 'odd-cube', n: 70, name: 'Odd Cube', tags: ['skill', 'puzzle'],
    blurb: 'One tile is a slightly different shade. Spot it before the clock runs out. The board grows and the shades get closer.',
    controls: 'Click the odd tile out', unit: 'found',
  },
  {
    id: 'math-dash', n: 71, name: 'Math Dash', tags: ['skill', 'puzzle'],
    blurb: 'Sixty seconds of quick sums. Pick the right answer out of four; streaks score more and the sums get harder.',
    controls: 'Click an answer · 1-4 keys · A / B / X / Y on a controller', unit: 'pts',
  },
  {
    id: 'colour-clash', n: 72, name: 'Colour Clash', tags: ['skill', 'puzzle'],
    blurb: 'The word says one colour but is written in another. Pick the colour of the ink and ignore the word. Harder than it sounds.',
    controls: 'Click the matching colour · 1-4 keys · A / B / X / Y on a controller', unit: 'right',
  },
  {
    id: 'tic-tac-toe', n: 73, name: 'Tic-Tac-Toe', tags: ['strategy', 'puzzle'],
    blurb: 'Eight games of noughts and crosses against a bot that starts sloppy and finishes perfect. Win three points, draw one.',
    controls: 'Click a square', unit: 'pts',
  },
  {
    id: 'reversi', n: 74, name: 'Reversi', tags: ['strategy', 'puzzle'],
    blurb: 'Trap the white discs between your black ones to flip them. Most discs wins, and each win brings a sharper bot.',
    controls: 'Click a lit square to place a disc', unit: 'wins',
  },
  {
    id: 'five-in-a-row', n: 75, name: 'Five in a Row', tags: ['strategy', 'puzzle'],
    blurb: 'Gomoku: take turns placing stones on an 11x11 board and be first to line up five. The bot learns to block.',
    controls: 'Click a point to place a stone', unit: 'wins',
  },
  {
    id: 'mancala', n: 76, name: 'Mancala', tags: ['strategy', 'puzzle'],
    blurb: 'Sow seeds round the board, land in your store for another turn, and capture what sits opposite. Most seeds wins.',
    controls: 'Click one of your pits (front row)', unit: 'wins',
  },
  {
    id: 'dots-and-boxes', n: 77, name: 'Dots and Boxes', tags: ['strategy', 'puzzle'],
    blurb: 'Draw lines between dots and close the fourth side of a box to claim it and go again. Don\'t hand the bot a chain.',
    controls: 'Click the gap between two dots', unit: 'wins',
  },
  {
    id: 'blackjack', n: 78, name: 'Blackjack', tags: ['strategy', 'arcade'],
    blurb: 'Beat the dealer to 21 without going bust. Twenty hands, a pile of chips, and the choice to hit, stand or double.',
    controls: 'Click the buttons · 1-4 bets · H hit · S stand · D double', unit: 'chips',
  },
  {
    id: 'pig-dice', n: 79, name: 'Pig Dice', tags: ['strategy', 'arcade'],
    blurb: 'Push your luck: keep rolling to build your turn total, but a 1 wipes it out. First to 100 wins, then the bot gets greedier.',
    controls: 'R, A or click to roll · H, B or click HOLD to bank', unit: 'wins',
  },
  {
    id: 'slot-machine', n: 80, name: 'Slot Machine', tags: ['arcade', 'skill'],
    blurb: 'Twenty-five spins of the reels. Line up three for a jackpot, and hold your best reels for one respin per spin.',
    controls: 'Space or click SPIN · click reels to hold, then HOLD & RESPIN', unit: 'coins',
  },
  {
    id: 'star-fighter', n: 81, name: 'Star Fighter', tags: ['shooter', 'arcade'],
    blurb: 'A side-scrolling space shooter. Blast waves of drones, gunships and tanks, and grab spread-shot and rapid-fire drops.',
    controls: 'WASD or stick to fly · hold Space, click or A to fire', unit: 'pts',
  },
  {
    id: 'missile-defence', n: 82, name: 'Missile Defence', tags: ['shooter', 'aim'],
    blurb: 'Enemy missiles rain on your six cities. Click the sky to launch counter-missiles and blow them up before they land.',
    controls: 'Click (or A) to launch a counter-missile', unit: 'pts',
  },
  {
    id: 'turret-defence', n: 83, name: 'Turret Defence', tags: ['shooter', 'aim'],
    blurb: 'Hold the centre against waves of zombies. Aim, fire, reload, and keep them off your base as the waves get bigger.',
    controls: 'Mouse to aim · hold click or A to fire · R to reload', unit: 'pts',
  },
  {
    id: 'light-cycles', n: 84, name: 'Light Cycles', tags: ['arcade', 'chase'],
    blurb: 'Race a glowing cycle that leaves a wall behind it. Trap the rival cycles and don\'t touch a wall, a trail or a head-on crash.',
    controls: 'Arrows or WASD to point your cycle', unit: 'pts',
  },
  {
    id: 'ghost-hunt', n: 85, name: 'Ghost Hunt', tags: ['aim', 'shooter'],
    blurb: 'Hold your torch on the ghosts drifting out of the graveyard until they pop. Five getting through ends the night.',
    controls: 'Mouse to aim the torch · hold click or A to shine it', unit: 'pts',
  },
  {
    id: 'jetpack-run', n: 86, name: 'Jetpack Run', tags: ['runner', 'reflex'],
    blurb: 'Hold to fire your jetpack and rise, let go to drop. Weave through zappers and rockets and scoop up coins.',
    controls: 'Hold Space, click or A to rise', unit: 'm',
  },
  {
    id: 'sky-climb', n: 87, name: 'Sky Climb', tags: ['platformer', 'skill'],
    blurb: 'Bounce endlessly upward. Steer onto platforms, ride the springs, and don\'t trust the crumbly brown ones.',
    controls: 'A / D or the mouse to steer', unit: 'm',
  },
  {
    id: 'tightrope', n: 88, name: 'Tightrope', tags: ['skill', 'timing'],
    blurb: 'Cross a rope high above the clouds. Lean against every wobble and the gusts that try to push you off.',
    controls: 'A / D or the mouse to lean', unit: 'm',
  },
  {
    id: 'highway-rush', n: 89, name: 'Highway Rush', tags: ['racing', 'skill'],
    blurb: 'Weave through five lanes of traffic. Speed up, brake, and squeeze past cars for chained near-miss bonuses.',
    controls: 'A / D change lane · W faster · S brake', unit: 'pts',
  },
  {
    id: 'numbers-blast', n: 90, name: 'Numbers Blast', tags: ['shooter', 'arcade'],
    blurb: 'Blocks with numbers fall from above. Your cannon fires on its own; slide under them and pop each one before it lands.',
    controls: 'Mouse or A / D to slide the cannon', unit: 'pts',
  },
  {
    id: 'penalty-kicks', n: 91, name: 'Penalty Kicks', tags: ['sport', 'aim'],
    blurb: 'Ten penalties against a goalkeeper who learns to read you. Aim, time the power bar, and go for the top corners.',
    controls: 'Mouse to aim · click to start the power bar, click again to shoot', unit: 'pts',
  },
  {
    id: 'goalkeeper', n: 92, name: 'Goalkeeper', tags: ['sport', 'reflex'],
    blurb: 'Now you\'re in goal. Get your gloves to each shot before it crosses the line. Shots get faster and start to bend.',
    controls: 'Mouse to move your gloves · or WASD / stick', unit: 'pts',
  },
  {
    id: 'home-run-derby', n: 93, name: 'Home Run Derby', tags: ['sport', 'timing'],
    blurb: 'Ten pitches, fastballs, curves and changeups. Line the bat up with the ball, time the swing and send it over the fence.',
    controls: 'Mouse to position the bat · click to swing', unit: 'pts',
  },
  {
    id: 'curling', n: 94, name: 'Curling', tags: ['sport', 'skill'],
    blurb: 'Slide six stones down the ice towards the house. Set the aim and the power, sweep to carry them, and knock rivals out of the way.',
    controls: 'Mouse to aim · hold click to set power, release to throw · Space to sweep · C for curl', unit: 'pts',
  },
  {
    id: 'plinko', n: 95, name: 'Plinko', tags: ['arcade', 'skill'],
    blurb: 'Drop discs down a field of pegs and watch them bounce into the bins. The edge bins pay 50, but the middle is where they like to land.',
    controls: 'Mouse to choose where · click to drop', unit: 'pts',
  },
  {
    id: 'track-sprint', n: 96, name: 'Track Sprint', tags: ['sport', 'reflex'],
    blurb: 'A 100 metre dash against three rivals. Wait for the gun, then mash left and right as fast as you can. Four heats.',
    controls: 'Alternate A and D (or the arrow keys, or click) as fast as you can', unit: 'pts',
  },
  {
    id: 'keepie-uppie', n: 97, name: 'Keepie Uppie', tags: ['sport', 'skill'],
    blurb: 'Keep the ball in the air with your foot. Where you meet it decides where it goes, and gravity gets stronger the longer you last.',
    controls: 'Mouse to move your foot · click to kick', unit: 'touches',
  },
  {
    id: 'ski-jump', n: 98, name: 'Ski Jump', tags: ['sport', 'timing'],
    blurb: 'Race down the in-run, jump at the very edge, and steer your body angle for the longest glide. Three jumps, best distance wins.',
    controls: 'Space to jump and flare · W / S or the mouse to change body angle', unit: 'pts',
  },
  {
    id: 'pool-break', n: 99, name: 'Pool Break', tags: ['sport', 'aim'],
    blurb: 'Break the rack and pot ten balls in fourteen shots. Line up the ghost ball, pull back and let fly. Watch out for the scratch.',
    controls: 'Mouse to aim · hold click to pull back, release to shoot', unit: 'pts',
  },
  {
    id: 'slingshot-smash', n: 100, name: 'Slingshot Smash', tags: ['aim', 'physics'],
    blurb: 'Fling balls at wooden and stone towers and pop every green pig. Three levels, four shots each, bonus for shots to spare.',
    controls: 'Drag back and release to fire', unit: 'pts',
  },
];

export const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));
export const ALL_TAGS = [...new Set(CATALOG.flatMap((e) => e.tags))].sort();
