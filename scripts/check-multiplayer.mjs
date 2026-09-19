/**
 * Spins up the real Blockcraft server (server/blockcraft-server.mjs) as a
 * child process and drives it with two plain WebSocket clients speaking its
 * JSON protocol directly — no browser or three.js needed to exercise the
 * server itself. Confirms: the shared seed, join/welcome/leave broadcasts,
 * position relay, edit relay + replay-on-join, and basic input validation.
 *
 *   node scripts/check-multiplayer.mjs
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 8931 + ((Math.random() * 1000) | 0);
let failures = 0;

function ok(label, cond, detail = '') {
  const tag = cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${label.padEnd(48)} ${detail}`);
  if (!cond) failures++;
}

function waitFor(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

/** Waits for the next message of a given type, buffering others (and every
 *  message ever seen, in `all`) so a later expect() doesn't race an earlier
 *  one, and so a test can assert something was *never* sent. */
function makeReader(ws) {
  const queue = [];
  const all = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    all.push(msg);
    const w = waiters.find((w) => w.type === msg.t);
    if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    else queue.push(msg);
  });
  const expect = (type, timeoutMs = 2000) => {
    const i = queue.findIndex((m) => m.t === type);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for '${type}'`)), timeoutMs);
      waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  };
  return { expect, all };
}

const server = spawn(process.execPath, ['server/blockcraft-server.mjs', String(PORT), 'testseed'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

try {
  // Give it a moment to bind the port.
  await new Promise((r) => setTimeout(r, 400));

  const url = `ws://127.0.0.1:${PORT}`;
  const a = new WebSocket(url);
  await waitFor(a, 'open');
  const readA = makeReader(a);
  a.send(JSON.stringify({ t: 'hello', name: 'Alice' }));
  const welcomeA = await readA.expect('welcome');

  ok('server assigns a seed from the given word', typeof welcomeA.seed === 'number' && welcomeA.seed !== 0);
  ok('first player sees an empty edit log', Array.isArray(welcomeA.edits) && welcomeA.edits.length === 0);
  ok('first player sees no other players yet', Array.isArray(welcomeA.players) && welcomeA.players.length === 0);

  // Alice places a block before Bob joins.
  a.send(JSON.stringify({ t: 'edit', x: 3, y: 5, z: -2, b: 9 }));
  await new Promise((r) => setTimeout(r, 150));   // let the server record it

  const b = new WebSocket(url);
  await waitFor(b, 'open');
  const readB = makeReader(b);
  b.send(JSON.stringify({ t: 'hello', name: 'Bob' }));
  const [welcomeB, joinSeenByA] = await Promise.all([readB.expect('welcome'), readA.expect('join')]);

  ok('second player gets the same seed', welcomeB.seed === welcomeA.seed, `${welcomeB.seed} vs ${welcomeA.seed}`);
  ok('second player sees Alice already there', welcomeB.players.some((p) => p.name === 'Alice'));
  ok('second player is replayed the earlier edit', welcomeB.edits.some(([x, y, z, id]) => x === 3 && y === 5 && z === -2 && id === 9), JSON.stringify(welcomeB.edits));
  ok('the first player is told a second one joined', joinSeenByA.name === 'Bob');

  // Bob moves; Alice should see it relayed.
  b.send(JSON.stringify({ t: 'move', x: 10, y: 20, z: -30, yaw: 1.2, pitch: 0.1 }));
  const move = await readA.expect('move');
  ok('a move is relayed to the other player', move.x === 10 && move.y === 20 && move.z === -30, JSON.stringify(move));
  ok('the move is attributed to the right player id', move.id === welcomeB.id);

  // Bob edits; Alice should see it relayed live too.
  b.send(JSON.stringify({ t: 'edit', x: -8, y: 12, z: 4, b: 15 }));
  const edit = await readA.expect('edit');
  ok('a live edit is relayed to the other player', edit.x === -8 && edit.y === 12 && edit.z === 4 && edit.b === 15);

  // Bob says something; Alice should see it relayed with his name attached,
  // but Bob himself should NOT get it echoed back.
  const readBforEcho = makeReader(b);
  b.send(JSON.stringify({ t: 'chat', text: 'gg' }));
  const chat = await readA.expect('chat');
  ok('a chat message is relayed with the sender\'s name', chat.name === 'Bob' && chat.text === 'gg', JSON.stringify(chat));
  b.send(JSON.stringify({ t: 'move', x: 2, y: 2, z: 2, yaw: 0, pitch: 0 }));   // sentinel
  await readA.expect('move');
  ok('a chat message is never echoed back to its own sender', !readBforEcho.all.some((m) => m.t === 'chat'));

  // An empty or absurdly long chat message shouldn't get relayed verbatim —
  // the server trims and caps it rather than trusting the client.
  // (Reusing readA rather than spinning up another makeReader(a): a second
  // listener on the same socket would still see every later message too,
  // but never drain its own queue via expect() — leaving stale entries that
  // a later readA.expect() could resolve against instead of the message
  // actually being waited for.)
  b.send(JSON.stringify({ t: 'chat', text: '  ' }));                 // blank after trimming
  b.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(500) }));      // way over the cap
  b.send(JSON.stringify({ t: 'move', x: 3, y: 3, z: 3, yaw: 0, pitch: 0 }));   // sentinel
  await readA.expect('move');
  const chatsSeen = readA.all.filter((m) => m.t === 'chat');
  ok('a blank chat message is not relayed', !chatsSeen.some((m) => m.text === ''));
  ok('an over-long chat message is capped, not relayed verbatim',
    chatsSeen.every((m) => m.text.length <= 140), `longest seen: ${Math.max(0, ...chatsSeen.map((m) => m.text.length))}`);

  // Out-of-range edits should be silently dropped, not crash the server or
  // reach the other player.
  b.send(JSON.stringify({ t: 'edit', x: 0, y: 999, z: 0, b: 3 }));
  b.send(JSON.stringify({ t: 'move', x: 1, y: 1, z: 1, yaw: 0, pitch: 0 }));   // a sentinel that *should* arrive
  await readA.expect('move');   // wait for the sentinel to land, then check nothing snuck in ahead of it
  ok('an out-of-range edit is dropped, not relayed', !readA.all.some((m) => m.t === 'edit' && m.y === 999));

  // Block id 17 is one past the last real block (BLOCKS has 17 entries, ids
  // 0-16) — a client meshing an id that far out of range would crash, so the
  // server must reject it rather than just cap at "some big number".
  b.send(JSON.stringify({ t: 'edit', x: 5, y: 5, z: 5, b: 17 }));
  b.send(JSON.stringify({ t: 'edit', x: 6, y: 6, z: 6, b: 16 }));   // the actual highest valid id — should go through
  b.send(JSON.stringify({ t: 'move', x: 9, y: 9, z: 9, yaw: 0, pitch: 0 }));   // sentinel
  await readA.expect('move');
  const edits17vs16 = readA.all.filter((m) => m.t === 'edit' && (m.x === 5 || m.x === 6));
  ok('block id 17 (one past the last real block) is rejected', !edits17vs16.some((m) => m.b === 17));
  ok('block id 16 (the actual highest valid block) is accepted', edits17vs16.some((m) => m.b === 16));

  // Skins: a small PNG data URL is relayed (in join, in later welcomes, and on
  // live changes); anything else is dropped to null rather than passed along.
  const GOOD_SKIN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const c = new WebSocket(url);
  await waitFor(c, 'open');
  const readC = makeReader(c);
  c.send(JSON.stringify({ t: 'hello', name: 'Cara', skin: GOOD_SKIN }));
  const welcomeC = await readC.expect('welcome');
  const joinC = await readA.expect('join');
  ok('a valid skin is relayed in the join broadcast', joinC.skin === GOOD_SKIN);
  const d = new WebSocket(url);
  await waitFor(d, 'open');
  const readD = makeReader(d);
  d.send(JSON.stringify({ t: 'hello', name: 'Dan', skin: 'data:text/html;base64,PHNjcmlwdD4=' }));
  const welcomeD = await readD.expect('welcome');
  ok('a later joiner is replayed earlier players\' skins', welcomeD.players.find((p) => p.name === 'Cara')?.skin === GOOD_SKIN);
  ok('a non-PNG skin is dropped, not relayed', welcomeD.players.every((p) => p.name !== 'Dan') && (await readC.expect('join')).skin === null);
  d.send(JSON.stringify({ t: 'skin', skin: GOOD_SKIN }));
  ok('a live skin change is broadcast to others', (await readC.expect('skin')).skin === GOOD_SKIN);
  d.send(JSON.stringify({ t: 'skin', skin: 'data:image/png;base64,' + 'A'.repeat(40000) }));
  ok('an oversized skin change becomes null', (await readC.expect('skin')).skin === null);
  c.close(); d.close();

  // Bob leaves; Alice should be told.
  b.close();
  let leave = await readA.expect('leave');
  while (leave.id !== welcomeB.id) leave = await readA.expect('leave');   // skip Cara's and Dan's earlier departures
  ok('a disconnect is broadcast as leave', leave.id === welcomeB.id);

  a.close();
  await new Promise((r) => setTimeout(r, 100));
} catch (error) {
  ok(error.message, false);
  console.log(serverLog);
} finally {
  server.kill();
}

console.log(failures ? `\n\x1b[31m${failures} check(s) failed.\x1b[0m` : '\n\x1b[32mAll multiplayer server checks passed.\x1b[0m');
process.exit(failures ? 1 : 0);
