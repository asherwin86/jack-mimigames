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

finish('extras');
