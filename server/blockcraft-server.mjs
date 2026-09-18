#!/usr/bin/env node
/**
 * Self-hosted Blockcraft multiplayer server.
 *
 * There's no accounts, matchmaking, or central service — you run this
 * yourself (on your own PC, home server, or a small VPS) and share the
 * address with whoever you want to play with. This process *is* the whole
 * backend for that session: it hands out a shared seed, relays everyone's
 * position to everyone else, and remembers every block placed or mined so
 * it can catch up anyone who joins later.
 *
 * It deliberately keeps no save file of its own — closing it ends the
 * session. Each player's own Blockcraft client still autosaves its *solo*
 * worlds exactly as before; joining a server just borrows the screen for a
 * shared one while connected.
 *
 *   node server/blockcraft-server.mjs [port] [seed]
 *
 * `port` defaults to 7443. `seed` can be any word (hashed the same way the
 * game itself hashes a typed seed) or omitted for a random one. Whoever
 * connects enters `ws://<this-machine's-address>:<port>` in the game's
 * Multiplayer panel — on the same Wi-Fi, that's usually a `192.168.x.x`
 * LAN address; reaching it over the internet means forwarding that port
 * (or tunnelling it) yourself, the same as hosting any other small server.
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2]) || 7443;
const SEED = process.argv[3] ? hashSeed(process.argv[3]) : (Math.random() * 0x7fffffff) | 0;
const BUILD_HEIGHT = 40;   // must match H in src/games/blockcraft.js
const MAX_BLOCK_ID = 17;   // highest id in BLOCKS there

const COLORS = ['#ff5a50', '#5ad1ff', '#ffd83f', '#7fd94a', '#c77dff', '#ff9ecb', '#66ffcf', '#ffa64d'];

const players = new Map();   // id -> { ws, name, color, x, y, z, yaw, pitch }
const edits = new Map();     // "x,y,z" -> block id, every edit anyone has ever made this session
let nextId = 1;

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  const id = String(nextId++);
  let joined = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      if (joined) return;
      joined = true;
      const color = COLORS[(Number(id) - 1) % COLORS.length];
      const name = String(msg.name || `Player${id}`).trim().slice(0, 16) || `Player${id}`;
      players.set(id, { ws, name, color, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

      send(ws, {
        t: 'welcome',
        id,
        seed: SEED,
        edits: [...edits.entries()].map(([key, b]) => [...key.split(',').map(Number), b]),
        players: [...players.entries()]
          .filter(([pid]) => pid !== id)
          .map(([pid, p]) => ({ id: pid, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw })),
      });
      broadcast(id, { t: 'join', id, name, color });
      log(`${name} joined (${players.size} online)`);
      return;
    }

    if (!joined) return;
    const player = players.get(id);

    if (msg.t === 'move') {
      player.x = finite(msg.x);
      player.y = finite(msg.y);
      player.z = finite(msg.z);
      player.yaw = finite(msg.yaw);
      player.pitch = finite(msg.pitch);
      broadcast(id, { t: 'move', id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch });
    } else if (msg.t === 'edit') {
      const x = msg.x | 0;
      const y = msg.y | 0;
      const z = msg.z | 0;
      const b = msg.b | 0;
      if (y < 0 || y >= BUILD_HEIGHT || b < 0 || b > MAX_BLOCK_ID) return;
      edits.set(`${x},${y},${z}`, b);
      broadcast(id, { t: 'edit', x, y, z, b });
    } else if (msg.t === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (text) broadcast(id, { t: 'chat', id, name: player.name, text });
    }
  });

  ws.on('close', () => {
    if (!joined) return;
    const player = players.get(id);
    players.delete(id);
    broadcast(id, { t: 'leave', id });
    log(`${player?.name ?? id} left (${players.size} online)`);
  });

  ws.on('error', () => { /* 'close' still follows; nothing extra to do here */ });
});

log(`Blockcraft server listening on ws://0.0.0.0:${PORT}`);
log(`World seed: ${SEED}`);
log(`Share ws://<this machine's address>:${PORT} with whoever you want to play with.`);
log('Press Ctrl+C to stop — nothing here is saved, so that ends the session for everyone.');

function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* socket already gone */ }
}

function broadcast(fromId, msg) {
  const json = JSON.stringify(msg);
  for (const [pid, p] of players) {
    if (pid === fromId) continue;
    try { p.ws.send(json); } catch { /* ignore, its own close handler will clean it up */ }
  }
}

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function log(msg) {
  console.log(`[blockcraft] ${msg}`);
}

/** Same hashing Blockcraft's own "type any word as a seed" field uses, so a
 *  server started with e.g. `node server/blockcraft-server.mjs 7443 hills`
 *  matches a client that types "hills" into a solo New World seed field. */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}
