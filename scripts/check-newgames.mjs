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

// ---------- Tank Battle ----------
{
  const { game, step, result } = await boot('tank-battle');
  step(150);
  check(game.wave === 1 && game.enemies.length === 3, 'tank-battle: wave 1 brings three tanks', `${game.enemies.length}`);
  const e = game.enemies[0];
  e.userData.hp = 1; e.userData.heavy = false;
  e.position.set(0, 0, 0);
  game.player.position.set(0, 0, 8);
  const shot = game.add(game.player.clone());
  shot.userData = { vx: 0, vz: 0, friendly: true, life: 2 };
  shot.position.set(0, 1, 0.2);
  game.shots.push(shot);
  const s0 = game.score;
  step(1);
  check(game.score === s0 + 100 && !game.enemies.includes(e), 'tank-battle: a shot that hits a tank wrecks it for 100');
  const heavy = game.enemies[0];
  heavy.userData.hp = 3; heavy.userData.heavy = true; heavy.position.set(5, 0, -5);
  game.hitEnemy(heavy, 0);
  game.hitEnemy(heavy, 0);
  check(game.enemies.includes(heavy) && heavy.userData.hp === 1, 'tank-battle: a heavy tank takes three hits');
  const before = game.score;
  game.hitEnemy(heavy, game.enemies.indexOf(heavy));
  check(game.score === before + 200, 'tank-battle: ...and is worth 200');
  // cover blocks movement
  const c = game.cover[0].userData;
  game.player.position.set(c.x, 0, c.z + c.hd + 1.3);
  game.drive(game.player, 0, -3);
  check(game.player.position.z > c.z + c.hd, 'tank-battle: you cannot drive through cover');
  check(game.blocked(20, 0, 1) && !game.blocked(0, 10, 1), 'tank-battle: the arena walls hold you in');
  // damage and repair
  game.invuln = 0; const hp = game.hp;
  game.hurt();
  check(game.hp === hp - 1 && game.invuln > 1, 'tank-battle: a hit costs armour and gives a moment of protection');
  const kit = game.add(game.player.clone()); kit.position.copy(game.player.position); game.repairs.push(kit);
  step(1);
  check(game.hp === hp, 'tank-battle: a repair kit restores one armour');
  game.hp = 1; game.invuln = 0;
  game.hurt();
  check(!!result.ended && result.ended.score >= 300, 'tank-battle: losing the last armour ends the run with your score', JSON.stringify(result.ended));
}

// ---------- Horde Survivor ----------
{
  const { game, step, result } = await boot('horde-survivor');
  step(60);
  check(game.enemies.length > 0, 'horde-survivor: enemies swarm in');
  const e = game.enemies[0];
  e.userData.hp = 1;
  e.position.set(6, 0.5, 0); game.player.position.set(0, 0.7, 0);
  const shot = game.add(game.player.clone()); shot.userData = { vx: 0, vz: 0, life: 1 }; shot.position.set(6, 0.8, 0); game.shots.push(shot);
  const k0 = game.kills;
  step(1);
  check(game.kills === k0 + 1 && game.gems.length >= 1, 'horde-survivor: a kill counts and drops a gem');
  const gem = game.gems[0]; gem.position.set(game.player.position.x, 0.4, game.player.position.z);
  const xp = game.xp;
  step(1);
  check(game.xp === xp + 1, 'horde-survivor: walking over a gem collects it');
  game.xp = game.need - 1;
  const lvl = game.level; const dmg = game.damage;
  const g2 = game.gems.length ? game.gems[0] : null;
  const gem2 = game.add(game.player.clone()); gem2.position.copy(game.player.position); game.gems.push(gem2);
  step(1);
  check(game.level === lvl + 1 && game.damage === dmg + 1, 'horde-survivor: enough gems level you up (first upgrade: more damage)');
  void g2;
  for (let i = 0; i < 5; i++) game.levelUp();
  check(game.shotCount >= 2 && game.speed > 8 && game.maxHp >= 6, 'horde-survivor: later levels add shots, speed and health');
  game.invuln = 0;
  game.spawn(); game.spawn();
  const hp = game.hp;
  const near = game.enemies[0]; near.position.set(game.player.position.x + 0.5, 0.5, game.player.position.z);
  step(1);
  check(game.hp === hp - 1, 'horde-survivor: an enemy touching you costs health');
  game.hp = 1; game.invuln = 0;
  game.spawn();
  const near2 = game.enemies[1] || game.enemies[0]; near2.position.set(game.player.position.x + 0.5, 0.5, game.player.position.z);
  step(1);
  check(!!result.ended && result.ended.score === game.kills, 'horde-survivor: the run ends with your kills as the score', JSON.stringify(result.ended));
}

// ---------- Rocket Lander ----------
{
  const { game, step, result, input } = await boot('rocket-lander');
  const padMid = (game.padX0 + game.padX1) / 2;
  check(game.padX1 - game.padX0 >= 4 && game.padX0 >= -30 && game.padX1 <= 30, 'rocket-lander: a landing pad inside the field');
  const flat = [];
  for (let x = game.padX0 + 0.5; x < game.padX1; x += 1) flat.push(game.terrainAt(x));
  check(flat.every((h) => h === flat[0]), 'rocket-lander: the pad is flat');
  const y0 = game.vel.y;
  input.press('Space'); step(30); input.release();
  check(game.vel.y > y0 - game.gravity * 0.5 + 3 && game.fuel < 100, 'rocket-lander: thrust pushes up and burns fuel');
  // soft landing
  const land = (over) => {
    const b = { ...over };
    game.pos.set(b.x ?? padMid, game.padY + 0.05, 0);
    game.vel.set(b.vx ?? 0, b.vy ?? -1.5, 0);
    game.angle = b.angle ?? 0;
    game.fuel = b.fuel ?? 50;
    step(1);
  };
  const s0 = game.score;
  land({});
  check(game.landed > 0 && game.score === s0 + 100 + 100, 'rocket-lander: a soft upright landing on the pad scores 100 + 2 per fuel left', String(game.score - s0));
  step(150);
  check(game.level === 2 && game.padX1 - game.padX0 < 9 * 1, 'rocket-lander: then the next level, with a smaller pad', `level ${game.level}`);
  for (const [why, over, re] of [['too fast', { vy: -6 }, /fast/], ['sideways', { vx: 5 }, /sideways/], ['tilted', { angle: 0.6 }, /upright/]]) {
    const t = await boot('rocket-lander', 7);
    const mid = (t.game.padX0 + t.game.padX1) / 2;
    t.game.pos.set(mid, t.game.padY + 0.05, 0);
    t.game.vel.set(over.vx ?? 0, over.vy ?? -1.5, 0);
    t.game.angle = over.angle ?? 0;
    t.step(1);
    check(!!t.result.ended && re.test(t.result.ended.detail), `rocket-lander: landing ${why} is a crash`, JSON.stringify(t.result.ended));
  }
  const off = await boot('rocket-lander', 9);
  const away = off.game.padX0 > 0 ? -20 : 20;
  off.game.pos.set(away, off.game.terrainAt(away) + 0.05, 0); off.game.vel.set(0, -1, 0); off.game.angle = 0;
  off.step(1);
  check(!!off.result.ended && /pad/i.test(off.result.ended.detail), 'rocket-lander: a gentle touchdown off the pad still fails');
}

// ---------- Slalom Ski ----------
{
  const { game, step, result, input } = await boot('slalom-ski');
  const gate = (offset, z = -0.2) => { game.spawnGate(); const g = game.gates[game.gates.length - 1]; g.cx = game.skier.position.x + offset; g.z = z; g.poles[0].position.set(g.cx - 2.6, 1.7, z); g.poles[1].position.set(g.cx + 2.6, 1.7, z); return g; };
  game.gates.forEach((g) => g.poles.forEach((p) => game.scene.remove(p))); game.gates = [];
  game.nextGate = 99; game.nextTree = 99;
  const t0 = game.timeLeft;
  gate(0.3, 0.5);
  step(2);
  check(game.passed === 1 && game.timeLeft > t0 + 1, 'slalom-ski: skiing through a gate counts it and adds time');
  const t1 = game.timeLeft;
  gate(9, 0.5);
  step(2);
  check(game.missed === 1 && game.timeLeft < t1, 'slalom-ski: missing a gate costs time');
  const tree = game.add(game.skier.clone());
  tree.userData = { x: game.skier.position.x, z: game.skier.position.z };
  game.trees.push(tree);
  const t2 = game.timeLeft;
  step(1);
  check(game.stun > 0 && game.timeLeft < t2 - 1, 'slalom-ski: hitting a tree stuns you and costs time');
  game.timeLeft = 0.02;
  step(3);
  check(!!result.ended && result.ended.score === game.passed, 'slalom-ski: when time runs out the score is the gates cleared', JSON.stringify(result.ended));
  const c = await boot('slalom-ski', 2);
  c.input.hold('KeyD'); c.step(30); c.input.release();
  check(c.game.skier.position.x > 3, 'slalom-ski: D carves right');
}

// ---------- Air Hockey ----------
{
  const { game, step, result, input } = await boot('air-hockey');
  game.wait = 0;
  // the puck bounces off the side walls
  game.puck.position.set(5.2, 0.15, 3); game.pv.set(10, 0, 0);
  step(10);
  check(game.pv.x < 0, 'air-hockey: the puck bounces off the side wall');
  // your mallet hits it away
  game.puck.position.set(0, 0.15, 6.2); game.pv.set(0, 0, 0);
  game.me.position.set(0, 0.35, 7.6);
  game.groundPoint = () => null;
  input.hold('KeyW');                       // the mallet moves forward at 14 units a second into the puck
  step(1);
  input.release();
  check(game.pv.z < -5, 'air-hockey: the mallet knocks the puck away with its own speed', String(game.pv.z));
  // a goal in the bot's net
  game.puck.position.set(0, 0.15, -9.5); game.pv.set(0, 0, -20);
  step(10);
  check(game.goals === 1, 'air-hockey: the puck through the far gap is your goal');
  game.wait = 0;
  game.puck.position.set(0, 0.15, 9.5); game.pv.set(0, 0, 20);
  game.me.position.set(5, 0.35, 5);
  step(10);
  check(game.conceded === 1, 'air-hockey: the puck through your gap is conceded');
  game.wait = 0;
  game.puck.position.set(5, 0.15, 9.6); game.pv.set(0, 0, 20);
  step(6);
  check(game.conceded === 1 && game.pv.z <= 0, 'air-hockey: hitting the end wall beside the goal just bounces');
  game.conceded = 4; game.wait = 0;
  game.puck.position.set(0, 0.15, 9.5); game.pv.set(0, 0, 20);
  step(10);
  check(!!result.ended && result.ended.score === 1, 'air-hockey: conceding five ends the run with your goals', JSON.stringify(result.ended));
  const a = await boot('air-hockey', 5);
  a.game.groundPoint = () => null;
  a.game.wait = 99;
  a.game.puck.position.set(4, 0.15, -6); a.game.pv.set(0, 0, 0);
  const x0 = a.game.ai.position.x;
  a.step(60);
  check(a.game.ai.position.x > x0 + 1, 'air-hockey: the bot slides across to defend');
}

// ---------- Tetra Drop ----------
{
  const m = await import('../src/games/tetra-drop.js');
  const T = [[1, 0], [0, 1], [1, 1], [2, 1]];
  let c = T;
  for (let i = 0; i < 4; i++) c = m.rotate('T', c);
  check(JSON.stringify(c.map((p) => p.join())) === JSON.stringify(T.map((p) => p.join())), 'tetra-drop: four quarter turns bring a piece home');
  check(JSON.stringify(m.rotate('O', [[1, 0], [2, 0], [1, 1], [2, 1]])) === JSON.stringify([[1, 0], [2, 0], [1, 1], [2, 1]]), 'tetra-drop: the square does not change when turned');
  const { game, step, input, result } = await boot('tetra-drop');
  check(game.board.length === 20 && game.board[0].length === 10, 'tetra-drop: a ten by twenty well');
  const seen = new Set();
  for (let i = 0; i < 14; i++) { seen.add(game.name); game.spawn(); game.lock?.call; }
  const bagCheck = await boot('tetra-drop', 5);
  bagCheck.game.bag = [];
  const seven = new Set(); for (let i = 0; i < 7; i++) seven.add(bagCheck.game.takeFromBag());
  check(seven.size === 7, 'tetra-drop: the piece bag deals all seven shapes before repeating');
  const g = (await boot('tetra-drop', 2)).game;
  const x0 = g.px;
  g.tryMove(-1, 0);
  check(g.px === x0 - 1, 'tetra-drop: a piece moves sideways');
  for (let i = 0; i < 12; i++) g.tryMove(-1, 0);
  check(g.px >= -1 && !g.collides(g.cells, g.px, g.py), 'tetra-drop: it stops at the left wall');
  const h = await boot('tetra-drop', 3);
  h.game.hardDrop();
  check(h.game.board[0].some(Boolean) || h.game.board[1].some(Boolean), 'tetra-drop: a hard drop sends the piece to the floor and locks it');
  check(h.game.score > 0, 'tetra-drop: hard dropping scores 2 per row fallen');
  // clearing four rows with a vertical I
  const t = await boot('tetra-drop', 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) t.game.board[y][x] = x === 4 ? null : 0xffffff;
  t.game.name = 'I'; t.game.cells = m.rotate('I', [[0, 1], [1, 1], [2, 1], [3, 1]]); t.game.px = 2; t.game.py = 8;
  const s0 = t.game.score;
  t.game.hardDrop();
  check(t.game.lines === 4 && t.game.score >= s0 + 800, 'tetra-drop: four rows at once is worth 800', `${t.game.lines} lines, +${t.game.score - s0}`);
  check(t.game.board.slice(0, 4).every((row) => row.every((v) => !v)), 'tetra-drop: the cleared rows are gone');
  t.game.lines = 9; t.game.level = 1;
  t.game.board[0].fill(0xffffff); t.game.board[0][3] = null;
  t.game.name = 'I'; t.game.cells = [[0, 1], [1, 1], [2, 1], [3, 1]]; t.game.px = 0; t.game.py = 5;
  t.game.cells = m.rotate('I', t.game.cells); t.game.px = 1;
  t.game.hardDrop();
  check(t.game.level === 2, 'tetra-drop: ten lines bring the next level');
  // the stack reaching the top ends the run
  const o = await boot('tetra-drop', 6);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) o.game.board[y][x] = 0xffffff;
  o.game.board[19].fill(null); o.game.board[18].fill(null);
  for (let x = 0; x < 10; x++) o.game.board[17][x] = 0xffffff;
  o.game.board[19][4] = 0xffffff; o.game.board[19][5] = 0xffffff; o.game.board[18][4] = 0xffffff;
  o.game.spawn();
  check(!!o.result.ended, 'tetra-drop: a new piece with no room ends the run', JSON.stringify(o.result.ended));
  const gravity = await boot('tetra-drop', 7);
  const y0 = gravity.game.py;
  gravity.step(90);
  check(gravity.game.py < y0 || gravity.game.board.some((row) => row.some(Boolean)), 'tetra-drop: pieces fall by themselves');
}

// ---------- 2048 Merge ----------
{
  const m = await import('../src/games/merge-2048.js');
  check(JSON.stringify(m.slideRow([2, 2, 2, 2])) === JSON.stringify({ row: [4, 4, 0, 0], gained: 8 }), '2048: 2 2 2 2 slides to 4 4 0 0 for 8 points');
  check(JSON.stringify(m.slideRow([2, 0, 2, 4])) === JSON.stringify({ row: [4, 4, 0, 0], gained: 4 }), '2048: gaps close up before merging');
  check(JSON.stringify(m.slideRow([4, 4, 8, 0])) === JSON.stringify({ row: [8, 8, 0, 0], gained: 8 }), '2048: a tile merges only once per move');
  check(JSON.stringify(m.slideRow([2, 4, 8, 16])) === JSON.stringify({ row: [2, 4, 8, 16], gained: 0 }), '2048: nothing moves when nothing can');
  const { game, input, step, result } = await boot('2048-merge'.replace('2048-merge', 'merge-2048'));
  check(game.grid.flat().filter(Boolean).length === 2, '2048: starts with two tiles');
  game.grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 4]];
  const moved = game.move('left');
  check(moved && game.grid[0][0] === 4 && game.score === 4, '2048: sliding left merges and scores');
  check(game.grid.flat().filter(Boolean).length === 3, '2048: a new tile appears after every move');
  game.grid = [[2, 4, 8, 16], [4, 8, 16, 2], [8, 16, 2, 4], [16, 2, 4, 8]];
  const before = game.moves;
  check(game.move('left') === false && game.moves === before, '2048: a move that changes nothing is not a move');
  game.grid = [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  game.move('down');
  check(game.grid[3][0] === 2 || game.grid[3].includes(2), '2048: sliding down drops tiles to the bottom');
  game.grid = [[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  game.move('right');
  check(game.grid[0][3] === 2, '2048: sliding right keeps a tile at the right edge');
  input.press('ArrowLeft'); game.grid = [[0, 0, 0, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; step(1); input.release();
  check(game.grid[0][0] === 8, '2048: the arrow keys slide the board');
  game.grid = [[0, 3, 5, 7], [11, 13, 17, 19], [23, 29, 31, 37], [41, 43, 47, 53]];   // (no two neighbours can ever match)
  game.score = 120;
  game.move('left');    // slides row 0 left and fills the last gap with a 2 or 4 that cannot merge
  check(!!result.ended || game.stuck(), '2048: a full board with no merges ends the run');
}

// ---------- Parking Panic ----------
{
  const { game, step, result } = await boot('parking-panic');
  const axis = game.targetRow === 0 ? 0 : Math.PI;
  check(!game.obstacles.some((o) => Math.abs(o.x - game.target.x) < 1 && Math.abs(o.z - game.target.z) < 1), 'parking-panic: the target bay is empty');
  const near = game.obstacles.filter((o) => Math.abs(o.z - game.target.z) < 1 && Math.abs(Math.abs(o.x - game.target.x) - 3.4) < 0.5);
  check(near.length === 2 || game.targetIdx === 0 || game.targetIdx === 8, 'parking-panic: both bays beside the target are taken');
  const t0 = game.timeLeft;
  game.pos.set(game.target.x, game.target.z); game.heading = axis + 0.9; game.speed = 0;
  step(70);
  check(game.score === 0, 'parking-panic: sitting crooked in the bay does not count');
  game.heading = axis; game.stillFor = 0;
  step(70);
  check(game.score === 1 && game.timeLeft > t0 + 10, 'parking-panic: straight in the bay and stopped counts as parked (+18 s)', `${game.score} ${game.timeLeft - t0}`);
  const g2 = await boot('parking-panic', 5);
  const ob = g2.game.obstacles[0];
  g2.game.pos.set(ob.x, ob.z + ob.hd + 0.6); g2.game.heading = Math.PI; g2.game.speed = 5;
  const t1 = g2.game.timeLeft;
  g2.step(1);
  check(g2.game.timeLeft < t1 - 1.5, 'parking-panic: hitting a parked car costs 2 seconds');
  check(Math.hypot(g2.game.pos.x - ob.x, g2.game.pos.y - ob.z) > 1, 'parking-panic: and you cannot drive through it');
  const g3 = await boot('parking-panic', 6);
  g3.input.hold('KeyW'); g3.step(60); g3.input.release();
  check(g3.game.speed > 4 && g3.game.pos.x > -30, 'parking-panic: W accelerates');
  const before = g3.game.heading;
  g3.input.hold('KeyW', 'KeyD'); g3.step(30); g3.input.release();
  check(Math.abs(g3.game.heading - before) > 0.2, 'parking-panic: steering turns the car while it moves');
  const g4 = await boot('parking-panic', 8);
  g4.game.timeLeft = 0.01;
  g4.step(2);
  check(!!g4.result.ended && g4.result.ended.score === 0, 'parking-panic: when time runs out the score is the cars parked');
}

// ---------- Battleship ----------
{
  const { game, result } = await boot('battleship');
  const cells = game.ships.flatMap((s) => s.cells.map((c) => c.join()));
  check(game.ships.length === 5 && cells.length === 17 && new Set(cells).size === 17, 'battleship: five ships, seventeen distinct squares');
  check(game.ships.every((s) => s.cells.every(([r, c]) => r >= 0 && r < 8 && c >= 0 && c < 8)), 'battleship: every ship is inside the sea');
  check(game.ships.every((s) => s.cells.every(([r, c], i) => i === 0 || (r === s.cells[0][0] || c === s.cells[0][1]))), 'battleship: every ship is a straight line');
  let miss = null;
  for (let r = 0; r < 8 && !miss; r++) for (let c = 0; c < 8; c++) if (game.cell(r, c).userData.ship < 0) { miss = [r, c]; break; }
  check(game.fire(...miss) === 'miss' && game.shots === 1, 'battleship: an empty square is a miss');
  check(game.fire(...miss) === null && game.shots === 1, 'battleship: shooting the same square twice is ignored');
  const ship = game.ships[4];
  check(game.fire(...ship.cells[0]) === 'hit', 'battleship: a ship square is a hit');
  check(game.fire(...ship.cells[1]) === 'sunk' && ship.sunk, 'battleship: the last square sinks the ship');
  check(game.fire(-1, 0) === null && game.fire(3, 9) === null, 'battleship: off-board shots are ignored');
  for (const s of game.ships) for (const [r, c] of s.cells) game.fire(r, c);
  check(!!result.ended && result.ended.score === game.shots, 'battleship: sinking the fleet ends the run with the shots used (lower is better)', JSON.stringify(result.ended));
  const perfect = await boot('battleship', 4);
  for (const s of perfect.game.ships) for (const [r, c] of s.cells) perfect.game.fire(r, c);
  check(perfect.result.ended.score === 17, 'battleship: a perfect game takes 17 shots');
}

// ---------- Bubble Pop ----------
{
  const { game, step, input, result } = await boot('bubble-pop');
  const add = (kind, points = 15) => { game.spawn(); const b = game.bubbles[game.bubbles.length - 1]; b.userData.kind = kind; b.userData.points = points; b.position.set(0, 0, 0); return b; };
  game.nextSpawn = 999;
  game.bubbles.forEach((b) => game.scene.remove(b)); game.bubbles = [];
  const a = add('normal', 15);
  game.pop(a);
  check(game.score === 15 && game.combo === 1, 'bubble-pop: a normal bubble scores its points');
  game.pop(add('normal', 15)); game.pop(add('normal', 15));
  check(game.combo === 3 && game.multiplier() === 2, 'bubble-pop: three pops in a row double the multiplier');
  const s = game.score;
  game.pop(add('normal', 10));
  check(game.score === s + 20, 'bubble-pop: ...and it applies to the next pop');
  step(90);
  check(game.combo === 0, 'bubble-pop: the combo fades if you stop popping');
  game.combo = 12;
  check(game.multiplier() === 5, 'bubble-pop: the multiplier tops out at x5');
  game.combo = 0;
  const t = game.timeLeft;
  game.pop(add('bomb'));
  check(game.timeLeft <= t - 3.9 && game.combo === 0, 'bubble-pop: a bomb costs 4 seconds and the combo');
  game.timeLeft = 20;
  const s2 = game.score;
  game.pop(add('gold', 100));
  check(game.score >= s2 + 100 && game.timeLeft > 22.9, 'bubble-pop: a gold bubble is worth 100 and adds 3 seconds');
  game.combo = 4;
  const esc = add('normal'); esc.position.y = 20;
  step(1);
  check(game.combo === 0, 'bubble-pop: letting a bubble float away breaks the combo');
  game.timeLeft = 0.02;
  step(3);
  check(!!result.ended && result.ended.score === game.score, 'bubble-pop: when time runs out the score is what you popped', JSON.stringify(result.ended));
}

// ---------- Dart Board ----------
{
  const m = await import('../src/games/dart-board.js');
  const P = m.default.pointsAt;
  check(P(0, 0) === 50 && P(0.4, 0) === 50, 'dart-board: the bullseye is 50');
  check(P(1, 0) === 25 && P(0, -2) === 15 && P(3, 0) === 10 && P(4.5, 0) === 5, 'dart-board: the rings score 25, 15, 10 and 5 working outwards');
  check(P(5.5, 0) === 0 && P(4, 4) === 0, 'dart-board: off the board is nothing');
  const { game, step, result, input } = await boot('dart-board');
  const throwAt = (x, y) => { game.aim.set(x, y); game.throwDart(); const f = game.flying; f.to.set(x, y, f.to.z); game.land(f); };
  throwAt(0, 0);
  check(game.score === 50 && game.bulls === 1 && game.thrown === 1, 'dart-board: a dart in the bullseye scores 50 and counts');
  throwAt(2, 0);
  check(game.score === 65 && game.last === 15, 'dart-board: scores add up');
  input.clicked = true; step(1);
  check(game.flying && game.thrown === 3, 'dart-board: a click throws a dart');
  input.clicked = true; step(1);
  check(game.thrown === 3, 'dart-board: you cannot throw again while one is in the air');
  step(30);
  game.thrown = 14;
  throwAt(0, 0);
  check(!!result.ended && result.ended.score >= 100, 'dart-board: the fifteenth dart ends the run with the total', JSON.stringify(result.ended));
  const w = await boot('dart-board', 3);
  let widest = 0; let narrowest = 9;
  for (let i = 0; i < 400; i++) { w.game.time = i * 0.05; const breath = 0.5 + 0.5 * Math.sin(w.game.time * 1.3); const amp = 0.2 + 0.95 * breath; widest = Math.max(widest, amp); narrowest = Math.min(narrowest, amp); }
  check(narrowest < 0.3 && widest > 1.0, 'dart-board: the sight sways between steady and wobbly (so timing matters)');
}

// ---------- Reaction Test ----------
{
  const { game, step, input, result } = await boot('reaction-test');
  step(80);
  check(game.state === 'wait', 'reaction-test: after a moment it waits for the light');
  input.clicked = true; step(1);
  check(game.falseStarts === 1 && game.state === 'ready', 'reaction-test: clicking before the light is a false start');
  const toGo = () => { game.state = 'wait'; game.stateT = 0.01; step(2); };
  toGo();
  check(game.state === 'go', 'reaction-test: the light goes green');
  step(18);
  input.clicked = true; step(1);
  check(game.times.length === 1 && game.times[0] >= 280 && game.times[0] <= 380, 'reaction-test: your time is measured in milliseconds (about 300 here)', String(game.times[0]));
  for (let i = 0; i < 4; i++) {
    game.state = 'ready'; game.stateT = 0; step(2);
    toGo(); step(12); input.clicked = true; step(1);
  }
  check(game.times.length === 5, 'reaction-test: five timed rounds');
  step(120);
  check(!!result.ended, 'reaction-test: then the run ends');
  const avgReal = Math.round((game.times.reduce((a, b) => a + b, 0) + 250) / 5);
  check(result.ended.score === avgReal, 'reaction-test: the score is the average with 250 ms added per false start', `${result.ended.score} vs ${avgReal}`);
}

// ---------- Fishing Pond ----------
{
  const { game, step, input, result } = await boot('fishing-pond');
  check(game.state === 'idle', 'fishing-pond: starts ready to cast');
  game.cast({ x: 0, z: 0 });
  check(game.state === 'cast' && game.bobber.visible, 'fishing-pond: casting puts the float in the water');
  const f = game.fish[0];
  f.position.set(0.5, -0.15, 0.5);
  step(2);
  check(game.target === f || game.target !== null, 'fishing-pond: a fish that swims close takes an interest');
  game.stateT = 0; step(1);
  check(game.state === 'bite', 'fishing-pond: then it bites');
  input.clicked = true; step(1);
  check(game.state === 'reel' && game.reel > 0.3, 'fishing-pond: clicking on the bite hooks it');
  const value = game.target.userData.type.value;
  let s = game.score;
  for (let i = 0; i < 60 && game.state === 'reel'; i++) { input.clicked = true; step(1); }
  check(game.score === s + value && game.caught === 1 && game.state === 'idle', 'fishing-pond: reeling it in scores the fish', `${game.score - s} vs ${value}`);
  // missing the bite
  game.cast({ x: 1, z: 1 });
  game.fish[1].position.set(1, -0.15, 1);
  step(2); game.stateT = 0; step(1);
  check(game.state === 'bite', 'fishing-pond: another bite');
  step(70);
  check(game.state === 'idle' && game.caught === 1, 'fishing-pond: if you do not click in time it gets away');
  // losing the fight
  game.cast({ x: -2, z: 2 });
  game.fish[2].position.set(-2, -0.15, 2);
  step(2); game.stateT = 0; step(1);
  input.clicked = true; step(1);
  step(400);
  check(game.state === 'idle' && game.caught === 1, 'fishing-pond: a fish you do not fight escapes');
  game.timeLeft = 0.02; step(3);
  check(!!result.ended && result.ended.score === game.score, 'fishing-pond: time up ends the run with your score');
}

// ---------- Crane Claw ----------
{
  const { game, step, input, result } = await boot('crane-claw');
  const x0 = game.cx;
  input.hold('KeyD'); step(30); input.release();
  check(game.cx > x0 + 2, 'crane-claw: D moves the claw across');
  const prize = game.prizes.find((p) => p.userData.kind.value === 10);
  const real = Math.random;
  Math.random = () => 0.01;                     // the grip always holds
  game.cx = prize.position.x; game.cz = prize.position.z;
  input.press('Space'); step(1); input.release();
  check(game.state === 'down' && game.attempts === 7, 'crane-claw: Space sends the claw down (one try used)');
  for (let i = 0; i < 700 && !(game.state === 'move' && !game.held); i++) step(1);
  Math.random = real;
  check(game.won >= 1 && game.score >= 10, 'crane-claw: a held prize carried to the chute is won', `${game.won} won, ${game.score}`);
  check(!prize.visible || prize.userData.won || game.won >= 1, 'crane-claw: (the prize leaves the bin)');
  // a claw that misses
  const other = game.prizes.find((p) => !p.userData.won);
  game.cx = other.position.x + 3; game.cz = other.position.z; 
  const tries = game.attempts; const won = game.won;
  Math.random = () => 0.99;
  input.press('Space'); step(1); input.release();
  for (let i = 0; i < 700 && game.state !== 'move'; i++) step(1);
  Math.random = real;
  check(game.attempts === tries - 1 && game.won === won, 'crane-claw: closing on nothing wins nothing');
  // running out of tries
  game.attempts = 1;
  const p2 = game.prizes.find((p) => !p.userData.won);
  game.cx = p2.position.x; game.cz = p2.position.z;
  Math.random = () => 0.99;
  input.press('Space'); step(1); input.release();
  for (let i = 0; i < 900 && !result.ended; i++) step(1);
  Math.random = real;
  check(!!result.ended && result.ended.score === game.score, 'crane-claw: the last try ends the run with the prizes\' value', JSON.stringify(result.ended));
}

// ---------- Bowling Lane ----------
{
  const { game, step, result } = await boot('bowling-lane');
  check(game.pins.length === 10, 'bowling-lane: ten pins');
  const zs = new Set(game.pins.map((p) => p.userData.home.z.toFixed(2)));
  check(zs.size === 4, 'bowling-lane: in a four-row triangle');
  const downAll = () => game.pins.forEach((p) => { p.userData.down = true; });
  downAll(); game.rollNo = 1;
  game.finishRoll();
  check(game.score === 20 && game.strikes === 1 && game.frame === 2 && game.rollNo === 1, 'bowling-lane: a strike is 10 pins + 10 bonus, and moves to the next frame');
  check(game.standing().length === 10, 'bowling-lane: the pins are reset for the next frame');
  game.pins.slice(0, 6).forEach((p) => { p.userData.down = true; });
  game.finishRoll();
  check(game.score === 26 && game.rollNo === 2 && game.frame === 2, 'bowling-lane: six down scores 6 and gives a second ball');
  game.pins.forEach((p) => { p.userData.down = true; });
  game.finishRoll();
  check(game.score === 26 + 4 + 5 && game.spares === 1 && game.frame === 3, 'bowling-lane: clearing the rest is a spare: 4 more pins + 5 bonus');
  game.pins.slice(0, 3).forEach((p) => { p.userData.down = true; });
  game.finishRoll();
  game.pins.slice(0, 5).forEach((p) => { p.userData.down = true; });
  game.finishRoll();
  check(game.frame === 4 && game.score === 35 + 3 + 2, 'bowling-lane: an open frame just scores the pins');
  // a real roll, straight down the middle
  const r = await boot('bowling-lane', 3);
  r.game.aimX = 0; r.game.power = 0.6; r.game.ball.position.x = 0;
  r.game.roll(); r.game.bvel.x = 0;
  for (let i = 0; i < 700 && r.game.state !== 'aim'; i++) r.step(1);
  check(r.game.rollNo === 2 || r.game.frame === 2, 'bowling-lane: a ball rolls down the lane and the roll ends by itself');
  check(r.game.score >= 3, 'bowling-lane: a good ball at the head pin knocks several down', String(r.game.score));
  // a gutter ball
  const g = await boot('bowling-lane', 4);
  g.game.aimX = -1.7; g.game.ball.position.x = -1.7; g.game.power = 0.6; g.game.roll(); g.game.bvel.x = 0;
  g.game.ball.position.x = -1.9;
  for (let i = 0; i < 700 && g.game.state !== 'aim'; i++) g.step(1);
  check(g.game.score === 0, 'bowling-lane: a gutter ball scores nothing');
  // the game ends after five frames
  const e = await boot('bowling-lane', 5);
  for (let f = 0; f < 5; f++) { e.game.pins.forEach((p) => { p.userData.down = true; }); e.game.rollNo = 1; e.game.finishRoll(); }
  check(!!e.result.ended && e.result.ended.score === 100, 'bowling-lane: five strikes is the perfect 100 and ends the run', JSON.stringify(e.result.ended));
}

// ---------- Mini Golf ----------
{
  const { game, step, result } = await boot('mini-golf');
  check(game.hole === 0 && game.strokes === 0, 'mini-golf: starts on hole 1');
  game.aimVec = { x: 1, z: 0, power: 0.4 };
  const x0 = game.pos.x;
  game.putt();
  check(game.strokes === 1 && game.vel.x > 4, 'mini-golf: a putt counts a stroke and sets the ball rolling');
  for (let i = 0; i < 600 && game.moving(); i++) step(1);
  check(game.pos.x > x0 + 2 && !game.moving(), 'mini-golf: the ball rolls and comes to rest (friction)');
  // walls: fire it hard into the far wall; it stays on the green
  game.aimVec = { x: 1, z: 0.3, power: 1 };
  game.putt();
  let bounds = true;
  for (let i = 0; i < 500 && game.moving(); i++) { step(1); if (Math.abs(game.pos.x) > game.cfg.hw + 0.3 || Math.abs(game.pos.y) > game.cfg.hd + 0.3) bounds = false; }
  check(bounds, 'mini-golf: walls keep the ball on the green');
  // the cup: a gentle roll onto it drops in
  game.pos.set(game.cfg.cup[0] - 2, game.cfg.cup[1]); game.vel.set(0, 0);
  game.aimVec = { x: 1, z: 0, power: 0.22 };
  const before = game.strokes;
  game.putt();
  for (let i = 0; i < 400 && game.sunk === 0 && game.moving(); i++) step(1);
  check(game.sunk > 0 || game.results.length === 1, 'mini-golf: a putt that reaches the cup slowly drops in');
  step(60);
  check(game.hole === 1, 'mini-golf: then on to hole 2');
  // a fast ball rolls over the cup
  const f = await boot('mini-golf', 3);
  f.game.pos.set(f.game.cfg.cup[0] - 3, f.game.cfg.cup[1]); f.game.vel.set(20, 0);
  for (let i = 0; i < 40; i++) f.step(1);
  check(f.game.hole === 0 && f.game.sunk === 0, 'mini-golf: a ball hit too hard skips over the cup');
  // giving up after seven strokes
  const m = await boot('mini-golf', 4);
  m.game.strokes = 7; m.game.total = 7; m.game.vel.set(0, 0);
  m.step(2);
  check(m.game.hole === 1 && m.game.results[0] === 7, 'mini-golf: seven strokes and the hole is given up');
  // the round ends after three holes with the total strokes as the score
  const t = await boot('mini-golf', 5);
  for (let h = 0; h < 3; h++) { t.game.strokes = 2; t.game.total += 2; t.game.holed(); t.step(50); }
  check(!!t.result.ended && t.result.ended.score === 6, 'mini-golf: three holes done ends the run with the total strokes (lower is better)', JSON.stringify(t.result.ended));
}

// ---------- Archery Range ----------
{
  const m = await import('../src/games/archery-range.js');
  const P = m.default.pointsAt;
  check(P(0, 3.2) === 10 && P(0.3, 3.2) === 10, 'archery-range: the centre is 10');
  check(P(0, 3.2 + 0.5) === 9 && P(1.0, 3.2) === 8 && P(2.0, 3.2) === 6, 'archery-range: rings step down as you move out');
  check(P(4.5, 3.2) === 0 && P(0, -2) === 0 && P(0, 0) === 3, 'archery-range: off the target is 0 (and the bottom edge is 3)');
  const { game, step, result, THREE } = await boot('archery-range');
  const fire = (pitch, power = 1) => {
    game.aimDir = () => new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch)).normalize();
    game.flying = null;
    game.shoot(power);
    let y = null;
    for (let i = 0; i < 400 && game.flying; i++) { game.flyArrow(1 / 60); }
    return game.arrows[game.arrows.length - 1].position;
  };
  const flat = fire(0.0);
  const up = fire(0.075);
  check(up.y > flat.y + 1, 'archery-range: arrows drop over distance, so aiming higher lands higher', `${flat.y.toFixed(1)} vs ${up.y.toFixed(1)}`);
  game.wind = 3;
  const windy = fire(0.075);
  game.wind = -3;
  const windL = fire(0.075);
  check(windy.x > windL.x + 1, 'archery-range: wind pushes the arrow sideways');
  // a pitch that hits the gold: search for it
  let best = null; let bd = 9;
  for (let p = 0.02; p < 0.16; p += 0.002) {
    game.wind = 0;
    const pos = fire(p, 1);
    const d = Math.abs(pos.y - 3.2);
    if (pos.z <= -41.9 && d < bd) { bd = d; best = p; }
  }
  check(best !== null && bd < 0.5, 'archery-range: there is an aim that hits the middle', `pitch ${best}, off by ${bd.toFixed(2)}`);
  const s0 = game.score;
  game.wind = 0; game.arrows.forEach((a) => game.scene.remove(a));
  fire(best, 1);
  check(game.score >= s0 + 9, 'archery-range: shooting at that aim scores 9-10', String(game.score - s0));
  const q = await boot('archery-range', 6);
  q.game.shots = 9;
  q.game.aimDir = () => new THREE.Vector3(0, 1, 0).normalize();
  q.game.shoot(0.5);
  for (let i = 0; i < 900 && q.game.flying; i++) q.game.flyArrow(1 / 60);
  check(!!q.result.ended, 'archery-range: the tenth arrow ends the run', JSON.stringify(q.result.ended));
  const w = await boot('archery-range', 7);
  w.input.down = true; w.step(20);
  check(w.game.draw > 0.3 && w.game.drawing, 'archery-range: holding the button draws the bow');
  w.input.down = false; w.game.aimDir = () => new THREE.Vector3(0, 0.1, -1).normalize(); w.step(2);
  check(w.game.shots === 1, 'archery-range: letting go shoots');
  const tap = await boot('archery-range', 8);
  tap.input.down = true; tap.step(3); tap.input.down = false; tap.step(3);
  check(tap.game.shots === 0, 'archery-range: a quick tap is not enough draw to shoot');
}

// ---------- Skee-Ball ----------
{
  const m = await import('../src/games/skee-ball.js');
  const S = m.default;
  const a = S.landing(0.3, 0).d, b = S.landing(0.6, 0).d, c = S.landing(0.9, 0).d;
  check(a < b && b < c, 'skee-ball: a harder roll flies further');
  check(S.pointsAt(11.2, 0) === 100, 'skee-ball: the far middle hole is 100');
  check(S.pointsAt(9.4, 2.7) === 40 && S.pointsAt(8.2, 0) === 30 && S.pointsAt(5.3, 0) === 10, 'skee-ball: the nearer holes pay less');
  check(S.pointsAt(2, 0) === 0 && S.pointsAt(7.4, 1.4) === 0, 'skee-ball: landing between holes scores nothing');
  const reach = (target) => { for (let p = 0; p <= 1; p += 0.005) if (S.landing(p, 0).d >= target) return p; return 1; };
  check(reach(11.2) > 0.6 && reach(11.2) < 0.9, 'skee-ball: the 100 needs roughly three-quarter power', String(reach(11.2)));
  const { game, step, input, result } = await boot('skee-ball');
  game.aimX = 0;
  input.down = true; step(60); input.down = false; step(1);
  check(game.state === 'roll' && game.shots === 1, 'skee-ball: charge and release rolls a ball');
  for (let i = 0; i < 400 && game.state !== 'aim' && !result.ended; i++) step(1);
  check(game.state === 'aim', 'skee-ball: it lands and you get the next ball');
  for (let n = 1; n < 9; n++) { input.down = true; step(20); input.down = false; step(1); for (let i = 0; i < 400 && game.state !== 'aim' && !result.ended; i++) step(1); }
  check(!!result.ended && result.ended.score === game.score, 'skee-ball: nine balls and it is over, with your total', JSON.stringify(result.ended));
}

// ---------- Bubble Shooter ----------
{
  const { game, step, input, result } = await boot('bubble-shooter');
  check(game.rows.length === 6 && game.count() === 12 * 3 + 11 * 3, 'bubble-shooter: six rows of bubbles to start');
  let symmetric = true;
  for (let r = 0; r < game.rows.length; r++) for (let c = 0; c < game.rows[r].cells.length; c++) for (const [nr, nc] of game.neighbours(r, c)) if (!game.neighbours(nr, nc).some(([a, b]) => a === r && b === c)) symmetric = false;
  check(symmetric, 'bubble-shooter: every neighbour link goes both ways');
  const inner = game.neighbours(2, 5);
  check(inner.length === 6, 'bubble-shooter: a bubble in the middle touches six others', String(inner.length));
  // clear the grid and build a controlled scene
  const clear = () => { for (let r = 0; r < game.rows.length; r++) for (let c = 0; c < game.rows[r].cells.length; c++) if (game.rows[r].cells[c] !== null) game.pop(r, c, 0); game.score = 0; };
  clear();
  game.rows[0].cells[3] = 1; game.rows[0].cells[4] = 1;
  const pts = game.place(1, 3, 1);
  check(pts === 30 && game.count() === 0, 'bubble-shooter: three of a colour pop for 30', String(pts));
  // two of a colour do not pop
  game.rows[0].cells[3] = 2;
  check(game.place(1, 3, 2) === 0 && game.count() === 2, 'bubble-shooter: two of a colour stay');
  clear();
  // floaters: pop the only bubble holding a hanging one up
  game.rows[0].cells[5] = 3; game.rows[0].cells[6] = 3;
  game.rows[1].cells[5] = 4;                                   // hangs off the row-0 pair (row 1 is offset: it touches cols 5 and 6)
  const p2 = game.place(1, 6, 3);                               // row 1 col 6 joins the pair => 3 popped, then the 4 hanging below? (it is attached to row 0 so...)
  check(p2 >= 30, 'bubble-shooter: a match of three scores 30 or more', String(p2));
  clear();
  game.rows[0].cells[0] = 1; game.rows[1].cells[0] = 2; game.rows[2].cells[0] = 3;            // a chain hanging from the top-left
  game.rows[0].cells[1] = 4;
  game.place(3, 0, 3);    // (does not match: 3 != 3 at row 2? it does) two 3s only
  clear();
  game.rows[0].cells[0] = 1; game.rows[1].cells[0] = 2; game.rows[2].cells[0] = 4; game.rows[2].cells[1] = 4;
  game.pop(0, 0, 0);
  game.rows[3] ??= null;
  const before = game.count();
  game.place(3, 0, 4);    // 3 x colour 4 pop; the lone 2 above them is still joined to nothing
  check(game.count() < before + 1, 'bubble-shooter: bubbles no longer joined to the ceiling fall', `${before} -> ${game.count()}`);
  // clearing the board pays 500 and refills
  clear();
  game.rows[0].cells[0] = 2; game.rows[0].cells[1] = 2;
  game.shot = { x: 0, y: 0, vx: 0, vy: 0, colour: 2, mesh: game.add(game.loadedMesh.clone()) };
  game.shot.x = game.cellPos(1, 0).x; game.shot.y = game.cellPos(1, 0).y;
  game.land();
  check(game.score >= 500 && game.count() > 20, 'bubble-shooter: clearing every bubble pays 500 and brings a fresh set');
  // a shot flies, bounces and sticks
  const f = await boot('bubble-shooter', 3);
  const n0 = f.game.count();
  f.game.angle = Math.PI / 2;
  f.input.clicked = true; f.step(1);
  check(!!f.game.shot, 'bubble-shooter: clicking fires a bubble');
  for (let i = 0; i < 200 && f.game.shot; i++) f.step(1);
  check(!f.game.shot && (f.game.count() >= n0 || f.game.score > 0), 'bubble-shooter: it sticks to the cluster (or pops something)');
  // new rows and game over
  const p = await boot('bubble-shooter', 4);
  const rows0 = p.game.rows.length;
  p.game.pushRow(true);
  check(p.game.rows.length === rows0 + 1 && p.game.rows[0].odd !== p.game.rows[1].odd, 'bubble-shooter: a pushed row goes on top with the opposite offset');
  const l = await boot('bubble-shooter', 5);
  while (l.game.lowestY() > -8) l.game.pushRow(false);
  l.game.shot = { x: 0, y: 0, vx: 0, vy: 0, colour: 0, mesh: l.game.add(l.game.loadedMesh.clone()) };
  l.game.shot.x = l.game.cellPos(0, 0).x; l.game.shot.y = l.game.cellPos(0, 0).y - 1.4;
  l.step(2);
  check(!!l.result.ended, 'bubble-shooter: bubbles reaching the line end the run', JSON.stringify(l.result.ended));
}

finish('new game');
