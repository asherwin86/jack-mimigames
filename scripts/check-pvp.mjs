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

const PORT = 9931 + ((Math.random() * 500) | 0);
const DATA_FILE = path.join(os.tmpdir(), `bc-pvp-check-${process.pid}.json`);
let failures = 0;
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label.padEnd(60)} ${detail}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(extra = []) {
  const child = spawn(process.execPath, ['server/blockcraft-server.mjs', String(PORT), 'pvpseed', ...extra], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATA_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  return child;
}

/** A client that records everything it's sent, with wait-for-predicate. */
async function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
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
  send({ t: 'hello', name });
  const welcome = await wait((m) => m.t === 'welcome');
  return { ws, all, wait, send, welcome, id: welcome.id, count: (t) => all.filter((m) => m.t === t).length };
}

let server = startServer(['--pvp']);
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

  server = startServer(['--pvp']);   // note: no seed word this time … but same positional one is fine
  await sleep(600);
  const c = await client('Cy');
  ok('after a restart the same world is served', c.welcome.seed === seed1);
  ok('after a restart earlier block edits are replayed', c.welcome.edits.some(([x, y, z, id]) => x === 7 && y === 9 && z === -3 && id === 11));
  c.ws.close();
} catch (e) {
  ok(e.message, false);
  console.log(server.log);
} finally {
  server.kill();
  try { fs.unlinkSync(DATA_FILE); } catch { /* not created */ }
}

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll PvP server checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
