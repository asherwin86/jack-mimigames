/**
 * Drives the real server in --pvp mode with plain WebSocket clients: hearts,
 * reach and cooldown checks, spawn protection, knockback direction, death /
 * scoring / respawn, health regeneration — plus the "left running" upkeep:
 * the HTTP health endpoint and saving the world across a restart.
 *
 *   node scripts/check-pvp.mjs        (takes ~25s: it waits out real timers)
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { calibrateHeight, heightAt } from '../src/engine/terrainHeight.js';

const PORT = 9931 + ((Math.random() * 500) | 0);
const DATA_FILE = path.join(os.tmpdir(), `bc-pvp-check-${process.pid}.json`);
let failures = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(60)} ${detail}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(extra = [], port = PORT, dataFile = DATA_FILE, env = {}) {
  const child = spawn(process.execPath, ['server/blockcraft-server.mjs', String(port), 'pvpseed', ...extra], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATA_FILE: dataFile, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  return child;
}

/** A client that records everything it's sent, with wait-for-predicate. */
async function client(name, port = PORT, extraHello = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const all = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    all.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  await new Promise((r) => ws.once('open', r));
  const wait = (pred, ms = 4000) => {
    const seen = all.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  };
  const send = (o) => ws.send(JSON.stringify(o));
  send({ t: 'hello', name, ...extraHello });
  const welcome = await wait((m) => m.t === 'welcome');
  return { ws, all, wait, send, welcome, id: welcome.id, count: (t) => all.filter((m) => m.t === t).length };
}

let server = startServer(['--pvp', '--bots=0']);   // bots off here: these checks are about two people fighting
try {
  await sleep(500);

  const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  ok('HTTP /health answers for uptime monitors', health.ok === true && health.mode === 'pvp', JSON.stringify(health));

  const a = await client('Ann');
  const b = await client('Bob');
  ok('welcome says this is a PvP server with 20 hp', a.welcome.pvp === true && a.welcome.hp === 20 && a.welcome.maxHp === 20);
  ok('a later joiner is told everyone\'s hearts', b.welcome.players[0].hp === 20 && b.welcome.players[0].kills === 0);

  a.send({ t: 'move', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  b.send({ t: 'move', x: 2, y: 0, z: 0, yaw: 0, pitch: 0 });
  await sleep(200);

  // Fresh joiners are spawn-protected, so the first swing does nothing.
  a.send({ t: 'hit', target: b.id });
  await sleep(300);
  ok('a spawn-protected player can\'t be hit', a.count('hurt') === 0 && b.count('hurt') === 0);

  await sleep(3000);   // let Bob's protection lapse
  a.send({ t: 'hit', target: b.id, w: 'sword' });
  const hurtB = await b.wait((m) => m.t === 'hurt');
  const hurtSeenByA = await a.wait((m) => m.t === 'hurt');
  ok('a sword hit takes three hearts (20 → 14)', hurtB.hp === 14, `hp ${hurtB.hp}`);
  ok('everyone is told about the hit', hurtSeenByA.id === b.id && hurtSeenByA.by === a.id);
  ok('knockback pushes the victim away from the attacker', hurtB.kx > 5 && Math.abs(hurtB.kz) < 0.001, `kx ${hurtB.kx}`);

  a.send({ t: 'hit', target: b.id });   // straight away — inside the cooldown
  await sleep(250);
  ok('swinging faster than the cooldown is ignored', b.count('hurt') === 1);

  await sleep(400);
  b.send({ t: 'move', x: 30, y: 0, z: 0, yaw: 0, pitch: 0 });
  await sleep(150);
  a.send({ t: 'hit', target: b.id });
  await sleep(250);
  ok('a hit from out of reach is ignored', b.count('hurt') === 1);
  a.send({ t: 'hit', target: a.id });   // hitting yourself
  a.send({ t: 'hit', target: 'nobody' });
  await sleep(150);
  ok('hitting yourself or a stranger does nothing', a.count('hurt') === 1);

  // Hearts come back slowly when you've stayed out of trouble.
  const healed = await b.wait((m) => m.t === 'health' && m.id === b.id, 10000);
  ok('hearts regenerate after a quiet spell', healed.hp === 15, `hp ${healed.hp}`);

  // Bare hands are weaker: a punch is one heart.
  b.send({ t: 'move', x: 2, y: 0, z: 0, yaw: 0, pitch: 0 });
  await sleep(150);
  a.send({ t: 'hit', target: b.id });
  const punch = await b.wait((m) => m.t === 'hurt' && m.hp === 13);
  ok('a bare-handed punch takes one heart (15 → 13)', punch.hp === 13, `hp ${punch.hp}`);
  await sleep(500);

  // Now finish him off with the sword.
  let died = null;
  for (let i = 0; i < 6 && !died; i++) {
    a.send({ t: 'hit', target: b.id, w: 'sword' });
    await sleep(520);
    died = a.all.find((m) => m.t === 'died');
  }
  ok('enough hits kill the player', !!died && died.id === b.id && died.by === a.id);
  ok('the kill is scored (killer +1 kill, victim +1 death)', died?.byKills === 1 && died?.deaths === 1);
  ok('everyone hears about the death, with names', b.all.some((m) => m.t === 'died' && m.byName === 'Ann' && m.name === 'Bob'));

  b.send({ t: 'hit', target: a.id });
  await sleep(250);
  ok('a dead player can\'t attack', !a.all.some((m) => m.t === 'hurt' && m.id === a.id));

  const respawn = await b.wait((m) => m.t === 'respawn', 5000);
  ok('the victim respawns with full hearts', respawn.id === b.id && respawn.hp === 20);
  const hurtsBefore = b.count('hurt');
  await sleep(600);   // past Ann's swing cooldown
  a.send({ t: 'hit', target: b.id });
  await sleep(300);
  ok('a fresh respawn is protected from being hit', b.count('hurt') === hurtsBefore);

  // --- upkeep: block edits survive a restart, seed included
  a.send({ t: 'edit', x: 7, y: 9, z: -3, b: 11 });
  await sleep(200);
  const seed1 = a.welcome.seed;
  a.ws.close(); b.ws.close();
  await sleep(200);
  server.kill('SIGTERM');   // a graceful stop must flush the world to DATA_FILE
  await new Promise((r) => server.once('exit', r));
  ok('SIGTERM writes the data file', fs.existsSync(DATA_FILE));

  server = startServer(['--pvp', '--bots=0']);
  await sleep(600);
  const c = await client('Cy');
  ok('after a restart the same world is served', c.welcome.seed === seed1);
  ok('after a restart earlier block edits are replayed', c.welcome.edits.some(([x, y, z, id]) => x === 7 && y === 9 && z === -3 && id === 11));
  c.ws.close();

  // --- the bow: long reach, damage scales with the draw, its own cooldown
  const e = await client('Archer');
  const f = await client('Target');
  e.send({ t: 'move', x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  f.send({ t: 'move', x: 40, y: 0, z: 0, yaw: 0, pitch: 0 });
  await sleep(3300);   // spawn protection over
  e.send({ t: 'hit', target: f.id, w: 'bow', c: 1 });
  const b1 = await f.wait((m) => m.t === 'hurt' && m.id === f.id);
  ok('a full-draw arrow hits from 40 blocks for three hearts', b1.hp === 14, `hp ${b1.hp}`);
  ok('an arrow shoves far less than a sword', Math.abs(b1.kx) < 4.5 && b1.kx > 0, `kx ${b1.kx}`);
  e.send({ t: 'hit', target: f.id, w: 'bow', c: 1 });
  await sleep(250);
  ok('shooting faster than the bow allows is ignored', f.count('hurt') === 1);
  await sleep(500);
  e.send({ t: 'hit', target: f.id, w: 'bow', c: 0.5 });
  const b2 = await f.wait((m) => m.t === 'hurt' && m.id === f.id && m.hp < 14);
  ok('a half draw does less (2 hearts)', b2.hp === 10, `hp ${b2.hp}`);
  await sleep(600);
  f.send({ t: 'move', x: 100, y: 0, z: 0, yaw: 0, pitch: 0 });
  await sleep(150);
  e.send({ t: 'hit', target: f.id, w: 'bow', c: 1 });
  await sleep(300);
  ok('an arrow from beyond bow range is ignored', f.count('hurt') === 2);
  e.send({ t: 'shoot', x: 0, y: 1.6, z: 0, vx: 60, vy: 0, vz: 0 });
  const arrow = await f.wait((m) => m.t === 'arrow');
  ok('other players are shown the arrow flying', arrow.id === e.id && arrow.vx === 60);
  e.send({ t: 'shoot', x: 0, y: 1.6, z: 0, vx: 60, vy: 0, vz: 0 });
  await sleep(100);
  ok('shots are rate limited', f.count('arrow') === 1);
  await sleep(300);
  e.send({ t: 'shoot', x: 0, y: 1.6, z: 0, vx: 500, vy: 0, vz: 0 });
  await sleep(150);
  ok('an impossibly fast shot is dropped', f.count('arrow') === 1);
  e.ws.close(); f.ws.close();
} catch (e) {
  ok(e.message, false);
  console.log(server.log);
} finally {
  server.kill();
  try { fs.unlinkSync(DATA_FILE); } catch { /* not created */ }
}

// ------------------------------------------------------------------ AI bots
{
  const BPORT = PORT + 1;
  const bots = startServer(['--pvp', '--bots=2'], BPORT, '', { MAX_BOTS: '6' });
  try {
    await sleep(700);
    const hp = await (await fetch(`http://127.0.0.1:${BPORT}/health`)).json();
    ok('no bots run while the arena is empty', hp.bots === 0, JSON.stringify(hp));

    const me = await client('Human', BPORT, { level: 'extreme' });
    ok('welcome says bots are on, echoes the level and the default count', me.welcome.bots === true && me.welcome.level === 'extreme' && me.welcome.botCount === 2);
    await sleep(400);
    const joinsOf = (c) => c.all.filter((m) => m.t === 'join' && /\[bot\]/.test(m.name));
    ok('a player who does not choose gets the default number of bots', joinsOf(me).length === 2, `${joinsOf(me).length} bots joined`);
    ok('bots look like players (id, name, colour)', joinsOf(me).every((j) => /^bot\d+$/.test(j.id) && j.color));

    // Stand on land at spawn; the bots should walk to us and start swinging.
    const groundAtSpawn = heightAt(0, 0, me.welcome.seed, calibrateHeight(me.welcome.seed)) + 1;   // the same ground the server's bots walk on
    const stand = () => me.send({ t: 'move', x: 0.5, y: groundAtSpawn, z: 0.5, yaw: 0, pitch: 0 });
    stand();
    const iv = setInterval(stand, 200);
    const botMoves = () => me.all.filter((m) => m.t === 'move' && /^bot/.test(m.id));
    const first = () => botMoves().find((m) => m.id === joinsOf(me)[0].id);
    await sleep(600);
    const d0 = Math.hypot(first().x - 0.5, first().z - 0.5);
    ok('bots move (they are broadcast like any player)', botMoves().length > 3);

    const hurt1 = await me.wait((m) => m.t === 'hurt' && m.id === me.id && /^bot/.test(m.by), 25000).catch(() => null);
    ok('a bot walks up and hits the human', !!hurt1, hurt1 ? `hp ${hurt1.hp}` : 'never hit');
    ok('an EXTREME bot hits hard (3 hearts)', hurt1?.hp === 14, `hp ${hurt1?.hp}`);
    const lastB = [...botMoves()].reverse().find((m) => m.id === joinsOf(me)[0].id);
    ok('the bot closed the distance', Math.hypot(lastB.x - 0.5, lastB.z - 0.5) < d0, `${d0.toFixed(1)} → ${Math.hypot(lastB.x - 0.5, lastB.z - 0.5).toFixed(1)}`);

    // Drop to super easy: hits now do one half-heart.
    me.send({ t: 'level', level: 'supereasy' });
    await sleep(300);
    const before = me.all.filter((m) => m.t === 'hurt' && m.id === me.id).length;
    let sample = null;
    for (let i = 0; i < 120 && !sample; i++) {
      await sleep(250);
      const hits = me.all.filter((m) => m.t === 'hurt' && m.id === me.id);
      if (hits.length > before + 1) {
        const [a, b] = hits.slice(-2);
        if (a.hp - b.hp > 0) sample = a.hp - b.hp;
      }
    }
    ok('super easy bots only take half a heart', sample === 1, `hit for ${sample}`);

    // Humans hit bots too: swing at the nearest one until it drops.
    const nearestBot = () => {
      const last = (id) => [...me.all].reverse().find((m) => m.t === 'move' && m.id === id);
      return joinsOf(me).map((j) => ({ id: j.id, m: last(j.id) })).filter((x) => x.m)
        .sort((a, b) => Math.hypot(a.m.x - 0.5, a.m.z - 0.5) - Math.hypot(b.m.x - 0.5, b.m.z - 0.5))[0]?.id;
    };
    let killed = null;
    for (let i = 0; i < 14 && !killed; i++) {
      me.send({ t: 'hit', target: nearestBot(), w: 'sword' });
      await sleep(520);
      killed = me.all.find((m) => m.t === 'died' && /^bot/.test(m.id) && m.by === me.id);
    }
    ok('a human can kill a bot (and is credited)', !!killed && killed.byKills >= 1, killed ? `${killed.name} died` : 'no kill');
    const back = await me.wait((m) => m.t === 'respawn' && /^bot/.test(m.id), 6000).catch(() => null);
    ok('a killed bot respawns', !!back);

    // ---- choosing how many: 0 to 50, within the server-wide cap (6 here)
    const leavesBefore = me.count('leave');
    me.send({ t: 'bots', n: 0 });
    const zero = await me.wait((m) => m.t === 'bots' && m.have === 0);
    await sleep(200);
    ok('choosing 0 bots removes them all', zero.want === 0 && me.count('leave') - leavesBefore === 2, `${me.count('leave') - leavesBefore} left`);
    const joinsBefore = joinsOf(me).length;
    me.send({ t: 'bots', n: 999 });
    const capped = await me.wait((m) => m.t === 'bots' && m.want === 50);
    await sleep(300);
    ok('asking for more than 50 is clamped to 50, then held to the server cap', capped.have === 6, `want ${capped.want}, have ${capped.have}`);
    ok('the bots that were added really appear', joinsOf(me).length - joinsBefore === 6);

    // A second player: the cap is used up, so they wait; then frees up when the first asks for fewer.
    const two = await client('Second', BPORT, { bots: 0 });
    ok('a player can ask for zero bots at join', two.welcome.botCount === 0);
    two.send({ t: 'bots', n: 3 });
    const none = await two.wait((m) => m.t === 'bots' && m.want === 3);
    ok('with the server full a new request is told how many it really got', none.have === 0, `have ${none.have}`);
    me.send({ t: 'bots', n: 2 });
    const freed = await two.wait((m) => m.t === 'bots' && m.want === 3 && m.have === 3, 4000).catch(() => null);
    ok('when the first player asks for fewer, the second gets theirs', !!freed);
    await sleep(300);

    // Bots belong to their player: standing right next to the first player's bots
    // as a second player, you are never their target.
    me.send({ t: 'level', level: 'extreme' });
    const standTwo = () => two.send({ t: 'move', x: 0.6, y: groundAtSpawn, z: 0.5, yaw: 0, pitch: 0 });
    const iv2 = setInterval(standTwo, 200);
    two.send({ t: 'level', level: 'supereasy' });
    const myHurtsBefore = me.all.filter((m) => m.t === 'hurt' && m.id === me.id).length;
    await sleep(9000);
    const myHurts = me.all.filter((m) => m.t === 'hurt' && m.id === me.id).length - myHurtsBefore;
    const twoHurtBy = two.all.filter((m) => m.t === 'hurt' && m.id === two.id && /^bot/.test(m.by));
    ok('the first player\'s bots keep attacking their own player', myHurts > 0, `${myHurts} hits`);
    const foreignBots = new Set(two.welcome.players.filter((p) => /\[bot\]/.test(p.name)).map((p) => p.id));   // the first player's bots, already there when this one joined
    ok('...and a second player standing beside them is never their target', foreignBots.size > 0 && twoHurtBy.every((m) => !foreignBots.has(m.by)), `${foreignBots.size} foreign bots, ${twoHurtBy.length} hits on the second player`);
    clearInterval(iv); clearInterval(iv2);

    me.ws.close(); two.ws.close();
    await sleep(500);
    const hp2 = await (await fetch(`http://127.0.0.1:${BPORT}/health`)).json();
    ok('bots leave with their player', hp2.bots === 0, JSON.stringify(hp2));
  } catch (e) {
    ok(e.message, false);
    console.log(bots.log);
  } finally {
    bots.kill();
  }
}

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll PvP server checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
