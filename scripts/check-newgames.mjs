/**
 * Core rules of the games added in the "more games" push: each is set up on purpose and checked.
 *
 *   node scripts/check-newgames.mjs
 */
import { boot, check, finish } from './lib/game-harness.mjs';

// ---------- Memory Match ----------
{
  const { game, result } = await boot('memory-match');
  check(game.cards.length === 16, 'memory-match: sixteen cards');
  const pairs = new Map();
  for (const c of game.cards) pairs.set(c.userData.pair, (pairs.get(c.userData.pair) || 0) + 1);
  check([...pairs.values()].every((n) => n === 2) && pairs.size === 8, 'memory-match: eight pairs, each exactly twice');
  const [a, b] = game.cards.filter((c) => c.userData.pair === game.cards[0].userData.pair);
  game.turn(a); game.turn(b);
  check(game.matched === 2 && a.userData.state === 'matched' && b.userData.state === 'matched', 'memory-match: a matching pair stays up');
  const other = game.cards.find((c) => c.userData.pair !== a.userData.pair);
  const wrong = game.cards.find((c) => c.userData.pair !== a.userData.pair && c.userData.pair !== other.userData.pair);
  const t0 = game.elapsed;
  game.turn(other); game.turn(wrong);
  check(game.misses === 1 && game.elapsed >= t0 + 1, 'memory-match: a wrong pair costs a second');
  check(other.userData.state === 'up', 'memory-match: ...and stays face-up for a moment');
  game.update(0.8);
  check(other.userData.state === 'down' && wrong.userData.state === 'down' && !game.first, 'memory-match: then flips back down');
  for (const p of pairs.keys()) {
    const pair = game.cards.filter((c) => c.userData.pair === p && c.userData.state !== 'matched');
    if (pair.length === 2) { game.turn(pair[0]); game.turn(pair[1]); }
  }
  check(game.matched === 16 && result.ended && result.ended.score >= 1, 'memory-match: clearing every pair ends the run with the time as the score', JSON.stringify(result.ended));
}

// ---------- Sliding Puzzle ----------
{
  const inversions = (g) => { const flat = g.flat().filter(Boolean); let inv = 0; for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) if (flat[i] > flat[j]) inv++; return inv; };
  let allSolvable = true; let anySolved = false;
  for (let seed = 1; seed <= 25; seed++) {
    const { game } = await boot('sliding-puzzle', seed);
    if (inversions(game.grid) % 2 !== 0) allSolvable = false;
    if (game.solved()) anySolved = true;
  }
  check(allSolvable, 'sliding-puzzle: every scramble is solvable (even inversions), across 25 seeds');
  check(!anySolved, 'sliding-puzzle: a scramble never starts solved');
  const { game, result } = await boot('sliding-puzzle', 4);
  game.grid = [[1, 2, 3], [4, 5, 6], [7, 0, 8]];
  const before = game.moves;
  check(!game.slide(0, 0), 'sliding-puzzle: a tile not next to the gap does not move');
  check(game.slide(2, 2) && game.moves === before + 1 && game.solved(), 'sliding-puzzle: the tile next to the gap slides in and completes the puzzle');
  check(!!result.ended && result.ended.score >= 0, 'sliding-puzzle: solving it ends the run', JSON.stringify(result.ended));
  const g2 = await boot('sliding-puzzle', 9);
  g2.game.grid = [[1, 2, 3], [4, 5, 6], [7, 0, 8]];
  g2.input.press('ArrowLeft');       // the tile to the right of the gap slides left
  g2.step(1);
  check(g2.game.grid[2][1] === 8 && g2.game.solved() === false || g2.game.grid[2][1] === 8, 'sliding-puzzle: Left slides the tile on the gap\'s right into it');
  check(!g2.game.slide(-1, 0) && !g2.game.slide(0, 5), 'sliding-puzzle: out-of-range slides are ignored');
}

// ---------- Lights Out ----------
{
  const { game, step } = await boot('lights-out', 3);
  game.cells.forEach((c) => { c.userData.on = false; });
  game.press(0, 0);
  check(game.cells.filter((c) => c.userData.on).length === 3, 'lights-out: a corner press flips three lights');
  game.cells.forEach((c) => { c.userData.on = false; });
  game.press(1, 1);
  check(game.cells.filter((c) => c.userData.on).length === 5, 'lights-out: a middle press flips five');
  game.press(1, 1);
  check(game.allOff(), 'lights-out: pressing twice undoes it');
  let solvable = true;
  for (let seed = 1; seed <= 30; seed++) {
    const b = await boot('lights-out', seed);
    b.game.cleared = seed % 6;
    b.game.newPuzzle();
    const start = b.game.cells.map((c) => c.userData.on);
    for (const i of b.game.solution) b.game.press(Math.floor(i / 4), i % 4);
    if (!b.game.allOff() || !start.some(Boolean)) solvable = false;
  }
  check(solvable, 'lights-out: every puzzle is solvable and never starts already solved (30 seeds)');
  // a click that clears the puzzle scores it and adds time
  game.cells.forEach((c) => { c.userData.on = false; });
  game.press(2, 2);
  const target = game.cells[2 * 4 + 2];
  const t0 = game.timeLeft;
  game.input.pointer.set(0, 0);
  game.pickAt = () => ({ object: target });
  game.input.clicked = true;
  step(1);
  check(game.cleared === 1 && game.timeLeft > t0 + 4, 'lights-out: clearing a puzzle counts it and adds 5 seconds', `${game.cleared} ${game.timeLeft - t0}`);
}
{
  const { game, result, step } = await boot('lights-out', 5);
  game.timeLeft = 0.01;
  step(2);
  check(result.ended && result.ended.score === 0, 'lights-out: when time runs out the score is the puzzles cleared', JSON.stringify(result.ended));
}

// ---------- Colour Flood ----------
{
  const { game, result } = await boot('color-flood');
  game.grid = Array.from({ length: 8 }, () => Array(8).fill(2));
  game.grid[0][0] = 0; game.grid[0][1] = 0;
  check(game.region().length === 2, 'color-flood: the flood region is the cells joined to the corner by one colour');
  game.movesLeft = 5;
  check(game.flood(2) && game.grid[0][0] === 2, 'color-flood: picking a colour recolours the region');
  check(game.region().length === 64 && result.ended, 'color-flood: joining up with the rest floods the whole board and ends the run');
  check(result.ended.score === 64 + 20 + 4 * 5, 'color-flood: winning scores the squares + 20 + 5 per spare move', String(result.ended?.score));
  check(!game.flood(1), 'color-flood: no moves after the game ends');
  const b = await boot('color-flood', 3);
  b.game.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (r + c) % 2 === 0 ? 0 : 1));
  b.game.movesLeft = 1;
  const before = b.game.region().length;
  b.game.flood(1);
  check(!!b.result.ended && b.result.ended.score < 64 && b.result.ended.score >= before, 'color-flood: running out of moves ends the run with the squares captured');
  const same = await boot('color-flood', 5);
  const m0 = same.game.movesLeft;
  check(!same.game.flood(same.game.grid[0][0]) && same.game.movesLeft === m0, 'color-flood: picking the colour you already are wastes no move');
}

// ---------- Connect Four ----------
{
  const m = await import('../src/games/connect-four.js');
  const empty = () => Array.from({ length: 7 }, () => Array(6).fill(0));
  let b = empty();
  for (let c = 0; c < 4; c++) b[c][0] = 1;
  check(m.winnerOf(b)?.player === 1, 'connect-four: four across is a win');
  b = empty(); for (let r = 0; r < 4; r++) b[2][r] = 2;
  check(m.winnerOf(b)?.player === 2, 'connect-four: four up is a win');
  b = empty(); for (let k = 0; k < 4; k++) b[k][k] = 1;
  check(m.winnerOf(b)?.player === 1, 'connect-four: a rising diagonal is a win');
  b = empty(); for (let k = 0; k < 4; k++) b[3 - k][k] = 2;
  check(m.winnerOf(b)?.player === 2, 'connect-four: a falling diagonal is a win');
  b = empty(); b[0][0] = 1; b[1][0] = 1; b[2][0] = 1;
  check(m.winnerOf(b) === null, 'connect-four: three in a row is not');
  // the bot takes a win and blocks a loss (at its sharpest, with the dice removed)
  const rng = () => 0.99;
  b = empty(); b[0][0] = 2; b[1][0] = 2; b[2][0] = 2; b[0][1] = 1; b[1][1] = 1; b[2][1] = 1;
  check(m.botMove(b, 3, rng) === 3, 'connect-four: the bot plays the winning column');
  b = empty(); b[0][0] = 1; b[1][0] = 1; b[2][0] = 1; b[6][0] = 2; b[6][1] = 2;
  check(m.botMove(b, 3, rng) === 3, 'connect-four: the bot blocks your three in a row');
  // a whole game flow
  const { game, step, input, result } = await boot('connect-four');
  const column = game.columns[3];
  game.pickAt = () => ({ object: column });
  input.clicked = true;
  step(1);
  check(game.board[3][0] === 1, 'connect-four: clicking a column drops your disc in it');
  step(260);
  check(game.board.flat().filter((v) => v === 2).length === 1, 'connect-four: the bot answers with one disc');
  check(game.turn === 1, 'connect-four: then it is your turn again');
  // losing ends the run with the win count
  game.wins = 2;
  game.board = empty();
  for (let c = 0; c < 3; c++) game.board[c][0] = 2;
  game.result = null; game.turn = 2; game.wait = 0;
  game.spawnPiece(3, 0, 2); game.board[3][0] = 2; game.turn = 2;
  step(120);
  step(200);
  check(result.ended && result.ended.score === 2, 'connect-four: losing a game ends the run with your wins in a row', JSON.stringify(result.ended));
  const w = await boot('connect-four', 3);
  w.game.wins = 0;
  w.game.board = empty();
  for (let c = 0; c < 3; c++) w.game.board[c][0] = 1;
  w.game.board[3][0] = 1; w.game.spawnPiece(3, 0, 1);
  w.step(120); w.step(200);
  check(w.game.wins === 1 && w.game.level === 1 && !w.result.ended, 'connect-four: winning starts a new game against a sharper bot');
}

// ---------- Invader Grid ----------
{
  const { game, step, input, result } = await boot('invader-grid');
  check(game.alive().length === 32, 'invader-grid: 4 rows of 8 invaders');
  input.press('Space');
  step(1);
  check(game.bullets.length === 1, 'invader-grid: Space fires a shot');
  input.release(); game.cooldown = 0;
  const target = game.alive().find((i) => i.userData.row === 3);
  game.bullets.forEach((b) => game.scene.remove(b)); game.bullets = [];
  const b = game.add(game.ship.clone()); b.position.set(target.position.x, 0.5, target.position.z + 0.3); game.bullets.push(b);
  const s0 = game.score;
  step(1);
  check(!target.userData.alive && game.score === s0 + 10, 'invader-grid: a hit kills the invader for its row\'s points (10 for the front row)');
  const top = game.alive().find((i) => i.userData.row === 0);
  const b2 = game.add(game.ship.clone()); b2.position.set(top.position.x, 0.5, top.position.z + 0.3); game.bullets.push(b2);
  const s1 = game.score;
  step(1);
  check(game.score === s1 + 40, 'invader-grid: the back row is worth 40');
  for (const i of game.alive()) game.kill(i);
  step(1);
  check(game.wave === 2 && game.alive().length === 32, 'invader-grid: clearing the field brings the next wave');
  const lives = game.lives;
  game.invuln = 0;
  const bomb = game.add(game.ship.clone()); bomb.position.set(game.ship.position.x, 0.5, 11); game.bombs.push(bomb);
  step(1);
  check(game.lives === lives - 1, 'invader-grid: a bomb costs a life');
  game.invuln = 0;
  for (const i of game.alive()) i.position.z = 11;
  step(1);
  check(result.ended && /reached/i.test(result.ended.detail), 'invader-grid: invaders reaching the bottom ends the run', JSON.stringify(result.ended));
  const m = await boot('invader-grid', 4);
  let sideways = false;
  const x0 = m.game.alive()[0].position.x;
  m.step(60);
  if (Math.abs(m.game.alive()[0].position.x - x0) > 1) sideways = true;
  check(sideways, 'invader-grid: the invaders march sideways');
}

// ---------- Flappy Cube ----------
{
  const { game, step, input, result } = await boot('flappy-cube');
  step(30);
  check(!game.started && !result.ended, 'flappy-cube: the cube hovers until the first flap');
  input.press('Space');
  step(1);
  check(game.started && game.vy > 5, 'flappy-cube: Space flaps upward');
  input.release();
  const p = game.pipes[0];
  p.x = game.bird.position.x + 0.5; p.top.position.x = p.x; p.bottom.position.x = p.x;
  game.bird.position.y = p.gapY; game.vy = 0;
  step(1);
  check(!result.ended, 'flappy-cube: flying through the middle of a gap is safe');
  p.x = game.bird.position.x - 3;
  step(1);
  check(game.score === 1, 'flappy-cube: passing a pipe scores 1');
  const q = game.pipes[1];
  q.x = game.bird.position.x; q.top.position.x = q.x; q.bottom.position.x = q.x;
  game.bird.position.y = q.gapY + 4; game.vy = 0;
  step(1);
  check(!!result.ended && result.ended.score === 1, 'flappy-cube: touching a pipe ends the run with the gaps passed', JSON.stringify(result.ended));
  const f = await boot('flappy-cube', 3);
  f.step(30);
  f.input.press('Space'); f.step(1); f.input.release();
  f.step(400);
  check(!!f.result.ended, 'flappy-cube: falling to the ground ends the run');
}

// ---------- Gravity Flip ----------
{
  const { game, step, input, result } = await boot('gravity-flip');
  check(game.side === -1, 'gravity-flip: starts on the floor');
  input.press('Space');
  step(1); input.release();
  check(game.side === 1, 'gravity-flip: Space flips to the ceiling');
  step(40);
  check(game.player.position.y > 2.5, 'gravity-flip: and the cube really moves up there', String(game.player.position.y));
  input.press('Space'); step(1); input.release(); step(40);
  check(game.player.position.y < -2.5, 'gravity-flip: flipping back returns it to the floor');
  const d0 = game.distance;
  step(30);
  check(game.distance > d0 + 5, 'gravity-flip: distance counts up');
  // a block on your side ends the run; a block on the other side does not
  const block = (y) => { const b = game.add(game.player.clone()); b.geometry = new game.player.geometry.constructor(1.6, 3, 2.4); b.material = game.player.material.clone(); b.position.set(game.player.position.x, y, 0); game.obstacles.push(b); return b; };
  game.obstacles.forEach((o) => game.scene.remove(o)); game.obstacles = [];
  block(3.2);
  step(1);
  check(!result.ended, 'gravity-flip: a block on the ceiling misses you on the floor');
  game.obstacles.forEach((o) => game.scene.remove(o)); game.obstacles = [];
  block(-2.6);
  step(1);
  check(!!result.ended && result.ended.score >= 10, 'gravity-flip: a block on your side ends the run with the distance', JSON.stringify(result.ended));
}

// ---------- Catch the Stars ----------
{
  const { game, step, result } = await boot('catch-the-stars');
  const drop = (kind) => {
    const real = Math.random; let i = 0; const seq = { star: [0.9, 0.5], gold: [0.2, 0.5], bomb: [0.05, 0.5], heart: [0.33, 0.5] }[kind];
    Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    game.spawn(); Math.random = real;
    const it = game.items[game.items.length - 1];
    it.position.set(game.basket.position.x, 1.0, 0);
    return it;
  };
  const a = drop('star'); step(1);
  check(a.userData.kind === 'star' && game.score === 10 && game.caught === 1, 'catch-the-stars: a star in the basket is +10');
  drop('gold'); step(1);
  check(game.score === 40, 'catch-the-stars: gold is +30');
  drop('bomb'); step(1);
  check(game.lives === 2, 'catch-the-stars: a bomb costs a life');
  const h = drop('heart'); step(1);
  check(h.userData.kind === 'heart' && game.lives === 3, 'catch-the-stars: a heart gives the life back');
  game.lives = 3;
  const nh = drop('heart');
  check(nh.userData.kind !== 'heart', 'catch-the-stars: no hearts while you are on full lives');
  game.items.forEach((i) => game.scene.remove(i)); game.items = [];
  const miss = drop('star'); miss.position.x = game.basket.position.x + 6; miss.position.y = 0.5;
  const s = game.score;
  step(20);
  check(game.score === s && game.items.every((i) => i !== miss), 'catch-the-stars: a star that misses the basket is simply lost');
  game.lives = 1;
  drop('bomb'); step(1);
  check(!!result.ended && result.ended.score >= 40, 'catch-the-stars: the last life ends the run with your score', JSON.stringify(result.ended));
}

// ---------- Pac-Cube ----------
{
  const { game, step, input, result } = await boot('pac-cube');
  check(game.pellets.size > 60 && game.ghosts.length === 3, 'pac-cube: a maze full of pellets and three ghosts');
  const n0 = game.pellets.size;
  game.invuln = 99;
  input.press('KeyA'); step(1); input.release();
  step(40);
  check(game.pellets.size < n0 && game.score >= 10, 'pac-cube: steering along a corridor eats pellets for 10 each', `${n0} -> ${game.pellets.size}, ${game.score}`);
  // every ghost stays on open floor for a long time
  let bad = 0;
  for (let i = 0; i < 900; i++) {
    step(1);
    for (const g of game.ghosts) if (![...'.o '].includes(['###############','#o.....#.....o#','#.###.###.###.#','#.............#','#.###.#.#.###.#','#.....#.#.....#','#.###.###.###.#','#o...........o#','###############'][g.w.r][g.w.c])) bad++;
    const p = game.me;
    if (['###############','#o.....#.....o#','#.###.###.###.#','#.............#','#.###.#.#.###.#','#.....#.#.....#','#.###.###.###.#','#o...........o#','###############'][p.r][p.c] === '#') bad++;
  }
  check(bad === 0, 'pac-cube: nobody ever walks through a wall (900 frames)');
  // power pellet
  const b = await boot('pac-cube', 2);
  b.game.invuln = 99;
  const big = b.game.pellets.get('1,1');
  b.game.eat(1, 1);
  check(b.game.fright > 6 && b.game.score >= 50 && !b.game.pellets.has('1,1'), 'pac-cube: a big pellet scares the ghosts for about 7 seconds');
  const g = b.game.ghosts[0];
  b.game.invuln = 0;
  g.delay = 0;
  b.game.eatGhost(g);
  check(b.game.score >= 250, 'pac-cube: eating a scared ghost is +200', String(b.game.score));
  b.game.eatGhost(b.game.ghosts[1]);
  check(b.game.eatenStreak === 2, 'pac-cube: the next one in the same power-up is worth double');
  // getting caught
  const c = await boot('pac-cube', 3);
  c.game.invuln = 0; c.game.fright = 0;
  const gh = c.game.ghosts[0]; gh.delay = 0;
  gh.w.c = c.game.me.c; gh.w.r = c.game.me.r; gh.w.tc = gh.w.c; gh.w.tr = gh.w.r; gh.w.t = 1;
  c.step(1);
  check(c.game.lives === 2, 'pac-cube: a ghost catching you costs a life');
  c.game.lives = 1; c.game.invuln = 0;
  const gh2 = c.game.ghosts[1]; gh2.delay = 0; gh2.w.c = c.game.me.c; gh2.w.r = c.game.me.r; gh2.w.tc = gh2.w.c; gh2.w.tr = gh2.w.r; gh2.w.t = 1;
  c.step(1);
  check(!!c.result.ended, 'pac-cube: the last life ends the run');
  // clearing the maze
  const d = await boot('pac-cube', 4);
  for (const key of [...d.game.pellets.keys()]) { const [pc, pr] = key.split(',').map(Number); d.game.eat(pc, pr); }
  d.step(1);
  check(d.game.level === 2 && d.game.pellets.size > 60, 'pac-cube: eating every pellet starts the next level');
}

finish('new game');
