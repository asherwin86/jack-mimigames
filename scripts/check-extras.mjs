/**
 * The extra mechanics added to individual games (pickups, power-ups, hazards):
 * each one is set up on purpose and checked, since the random-input smoke test
 * rarely gets near them.
 *
 *   node scripts/check-extras.mjs
 */
import { boot, check, finish } from './lib/game-harness.mjs';

// ---------- Cube Dodger: shield + star pickups ----------
{
  const { game, step, result } = await boot('cube-dodger');
  const at = (mesh, y = 1) => mesh.position.set(game.player.position.x, y, game.player.position.z);
  const dropObstacle = () => { const o = game.pool.pop(); o.visible = true; o.scale.set(1, 1, 1); at(o, 0.9); game.live.push(o); return o; };

  const realRandom = Math.random;
  Math.random = () => 0.1;                 // < 0.5 -> a shield
  game.spawnPickup();
  Math.random = realRandom;
  const shield = game.pickupLive[0];
  check(shield?.userData.kind === 'shield', 'cube-dodger: a shield pickup can spawn');
  at(shield);
  step(1);
  check(game.shield === true && game.pickupLive.length === 0, 'cube-dodger: driving through it puts the shield on');
  check(game.shieldRing.visible, 'cube-dodger: ...and shows the ring');
  Math.random = () => 0.1;
  game.spawnPickup();
  Math.random = realRandom;
  check(game.pickupLive[0].userData.kind === 'star', 'cube-dodger: no second shield while you are wearing one (a star spawns instead)');
  game.pickupLive[0].position.z = 999; game.pickupLive[0].userData.dead = true;

  const o1 = dropObstacle();
  step(1);
  check(!result.ended && game.shield === false && !o1.visible, 'cube-dodger: the shield absorbs one crash and shatters the block');
  dropObstacle();
  step(1);
  check(!!result.ended, 'cube-dodger: the next crash ends the run');

  const b = await boot('cube-dodger', 5);
  Math.random = () => 0.9;                 // >= 0.5 -> a star
  b.game.spawnPickup();
  const star = b.game.pickupLive[0];
  check(star.userData.kind === 'star', 'cube-dodger: a star pickup can spawn');
  star.position.set(b.game.player.position.x, 1, b.game.player.position.z);
  b.step(1);
  check(b.game.bonus === 40, 'cube-dodger: a star is worth +40 m');
  const o2 = b.game.pool.pop(); o2.visible = true; o2.scale.set(1, 1, 1);
  o2.position.set(b.game.player.position.x, 0.9, b.game.player.position.z); b.game.live.push(o2);
  b.step(1);
  check(b.result.ended && b.result.ended.score >= 40, 'cube-dodger: the bonus is part of the final score', String(b.result.ended?.score));
}

// ---------- Sky Hoops: golden rings ----------
{
  const { game, step } = await boot('sky-hoops');
  for (let i = 0; i < 7; i++) game.spawnRing();
  const gold = game.live[6];
  check(gold.userData.gold === true && gold.scale.x < 1, 'sky-hoops: every seventh ring is a small golden one');
  check(game.live.slice(0, 6).every((r) => !r.userData.gold && r.scale.x === 1), 'sky-hoops: the other six are normal');
  const place = (ring, dx, dy) => { game.live.length = 0; game.live.push(ring); ring.userData.passed = false; ring.position.set(game.ship.position.x + dx, game.ship.position.y + dy, game.ship.position.z - 0.3); };

  place(gold, 2.6, 0);      // would count on a normal ring (radius 3.1), not on the golden one
  const before = game.rings_hit;
  step(1);
  check(game.rings_hit === before, 'sky-hoops: a golden ring 2.6 off-centre is a miss');

  place(gold, 0.5, 0.5);
  const t0 = game.timeLeft;
  step(1);
  check(game.rings_hit === before + 3, 'sky-hoops: threading a golden ring counts 3');
  check(game.timeLeft > t0 + 4, 'sky-hoops: ...and adds about 5 seconds', `${t0} -> ${game.timeLeft}`);

  const normal = game.pool.pop() || game.rings[0];
  normal.scale.setScalar(1); normal.userData.gold = false;
  place(normal, 2.6, 0);
  step(1);
  check(game.rings_hit === before + 4, 'sky-hoops: a normal ring 2.6 off-centre still counts 1');
}

// ---------- Snake Cube: golden apple + rocks ----------
{
  const { game, step, result } = await boot('snake-cube');
  const farFood = () => { game.foodCell = { x: 0, z: 0 }; game.place(game.food, game.foodCell, 0.55); };
  farFood();
  game.spawnGold();
  game.goldCell = { x: 8, z: 7 };            // straight ahead of the head at (7,7) heading +x
  game.place(game.gold, game.goldCell, 0.55);
  step(60);
  check(!result.ended, 'snake-cube: still alive after grabbing the golden apple', result.ended?.detail);
  check(game.body.length === 6, 'snake-cube: a golden apple is +3 length', `length ${game.body.length}`);
  check(game.segments.length === game.body.length, 'snake-cube: every body cell has a mesh');
  check(game.eaten === 0, 'snake-cube: ...and does not count as food eaten (no speed-up)');
  check(!game.goldCell && !game.gold.visible, 'snake-cube: the golden apple is gone once taken');
}
{
  const { game, step } = await boot('snake-cube', 3);
  game.rate = 1e9;                           // hold the snake still so only the apple's timer runs
  game.spawnGold();
  check(!!game.goldCell && game.gold.visible, 'snake-cube: a golden apple appears');
  step(60 * 5);
  check(!!game.goldCell, 'snake-cube: ...and waits a few seconds');
  step(60 * 3);
  check(game.goldCell === null && !game.gold.visible, 'snake-cube: an uneaten golden apple vanishes after 7 seconds');
}
{
  const { game, step, result } = await boot('snake-cube');
  game.foodCell = { x: 0, z: 0 }; game.place(game.food, game.foodCell, 0.55);
  game.addRock();
  check(game.rocks.length === 1, 'snake-cube: a rock can be placed');
  const head = game.body[0];
  check(Math.abs(game.rocks[0].cell.x - head.x) + Math.abs(game.rocks[0].cell.z - head.z) > 4, 'snake-cube: never right beside the head');
  game.rocks[0].cell = { x: 8, z: 7 };
  game.place(game.rocks[0].mesh, game.rocks[0].cell, 0.55);
  step(30);
  check(result.ended && /rock/i.test(result.ended.detail), 'snake-cube: hitting a rock ends the run', result.ended?.detail);
}
{
  const { game, step } = await boot('snake-cube', 9);
  game.eaten = 3;
  game.foodCell = { x: 8, z: 7 };
  game.place(game.food, game.foodCell, 0.55);
  step(30);
  check(game.eaten === 4 && game.rocks.length === 1, 'snake-cube: the 4th apple brings the first rock', `${game.eaten} eaten, ${game.rocks.length} rocks`);
  check(!game.rocks.some((r) => game.body.some((b) => b.x === r.cell.x && b.z === r.cell.z)), 'snake-cube: rocks are never placed on the snake');
  check(!(game.foodCell.x === game.rocks[0].cell.x && game.foodCell.z === game.rocks[0].cell.z), 'snake-cube: ...or on the food');
}

// ---------- Gem Grab: magnet + freeze ----------
{
  const { game, step } = await boot('gem-grab');
  const realRandom = Math.random;
  Math.random = () => 0.1;                    // < 0.5 -> magnet
  game.spawnPowerup();
  Math.random = realRandom;
  const magnet = game.powerups[0];
  check(magnet?.userData.kind === 'magnet', 'gem-grab: a magnet can spawn');
  magnet.position.copy(game.player.position);
  step(1);
  check(game.magnetT > 6 && game.powerups.length === 0, 'gem-grab: touching it turns the magnet on for about 7 s');
  const gem = game.gems[0];
  gem.position.set(game.player.position.x + 8, 1, game.player.position.z);
  const before = gem.position.distanceTo(game.player.position);
  step(20);
  check(gem.position.distanceTo(game.player.position) < before - 3 || game.collected > 0, 'gem-grab: the magnet reels in a gem that was 8 away');
  step(60 * 8);
  check(game.magnetT === 0, 'gem-grab: the magnet runs out');
}
{
  const { game, step } = await boot('gem-grab', 4);
  game.invuln = 0;
  const realRandom = Math.random;
  Math.random = () => 0.9;                    // >= 0.5 -> freeze
  game.spawnPowerup();
  Math.random = realRandom;
  const ice = game.powerups[0];
  check(ice?.userData.kind === 'freeze', 'gem-grab: an ice crystal can spawn');
  ice.position.copy(game.player.position);
  step(1);
  check(game.freezeT > 3, 'gem-grab: touching it freezes the drones for about 4 s');
  const d = game.drones[0];
  d.position.set(game.player.position.x + 6, 0.9, game.player.position.z);
  const at = d.position.clone();
  step(30);
  check(d.position.distanceTo(at) < 0.01, 'gem-grab: frozen drones stay put');
  d.position.copy(game.player.position);
  game.invuln = 0;
  step(2);
  check(game.lives === 3, 'gem-grab: a frozen drone touching you does no harm');
  step(60 * 5);
  d.position.copy(game.player.position); game.invuln = 0;
  step(2);
  check(game.lives < 3, 'gem-grab: once the ice melts, drones hurt again');
}

// ---------- Block Stacker: a perfect streak widens the tower ----------
{
  const { game, result } = await boot('block-stacker');
  const dropAt = (offset) => {
    const ax = game.axis;
    game.dropLock = 0;
    game.moving.position[ax] = game.centre[ax] + offset;
    game.drop();
  };
  dropAt(1.0);
  check(Math.abs(game.size.x - 5) < 1e-6 || Math.abs(game.size.z - 5) < 1e-6, 'block-stacker: an off-centre drop trims the slab', `${game.size.x} x ${game.size.z}`);
  const w = { x: game.size.x, z: game.size.z };
  dropAt(0); dropAt(0);
  check(game.streak === 2 && game.size.x === w.x && game.size.z === w.z, 'block-stacker: two perfect drops build a streak but change nothing yet');
  dropAt(0);
  check(game.streak === 3 && Math.abs(game.size.x - Math.min(6, w.x + 0.6)) < 1e-6 && Math.abs(game.size.z - Math.min(6, w.z + 0.6)) < 1e-6, 'block-stacker: the third perfect drop in a row widens the slab by 0.6', `${game.size.x} x ${game.size.z}`);
  dropAt(0.9);
  check(game.streak === 0, 'block-stacker: a sloppy drop breaks the streak');
  check(!result.ended, 'block-stacker: (still standing)');
  for (let i = 0; i < 40; i++) { dropAt(0); }
  check(game.size.x <= 6 && game.size.z <= 6, 'block-stacker: it never grows beyond the starting width', `${game.size.x} x ${game.size.z}`);
}

// ---------- Asteroid Blaster: repair + rapid-fire rocks ----------
{
  const { game } = await boot('asteroid-blaster');
  game.hull = 3;
  const realRandom = Math.random;
  Math.random = () => 0.1;                    // hull below full and < 0.6 -> a repair rock
  const rock = game.spawnSpecial();
  Math.random = realRandom;
  check(rock.userData.special === 'repair', 'asteroid-blaster: a glowing repair rock can spawn');
  const n = game.rocks.length, score = game.score;
  game.destroy(rock, rock.position.clone());
  check(game.hull === 4 && game.score === score + 150 && game.rocks.length === n - 1, 'asteroid-blaster: shooting it mends the hull, scores 150 and does not split');
  game.hull = 5;
  const r2 = game.spawnSpecial();
  check(r2.userData.special === 'rapid', 'asteroid-blaster: at full hull the bonus is rapid fire');
  game.destroy(r2, r2.position.clone());
  check(game.rapidT > 6, 'asteroid-blaster: rapid fire lasts about 7 seconds');
  game.cooldown = 0; game.fire();
  check(game.cooldown < 0.1, 'asteroid-blaster: ...and fires more than twice as fast');
  game.rapidT = 0; game.cooldown = 0; game.fire();
  check(game.cooldown > 0.15, 'asteroid-blaster: normal fire rate once it runs out');
  game.hull = 5;
  const r3 = game.spawnSpecial(); r3.userData.special = 'repair';
  game.destroy(r3, r3.position.clone());
  check(game.hull === 5, 'asteroid-blaster: repairs never take the hull above 5');
}

// ---------- Marble Maze: time crystals ----------
{
  const { game, step } = await boot('marble-maze');
  check(game.crystals.length === 4, 'marble-maze: four time crystals on the board');
  game.elapsed = 10;
  const c = game.crystals[1];
  game.pos.set(c.position.x, c.position.z);
  game.vel.set(0, 0);
  step(1);
  check(game.crystals.length === 3 && game.elapsed > 8 && game.elapsed < 8.1, 'marble-maze: a crystal takes 2 seconds off the clock', String(game.elapsed));
  game.elapsed = 1;
  const c2 = game.crystals[0];
  game.pos.set(c2.position.x, c2.position.z);
  step(1);
  check(game.elapsed >= 0 && game.elapsed < 0.1, 'marble-maze: the clock never goes below zero', String(game.elapsed));
  // the crystals are all reachable spots: none inside a wall or a hole
  const b = await boot('marble-maze');
  const bad = b.game.crystals.filter((cr) => b.game.holes.some((h) => Math.hypot(cr.position.x - h.x, cr.position.z - h.z) < h.r + 0.5));
  check(bad.length === 0, 'marble-maze: no crystal is sitting over a hole');
}

// ---------- Simon Cubes: backwards rounds ----------
{
  const { game, result } = await boot('simon-cubes');
  game.round = 4;
  game.sequence = [0, 1, 2, 3];
  game.nextRound();
  check(game.round === 5 && game.reverse === true, 'simon-cubes: round 5 is a backwards round');
  game.sequence = [0, 1, 2, 3, 4];
  game.phase = 'input'; game.inputClock = 30; game.step = 0;
  for (const i of [4, 3, 2, 1]) game.pressPad(i);
  check(!result.ended && game.step === 4, 'simon-cubes: playing it backwards is accepted');
  game.pressPad(0);
  check(game.phase === 'idle' && !result.ended, 'simon-cubes: ...and completes the round');
  game.nextRound();
  check(game.round === 6 && game.reverse === false, 'simon-cubes: the next round is forwards again');
}
{
  const { game, result } = await boot('simon-cubes', 2);
  game.round = 4; game.sequence = [0, 1, 2, 3]; game.nextRound();
  game.sequence = [0, 1, 2, 3, 4];
  game.phase = 'input'; game.inputClock = 30; game.step = 0;
  game.pressPad(0);
  check(!!result.ended, 'simon-cubes: playing a backwards round forwards is wrong');
}

// ---------- Paddle Rally: bonus target ----------
{
  const { game, step, result } = await boot('paddle-rally');
  const shootAtTarget = () => {
    const t = game.target.position;
    game.ball.position.set(t.x, t.y, -46 + 0.2);
    game.vel.set(0, 0, -20);
    game.serving = 0;
    step(1);
  };
  const first = game.target.position.clone();
  shootAtTarget();
  check(game.bonus === 2 && game.targets === 1, 'paddle-rally: bouncing the ball off the target scores 2');
  check(game.vel.z > 0, 'paddle-rally: ...and the ball still comes back');
  check(!game.target.position.equals(first), 'paddle-rally: the target moves after a hit');
  // a hit that misses the target scores nothing
  const t2 = game.target.position;
  game.ball.position.set(t2.x > 0 ? t2.x - 6 : t2.x + 6, t2.y, -46 + 0.2);
  game.vel.set(0, 0, -20);
  step(1);
  check(game.bonus === 2, 'paddle-rally: hitting the wall beside the target scores nothing');
  game.lives = 2;
  shootAtTarget(); shootAtTarget();
  check(game.targets === 3 && game.lives === 3, 'paddle-rally: every third target buys back a life', `lives ${game.lives}`);
  game.lives = 3;
  shootAtTarget();
  check(game.lives === 3, 'paddle-rally: lives never go above 3');
  game.best = 4; game.lives = 1;
  game.miss();
  check(result.ended?.score === 4 + game.bonus, 'paddle-rally: the final score is the best rally plus the bonus', JSON.stringify(result.ended));
}

// ---------- Platform Hop: spring pads ----------
{
  const { game, step } = await boot('platform-hop');
  const springs = game.platforms.filter((p) => p.userData.spring);
  check(springs.length >= 2 && springs.every((p) => p.userData.index % 6 === 3), 'platform-hop: every sixth platform has a spring (from floor 3)');
  check(!game.platforms[0].userData.spring && !game.platforms[1].userData.spring, 'platform-hop: none on the first few floors');
  const sp = springs[0];
  const rest = sp.position.y + 0.9;
  game.player.position.set(sp.position.x, rest + 0.04, sp.position.z);
  game.vel.set(0, -4, 0);
  game.grounded = false;
  game.standing = null;
  step(1);
  check(game.vel.y > 20, 'platform-hop: landing on a spring fires you upward much harder than a jump', String(game.vel.y));
  check(game.grounded === false, 'platform-hop: ...so you are airborne, not stuck to the platform');
  const plain = game.platforms.find((p) => !p.userData.spring && p.userData.index > 0);
  game.player.position.set(plain.position.x, plain.position.y + 0.9 + 0.04, plain.position.z);
  game.vel.set(0, -4, 0);
  step(1);
  check(game.vel.y < 1 && game.grounded, 'platform-hop: a normal platform still just catches you');
}

// ---------- Sumo Arena: boss ----------
{
  const { game } = await boot('sumo-arena');
  game.wave = 3; game.spawnWave();
  check(!game.foes.some((f) => f.userData.boss), 'sumo-arena: no boss on wave 4');
  game.foes.length = 0;
  game.wave = 4; game.spawnWave();
  const boss = game.foes.find((f) => f.userData.boss);
  check(game.wave === 5 && boss && boss.userData.mass > 3 && boss.userData.r > 1.5, 'sumo-arena: wave 5 brings a big, heavy boss');
  const before = game.pushed;
  const i = game.foes.indexOf(boss);
  game.eject(boss, i);
  check(game.pushed === before + 3, 'sumo-arena: shoving the boss off counts as 3');
  // collisions use the real radii: the player cannot sit inside the boss
  const b2 = game.foes.length ? game.foes[0] : null;
  const big = { position: new game.player.position.constructor(0, 1.6, 0), userData: { vel: new game.player.position.constructor(), mass: 3.4, r: 1.6 } };
  game.player.position.set(2.0, 1, 0);
  game.collide(game.player, big);
  check(game.player.position.distanceTo(big.position) >= 2.55, 'sumo-arena: a boss keeps the player out to the sum of the radii', String(game.player.position.distanceTo(big.position)));
  void b2;
}

// ---------- Tunnel Run: slow-mo orbs ----------
{
  const { game, step } = await boot('tunnel-run');
  game.spawned = 4;
  game.spawnWall();                       // the fifth wall carries an orb
  const w = game.walls[0];
  check(!!w.orb, 'tunnel-run: every eighth wall has a slow-mo orb in its gap');
  game.spawned = 0;
  game.spawnWall();
  check(!game.walls[1].orb, 'tunnel-run: most walls do not');
  const fast = game.speed;
  game.ship.position.set(w.gap.cx, w.gap.cy, 0);
  w.z = -0.5;
  for (const part of w.parts) part.position.z = w.z;
  step(1);
  check(game.slowT > 3 && !w.orb, 'tunnel-run: flying through the orb slows the tunnel for 4 seconds');
  step(1);
  check(game.speed < fast * 0.75, 'tunnel-run: ...to about 70% speed', `${fast} -> ${game.speed}`);
  step(60 * 5);
  check(game.slowT === 0, 'tunnel-run: and it wears off');
  // an orb that is missed does not slow anything
  const b = await boot('tunnel-run', 8);
  b.game.spawned = 4; b.game.spawnWall();
  const w2 = b.game.walls[0];
  b.game.ship.position.set(w2.gap.cx + (w2.gap.gapW / 2 - 0.8) * Math.sign(w2.gap.cx || 1) * 0.0, w2.gap.cy, 0);
  b.game.ship.position.x = w2.gap.cx + 1.9;    // inside the gap (half-width ~2.6 - 0.5) but not through the orb
  w2.z = -0.5;
  b.step(1);
  if (!b.result.ended) check(b.game.slowT === 0, 'tunnel-run: passing the gap without touching the orb does nothing');
}

// ---------- Beat Lanes: star notes ----------
{
  const { game, step, result } = await boot('beat-lanes');
  game.noteCount = 23;
  game.nextBeat = 0;
  game.rng = () => 0.1;                     // always spawn one note (never a double: 0.1 < 0.16 would, so use two calls)
  let calls = 0;
  game.rng = () => (calls++ % 2 === 0 ? 0.1 : 0.9);   // density check passes, double-note check fails
  step(1);
  const star = game.notes.find((n) => n.userData.gold);
  check(!!star, 'beat-lanes: every 24th note is a star');
  check(game.notes.filter((n) => n.userData.gold).length === 1, 'beat-lanes: and only that one');
  game.lives = 3;
  star.position.z = 0;
  game.strike(star.userData.lane);
  check(game.lives === 4 && game.fever > 4, 'beat-lanes: hitting a star gives +1 life and 5 seconds of double points');
  const before = game.score;
  game.spawnNote(1); const n = game.notes[game.notes.length - 1]; n.position.z = 0;
  game.strike(1);
  const plain = game.score - before;
  game.fever = 0;
  const b2 = game.score;
  game.spawnNote(2); const n2 = game.notes[game.notes.length - 1]; n2.position.z = 0;
  game.strike(2);
  check(plain >= 2 * (game.score - b2) - 1 && plain > game.score - b2, 'beat-lanes: notes are worth double while the star power lasts', `${plain} vs ${game.score - b2}`);
  game.lives = 5;
  game.strike(0); game.lives = 5;
  game.spawnNote(3, true); const g2 = game.notes[game.notes.length - 1]; g2.position.z = 1.7;
  game.combo = 7;
  step(1);
  check(game.lives === 5 && game.combo === 0 && !result.ended, 'beat-lanes: missing a star costs no life (just the combo)');
  game.fever = 0; game.lives = 5;
  const g3 = game.notes.find((x) => !x.userData.judged);
  void g3;
}

// ---------- Colour Rush: gold rounds and life regen ----------
{
  const { game } = await boot('colour-rush');
  game.round = 7; game.newRound();
  check(game.round === 8 && game.golden === true && game.beacon.scale.x > 1.3, 'colour-rush: round 8 is a big gold round');
  const padOf = () => game.pads.find((p) => p.userData.colour === game.target);
  game.clock = game.limit;                    // full speed bonus for a like-for-like comparison
  const s0 = game.score;
  game.choose(padOf());
  const goldGain = game.score - s0;
  check(game.golden === false || game.round === 9, 'colour-rush: the round after is normal');
  game.inverted = false; game.golden = false; game.clock = game.limit;
  const s1 = game.score;
  game.choose(padOf());
  const plainGain = game.score - s1;
  check(goldGain >= plainGain * 2.5, 'colour-rush: a gold round pays about triple', `${goldGain} vs ${plainGain}`);
  game.lives = 2; game.streak = 14; game.inverted = false; game.golden = false;
  game.choose(padOf());
  check(game.lives === 3 && game.streak === 15, 'colour-rush: a 15 streak wins a life back');
  game.lives = 3; game.streak = 29; game.inverted = false; game.golden = false;
  game.choose(padOf());
  check(game.lives === 3, 'colour-rush: never above 3 lives');
}

// ---------- Lava Floor: coolant ----------
{
  const { game, step } = await boot('lava-floor');
  game.spawnCoolant();
  check(game.coolants.length === 1, 'lava-floor: a coolant orb can spawn');
  const orb = game.coolants[0];
  const tile = game.tiles.find((t) => Math.abs(t.position.x - orb.position.x) < 0.01 && Math.abs(t.position.z - orb.position.z) < 0.01);
  check(!!tile && tile.userData.state === 'solid', 'lava-floor: and it sits on a solid tile');
  orb.position.copy(game.player.position);
  const before = game.lavaY;
  step(1);
  check(game.lavaY < before - 1.5 && game.coolants.length === 0, 'lava-floor: grabbing it pushes the lava down about 1.8 m', `${before} -> ${game.lavaY}`);
  game.spawnCoolant(); game.spawnCoolant(); game.spawnCoolant();
  game.nextCoolant = 0;
  step(1);
  check(game.coolants.length <= 4, 'lava-floor: orbs do not pile up without limit');
  const o2 = game.coolants[0];
  o2.userData.left = 0.01;
  o2.position.set(50, 1.9, 50);
  step(2);
  check(!game.coolants.includes(o2), 'lava-floor: an orb you ignore disappears');
}

// ---------- Maze Escape: time shards ----------
{
  const { game, step } = await boot('maze-escape');
  check(game.shards.length === 3, 'maze-escape: three time shards');
  const open = game.shards.every((m) => !game.solid(m.position.x, m.position.z));
  check(open, 'maze-escape: every shard is in an open room, not inside a wall');
  check(game.shards.every((m) => Math.hypot(m.position.x - game.pos.x, m.position.z - game.pos.z) > 10), 'maze-escape: none right at the start');
  game.elapsed = 20;
  const m = game.shards[0];
  game.pos.set(m.position.x, game.pos.y, m.position.z);
  step(1);
  check(game.shards.length === 2 && game.elapsed > 16 && game.elapsed < 16.1, 'maze-escape: a shard takes 4 seconds off', String(game.elapsed));
  game.elapsed = 2;
  const m2 = game.shards[0];
  game.pos.set(m2.position.x, game.pos.y, m2.position.z);
  step(1);
  check(game.elapsed >= 0 && game.elapsed < 0.1, 'maze-escape: the clock never goes below zero');
  for (let seed = 1; seed <= 6; seed++) {
    const b = await boot('maze-escape', seed);
    if (!b.game.shards.every((s) => !b.game.solid(s.position.x, s.position.z))) check(false, `maze-escape: shard inside a wall (seed ${seed})`);
  }
}

// ---------- Brick Wall: capsules ----------
{
  const { game, step } = await boot('brick-wall');
  const drop = (kind) => {
    const c = game.add(game.bricks[0].clone());
    c.geometry = game.bricks[0].geometry.clone(); c.material = game.bricks[0].material.clone();
    c.userData = { kind };
    c.position.set(game.paddle.position.x, -8 + 0.2, 0.2);
    game.caps.push(c);
  };
  drop('wide'); step(1);
  check(game.wideT > 11 && game.caps.length === 0, 'brick-wall: catching a wide capsule widens the paddle for 12 s');
  step(30);
  check(game.paddle.scale.x > 1.3, 'brick-wall: ...and the paddle actually gets wider');
  drop('slow'); step(1);
  check(game.slowT > 8, 'brick-wall: a slow capsule slows the ball for 9 s');
  game.lives = 2; drop('life'); step(1);
  check(game.lives === 3, 'brick-wall: a life capsule gives a life');
  game.lives = 5; drop('life'); step(1);
  check(game.lives === 5, 'brick-wall: never more than 5 lives');
  // a capsule that falls past the paddle is lost
  const c = game.add(game.bricks[0].clone()); c.geometry = game.bricks[0].geometry.clone(); c.material = game.bricks[0].material.clone();
  c.userData = { kind: 'life' }; c.position.set(game.paddle.position.x + 9, -7, 0.2); game.caps.push(c);
  game.lives = 2;
  step(60);
  check(game.lives === 2 && !game.caps.includes(c), 'brick-wall: a capsule you miss is gone and does nothing');
  // some bricks drop capsules when broken
  const b = await boot('brick-wall', 3);
  let dropped = 0;
  for (let i = 0; i < 40 && b.game.bricks.length; i++) { const br = b.game.bricks[0]; br.userData.hp = 1; b.game.hitBrick(br, 0); }
  dropped = b.game.caps.length;
  check(dropped > 0 && dropped < 40, 'brick-wall: some (not all) broken bricks drop capsules', `${dropped} of 40`);
}

// ---------- Whack-a-Cube: clock cubes ----------
{
  const { game } = await boot('whack-a-cube');
  const pop = (roll) => {
    const real = Math.random;
    const seq = [0.0, roll];                 // 1st call picks the cell index, 2nd is the kind roll
    let i = 0; Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    game.popRandom();
    Math.random = real;
    return game.cells.find((c) => c.userData.state === 'up' && c.userData.kind);
  };
  const clock = pop(0.30);                   // 0.28 <= roll < 0.34
  check(clock?.userData.kind === 'clock', 'whack-a-cube: white clock cubes can pop up');
  game.timeLeft = 20;
  game.strike(clock);
  check(game.timeLeft > 23.9 && game.timeLeft <= 24.01, 'whack-a-cube: smashing a clock cube adds 4 seconds', String(game.timeLeft));
  check(game.hits === 1 && game.score >= 25, 'whack-a-cube: ...and still scores like a normal cube');
  game.timeLeft = 44;
  const c2 = pop(0.30);
  game.strike(c2);
  check(game.timeLeft <= 60, 'whack-a-cube: the clock is capped 15 s above the start');
  game.timeLeft = 59;
  const c3 = pop(0.30); game.strike(c3);
  check(game.timeLeft === 60, 'whack-a-cube: (exactly at the cap)');
  game.combo = 5;
  const c4 = pop(0.30);
  game.retract(c4, c4.userData.kind === 'good' || c4.userData.kind === 'gold');
  check(game.combo === 5, 'whack-a-cube: letting a clock cube duck away does not break your combo');
}

// ---------- Fruit Slice: frenzy + heart fruit ----------
{
  const { game } = await boot('fruit-slice');
  const spawnAs = (bombRoll, specialRoll) => {
    const real = Math.random; let i = 0; const seq = [bombRoll, specialRoll];
    Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    game.spawn();
    Math.random = real;
    return game.live[game.live.length - 1];
  };
  const gold = spawnAs(0.9, 0.02);
  check(gold.userData.special === 'gold', 'fruit-slice: a golden fruit can spawn');
  const s0 = game.score;
  game.slice(gold);
  check(game.frenzyT > 5 && game.score === s0 + 3, 'fruit-slice: slicing it starts a 6 s frenzy (and is worth 3)', `${game.score - s0}`);
  const f = spawnAs(0.9, 0.5);
  const s1 = game.score;
  game.slice(f);
  check(game.score === s1 + 2, 'fruit-slice: during the frenzy fruit is worth double');
  game.nextSpawn = 0;
  const before = game.nextSpawn;
  game.update(1 / 60);
  check(game.nextSpawn < 0.75 * 1.2 * 0.5 + 0.001, 'fruit-slice: ...and fruit comes twice as often', String(game.nextSpawn));
  void before;
  game.frenzyT = 0;
  game.lives = 3;
  const noHeart = spawnAs(0.9, 0.07);
  check(!noHeart.userData.special, 'fruit-slice: no heart fruit while you are on full lives');
  game.lives = 2;
  const heart = spawnAs(0.9, 0.07);
  check(heart.userData.special === 'heart', 'fruit-slice: a heart fruit can spawn once a life is missing');
  game.slice(heart);
  check(game.lives === 3, 'fruit-slice: slicing it gives the life back');
  const bomb = spawnAs(0.0, 0.0);
  check(bomb.userData.bomb && !bomb.userData.special, 'fruit-slice: bombs are never special');
}

// ---------- Wrecking Ball: TNT ----------
{
  const { game } = await boot('wrecking-ball');
  const b = game.blocks[12];
  for (const o of game.blocks) o.userData.tnt = false;   // no chain reactions for this one
  b.userData.tnt = true;
  const near = game.blocks.filter((o) => o !== b && o.position.distanceTo(b.position) < 3.3);
  const far = game.blocks.filter((o) => o.position.distanceTo(b.position) > 3.4);
  check(near.length >= 3 && far.length > 0, 'wrecking-ball: (setup) the block has neighbours and distant blocks');
  const before = game.score;
  game.knock(b, b.position.clone().add(new game.pivot.position.constructor(0, 0, 3)), 5);
  check(near.every((o) => !o.userData.standing), 'wrecking-ball: knocking a TNT block blows every block within reach loose');
  check(far.every((o) => o.userData.standing), 'wrecking-ball: ...and leaves distant ones alone');
  check(game.score === before + 1 + near.length, 'wrecking-ball: each one scores', `${game.score - before} vs ${1 + near.length}`);
  // a TNT block hit by the ball itself, mid-update, must not upset the loop that found it
  const u = await boot('wrecking-ball', 6);
  for (const o of u.game.blocks) o.userData.tnt = false;
  const bomb = u.game.blocks[7]; bomb.userData.tnt = true;
  const tip = new u.game.pivot.position.constructor(0, -9, 0).applyEuler(u.game.pivot.rotation).add(u.game.pivot.position);
  bomb.position.copy(tip);                        // right where the ball is
  u.input.pointer.set(-0.9, 0);
  let threw = null;
  try { u.step(40); } catch (e) { threw = e; }
  check(!threw && !bomb.userData.standing, 'wrecking-ball: a TNT block struck during a swing goes off without breaking the update loop', String(threw));
  // fresh towers: TNT is rare but present, and never leaks from a recycled block
  const t = await boot('wrecking-ball', 11);
  let tnt = 0, total = 0;
  for (let round = 0; round < 12; round++) {
    for (const blk of t.game.blocks) { tnt += blk.userData.tnt ? 1 : 0; total++; t.game.pool.push(blk); blk.userData.standing = false; }
    t.game.blocks = [];
    t.game.buildTower();
  }
  check(tnt > 0 && tnt < total * 0.25, 'wrecking-ball: roughly one block in eleven is TNT', `${tnt}/${total}`);
  check(t.game.blocks.filter((k) => !k.userData.tnt).every((k) => k.material.emissive.getHex() === 0), 'wrecking-ball: recycled blocks lose the TNT glow');
}

// ---------- Frog Hopper: the golden fly ----------
{
  const { game, step } = await boot('frog-hopper');
  game.placeFly();
  check(game.flyCell === null, 'frog-hopper: no fly while you are on full lives');
  game.lives = 2;
  game.placeFly();
  check(!!game.flyCell && [3, 6].includes(game.flyCell.row) && game.fly.visible, 'frog-hopper: with a life missing a fly appears on a safe strip');
  const cell = game.flyCell;
  game.col = cell.col; game.row = cell.row; game.hopT = 0;
  game.player.position.set((cell.col - 2) * 2, 0.45, -cell.row * 2.4);
  game.player.userData.targetX = game.player.position.x; game.player.userData.targetZ = game.player.position.z;
  step(1);
  check(game.lives === 3 && game.flyCell === null && !game.fly.visible, 'frog-hopper: catching the fly gives the life back');
  game.lives = 2; game.placeFly(); const c1 = { ...game.flyCell };
  game.placeFly();
  check(game.flyCell.col === c1.col && game.flyCell.row === c1.row, 'frog-hopper: only one fly at a time');
  game.hit();
  check(game.lives === 1, 'frog-hopper: (a hit costs a life as before)');
}

// ---------- Artillery Duel: sliding targets + spare shells ----------
{
  const { game, step } = await boot('artillery-duel');
  game.hits = 5;
  const real = Math.random;
  Math.random = () => 0.1;                   // < 0.4: slide
  game.spawnTarget();
  Math.random = real;
  const mover = game.targets[game.targets.length - 1];
  check(!!mover.userData.slide, 'artillery-duel: after a few hits new targets can slide');
  const x0 = mover.position.x;
  step(60);
  check(Math.abs(mover.position.x - x0) > 0.5 && mover.userData.marker.position.x === mover.position.x, 'artillery-duel: sliding targets move (and their ground marker follows)');
  game.hits = 0;
  Math.random = () => 0.1;
  game.spawnTarget();
  Math.random = real;
  check(!game.targets[game.targets.length - 1].userData.slide, 'artillery-duel: none slide at the start');
  // bullseye = spare shell
  const t = game.targets[0];
  game.shellsLeft = 5;
  game.hit(t, 0, 0.5);
  check(game.shellsLeft === 6, 'artillery-duel: a bullseye earns a spare shell');
  game.shellsLeft = 5;
  game.hit(game.targets[0], 0, 3.0);
  check(game.shellsLeft === 5, 'artillery-duel: an ordinary hit does not');
  game.shellsLeft = 14;
  game.hit(game.targets[0], 0, 0.5);
  check(game.shellsLeft === 15, 'artillery-duel: spare shells can take you up to 15');
  game.shellsLeft = 15;
  game.hit(game.targets[0], 0, 0.5);
  check(game.shellsLeft === 15, 'artillery-duel: ...and never beyond 15');
}

// ---------- Hurdle Runner: coins ----------
{
  const { game, step, result } = await boot('hurdle-runner');
  const drop = (high) => {
    const c = game.coinPool.pop();
    c.userData = { high };
    c.position.set(game.player.position.x, high ? 2.4 : 1.0, game.player.position.z);
    c.visible = true;
    game.coinLive.push(c);
    return c;
  };
  drop(false);
  step(1);
  check(game.bonus === 10 && game.coinLive.length === 0, 'hurdle-runner: a ground-level coin is +10 m');
  const hi = drop(true);
  step(1);
  check(game.bonus === 10 && game.coinLive.includes(hi), 'hurdle-runner: a high coin cannot be reached from the ground');
  game.player.position.y = 2.3; game.velY = 0;
  step(1);
  check(game.bonus === 20, 'hurdle-runner: ...but a jump collects it');
  const o = game.pool.pop(); o.visible = true; o.scale.set(1, 0.6, 1);
  o.position.set(game.player.position.x, 0.4, game.player.position.z); o.userData = { bar: false }; game.live.push(o);
  game.player.position.y = 0.75;
  step(1);
  check(result.ended && result.ended.score >= 20, 'hurdle-runner: coins count towards the final distance', JSON.stringify(result.ended));
  let coins = 0;
  const b = await boot('hurdle-runner', 4);
  for (let i = 0; i < 100; i++) { b.game.coinLive.forEach((c) => { c.visible = false; b.game.coinPool.push(c); }); b.game.coinLive.length = 0; b.game.spawnRow(); coins += b.game.coinLive.length; b.game.live.forEach((x) => { x.visible = false; b.game.pool.push(x); }); b.game.live.length = 0; }
  check(coins > 15 && coins < 70, 'hurdle-runner: a coin turns up with a bit under half of the rows', `${coins}/100`);
}

// ---------- Free Throw: money ball ----------
{
  const { game } = await boot('free-throw');
  const shot = (money) => ({ userData: { vel: new game.spot.constructor(), money }, position: game.spot.clone() });
  game.shots.push(game.add(game.ballMesh.clone()));
  const fake = (money) => { const m = game.add(game.ballMesh.clone()); m.userData = { vel: game.spot.clone().multiplyScalar(0), money }; game.shots.push(m); return game.shots.length - 1; };
  void shot;
  game.shots.length = 0;
  const pts = game.points;
  game.make(...(() => { const i = fake(false); return [game.shots[i], i]; })());
  check(game.streak === 1 && game.score === pts, 'free-throw: a normal make scores its points and starts a streak');
  const pts2 = game.points;
  game.make(...(() => { const i = fake(false); return [game.shots[i], i]; })());
  check(game.streak === 2 && game.ballMesh.material.color.getHex() === 0xffe066, 'free-throw: after two makes the next ball is gold');
  const t0 = game.timeLeft, s0 = game.score, pts3 = game.points;
  const idx = fake(true);
  game.make(game.shots[idx], idx);
  check(game.score === s0 + pts3 * 2, 'free-throw: a money ball is worth double', `${game.score - s0} vs ${pts3 * 2}`);
  check(game.timeLeft > t0 + 4.9, 'free-throw: ...and adds 5 seconds');
  check(game.streak === 0, 'free-throw: ...then the streak starts over');
  void pts2;
  game.streak = 2;
  const j = fake(true);
  game.miss(game.shots[j], j);
  check(game.streak === 0, 'free-throw: a miss breaks the streak');
  game.streak = 2; game.newSpot();
  game.power = 0.8; game.fire();
  check(game.shots[game.shots.length - 1].userData.money === true, 'free-throw: the ball fired with a streak of two is the money ball');
}

// ---------- Plate Spinner: calm pulse ----------
{
  const { game } = await boot('plate-spinner');
  const live = game.slots.filter((s) => s.active);
  live.forEach((s) => { s.wobble = 0.9; });
  for (let i = 0; i < 5; i++) game.save(live[0]);
  check(game.saveStreak === 5 && live[1].wobble === 0.9, 'plate-spinner: five saves in a row change nothing yet');
  game.save(live[0]);
  check(game.saveStreak === 6 && live[1].wobble <= 0.3 && live[2].wobble <= 0.3, 'plate-spinner: the sixth calms every plate');
  live[1].wobble = 1.0;
  game.drop(live[1]);
  check(game.saveStreak === 0, 'plate-spinner: a dropped plate resets the streak');
  const before = game.slots.map((s) => s.wobble);
  game.save(live[0]);
  check(game.slots.every((s, i) => s.wobble === before[i] || s === live[0]), 'plate-spinner: (and the pulse has not fired again)');
}

// ---------- Grapple Gap: slingshot anchors + safety net ----------
{
  const { game, step, result } = await boot('grapple-gap');
  const slings = game.anchors.filter((a) => a.userData.sling);
  check(slings.length === Math.floor(22 / 5) && game.anchors.indexOf(slings[0]) === 4, 'grapple-gap: every fifth anchor is a slingshot', `${slings.length}`);
  const plain = game.anchors[0];
  const boostOf = (anchor) => {
    game.player.position.copy(anchor.position).add(new game.player.position.constructor(-0.2, 0, 0));
    game.grounded = false; game.vel.set(0, 0, 0);
    game.grapple = { anchor, dir: new game.player.position.constructor(1, 0, 0) };
    step(1);
    return game.vel.length();
  };
  const normal = boostOf(plain);
  const sling = boostOf(slings[0]);
  check(sling > normal * 1.5, 'grapple-gap: a slingshot flings you much harder', `${normal.toFixed(1)} vs ${sling.toFixed(1)}`);
  // safety net
  const b = await boot('grapple-gap', 3);
  b.game.player.position.set(7.5, -11, 0);
  b.game.grounded = false;
  b.step(1);
  check(!b.result.ended && b.game.net === 0, 'grapple-gap: the first fall is caught by the net');
  check(b.game.player.position.y >= 0.9 && b.game.grounded, 'grapple-gap: ...and puts you back on a platform');
  b.game.player.position.set(7.5, -11, 0);
  b.step(1);
  check(!!b.result.ended, 'grapple-gap: the second fall ends the run');
  // the net comes back as you progress
  const c = await boot('grapple-gap', 2);
  c.game.net = 0;
  for (const plat of c.game.platforms.slice(1, 7)) {
    c.game.player.position.set(plat.userData.x0 + 1, 1.0, 0);
    c.game.vel.set(0, -1, 0);
    c.step(1);
  }
  check(c.game.net === 1, 'grapple-gap: reaching six more platforms restores the net', `net ${c.game.net}, passed ${c.game.platformsPassed}`);
}

// ---------- Skeet Range: gold clays + decoys ----------
{
  const { game } = await boot('skeet-range');
  const launch = (roll) => {
    const real = Math.random; const seq = [0.1, 0.9, 0.5, roll]; let i = 0;   // launcher choice, no second launcher, the speed roll, then the kind roll
    Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    game.launchPair();
    Math.random = real;
    return game.live[game.live.length - 1];
  };
  const gold = launch(0.05);
  check(gold.userData.kind === 'gold', 'skeet-range: a gold clay can launch');
  game.misses = 4;
  game.shoot(gold);
  check(game.hits === 3 && game.misses === 2, 'skeet-range: shooting it counts 3 and forgives 2 misses', `${game.hits} hits, ${game.misses} misses`);
  game.hits = 0;
  const early = launch(0.15);
  check(early.userData.kind === 'clay', 'skeet-range: no decoys until you have a few hits');
  game.hits = 5;
  const decoy = launch(0.15);
  check(decoy.userData.kind === 'decoy', 'skeet-range: later, red decoys appear');
  game.misses = 1;
  game.shoot(decoy);
  check(game.misses === 3 && game.hits === 5, 'skeet-range: shooting a decoy costs 2 misses and scores nothing');
  const decoy2 = launch(0.15);
  decoy2.position.y = 0.05; decoy2.userData.vel.y = -5;
  game.misses = 1;
  game.update(1 / 60);
  check(game.misses === 1, 'skeet-range: a decoy that falls is not a miss');
  const clay = launch(0.5);
  clay.position.y = 0.05; clay.userData.vel.y = -5;
  game.update(1 / 60);
  check(game.misses === 2, 'skeet-range: a clay that falls is a miss');
}

// ---------- Arena Fighter: super strike ----------
{
  const { game, step, input } = await boot('arena-fighter');
  game.player.position.set(0.6, 1.3, 0); game.cpu.position.set(-0.6, 1.3, 0);
  game.cpuCd = 99;
  game.time = 1.5;                            // (the rival is not blocking around here)
  const hp0 = game.cpuHP;
  game.playerAttack = { kind: { name: 'punch', windup: 0.1, reach: 0.9, arm: 0.55, dmg: 6, knock: 3, cd: 0.35 }, t: 0, dealt: false };
  step(20);
  check(game.rage > 5 && game.cpuHP < hp0, 'arena-fighter: landing a punch charges the super meter');
  input.press('KeyL');
  step(1);
  check(game.playerAttack === null || game.playerAttack.kind.name !== 'super', 'arena-fighter: L does nothing until the meter is full');
  game.rage = 100; game.cpuHP = 100; game.playerAttack = null; game.punchCd = game.kickCd = 0;
  game.player.position.set(0.6, 1.3, 0); game.cpu.position.set(-0.6, 1.3, 0);
  input.release();
  input.press('KeyL');
  step(1);
  check(game.playerAttack?.kind.name === 'super' && game.rage === 0, 'arena-fighter: with a full meter L throws the super strike and empties it');
  input.release();
  step(30);
  check(game.cpuHP <= 100 - 25, 'arena-fighter: the super strike hits for about 30', String(game.cpuHP));
  // blocked: mostly goes through
  game.cpuHP = 100; game.cpuBlocking = true; game.cpuCd = 99;
  game.player.position.set(0.6, 1.3, 0); game.cpu.position.set(-0.6, 1.3, 0);
  game.rage = 100; game.playerAttack = null; game.punchCd = game.kickCd = 0;
  input.press('KeyL'); step(1); input.release();
  game.cpuBlocking = true;
  const before = game.cpuHP;
  for (let i = 0; i < 30; i++) { game.cpuBlocking = true; step(1); }
  check(before - game.cpuHP >= 15, 'arena-fighter: a block only soaks part of a super strike', String(before - game.cpuHP));
  check(game.rage <= 100, 'arena-fighter: the meter never exceeds 100');
}

// ---------- Orbit Dodge: gold + chrono stars ----------
{
  const { game, step } = await boot('orbit-dodge');
  const make = (roll) => {
    const real = Math.random; let i = 0; const seq = [roll]; Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    game.addStar(); Math.random = real;
    return game.stars[game.stars.length - 1];
  };
  const gold = make(0.05), chrono = make(0.14), plain = make(0.5);
  check(gold.userData.kind === 'gold' && chrono.userData.kind === 'chrono' && plain.userData.kind === 'star', 'orbit-dodge: gold, chrono and ordinary stars all spawn');
  const put = (star) => { star.userData.radius = game.radius; star.userData.angle = game.angle; star.position.copy(game.ship.position); };
  game.stars.length = 0; game.stars.push(gold); game.scene.add(gold);
  put(gold);
  const c0 = game.collected;
  step(1);
  check(game.collected === c0 + 3, 'orbit-dodge: a gold star counts 3', String(game.collected - c0));
  game.stars.push(chrono); game.scene.add(chrono); put(chrono);
  const ring = game.rings[0];
  step(1);
  check(game.slowT > 4, 'orbit-dodge: a chrono star starts 5 seconds of slow debris');
  const p0 = ring.phase;
  step(60);
  const slowMove = Math.abs(ring.phase - p0);
  game.slowT = 0;
  const p1 = ring.phase;
  step(60);
  const fastMove = Math.abs(ring.phase - p1);
  check(slowMove < fastMove * 0.6, 'orbit-dodge: ...and the rings really turn slower while it lasts', `${slowMove.toFixed(2)} vs ${fastMove.toFixed(2)}`);
}

finish('extras');
