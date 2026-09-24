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
 *   node server/blockcraft-server.mjs [port] [seed] [--pvp]
 *
 * `port` defaults to $PORT, then 7443. `seed` can be any word (hashed the
 * same way the game itself hashes a typed seed) or omitted for a random one
 * (or, if a data file exists, the seed it was last run with). Whoever
 * connects enters `ws://<this-machine's-address>:<port>` in the game's
 * Multiplayer panel — on the same Wi-Fi, that's usually a `192.168.x.x`
 * LAN address; reaching it over the internet means forwarding that port
 * (or tunnelling it) yourself, the same as hosting any other small server.
 *
 * PvP mode (`--pvp`, or PVP=1): players get hearts, can hit each other, die,
 * respawn and are scored. The server is authoritative for all of it — a
 * client only ever says "I swung at player X"; the server checks reach,
 * cooldown and spawn protection and decides what that did.
 *
 * Bots (PvP only, off unless you turn them on with --bots=N or MAX_BOTS=N): AI fighters, chosen per player. Each player picks how many
 * bots they want to play against (0 to 50) and how hard they fight (super easy /
 * easy / medium / hard / extreme). Those bots belong to that player: they chase
 * and swing at their owner only, at the owner's level, and leave with them —
 * anyone can still shoot or hit them. `--bots=N` / BOTS=N is the default count for
 * players who don't choose (3); MAX_BOTS caps the server-wide total (60 once enabled) so a few
 * players can't ask for more than the machine can run; BOT_LEVEL sets the default
 * level. Bots walk the real terrain (generated from the seed by the same code the
 * game uses) and swing through the same hit rules as everyone else — reach,
 * cooldown, spawn protection. They start 28+ blocks from their player and
 * just wander until you get close (how close depends on the level), so you have to
 * go and find them; once they've spotted you they charge, shoot arrows from range
 * (aim and rate depend on the level) and swing when they reach you.
 *
 * Loot: kill a bot and it may drop armour (each piece cuts 10% off damage taken, up
 * to four), a golden apple (full heal + two absorption hearts) or, rarely, an
 * enchanted golden apple (+eight). Walk over a drop to take it; it's all lost on death.
 *
 * Built to be left running: it answers plain HTTP on the same port (GET / or
 * /health, which is what hosting platforms poll), drops connections that stop
 * answering pings, survives stray errors instead of exiting, shuts down
 * cleanly on SIGTERM, and — when DATA_FILE is set — saves the world's seed
 * and every block edit so a restart picks up where it left off.
 * Deployment recipes live in deploy/.
 *
 * It also doubles as the public server *list*: people who host a game from
 * their browser tab or the desktop app can announce it here (POST /servers),
 * and the website reads the list back (GET /servers). Entries are just a
 * join code plus a name and player count, expire unless refreshed every
 * minute, and are capped per IP. The games themselves never pass through
 * this process — joiners connect straight to the host over WebRTC.
 */
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { H as TERRAIN_H } from '../src/engine/terrainHeight.js';
import { createArena, clampBots, MAX_BOTS_PER_PLAYER, COLORS } from '../src/engine/PvpArena.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

const PORT = Number(positional[0]) || Number(process.env.PORT) || 7443;
const PVP = flags.has('--pvp') || /^(1|true|yes)$/i.test(process.env.PVP || '');
const botsFlag = args.find((a) => a.startsWith('--bots='));
const BOTS_DEFAULT = clampBots(botsFlag ? botsFlag.slice(7) : process.env.BOTS ?? 3);   // bots per player who doesn't choose
// Bots are OFF by default on a server (the public arena has none); they switch on with
// --bots=N or MAX_BOTS. MAX_BOTS is the server-wide ceiling. Solo/hosted PvP *worlds* in the
// game run their own bots without any of this — see src/engine/PvpArena.js.
const MAX_BOTS_ENV = Math.max(0, Math.floor(Number(process.env.MAX_BOTS ?? (botsFlag !== undefined ? 60 : 0))) || 0);
const DATA_FILE = process.env.DATA_FILE || '';
const BUILD_HEIGHT = TERRAIN_H;   // shared with the game via src/engine/terrainHeight.js
const MAX_BLOCK_ID = 23;   // BLOCKS in src/games/blockcraft.js has 24 entries, indices 0-23 — id 24 is out of range and would crash a client's mesher
const MAX_SKIN_CHARS = 30000;   // must match Skin.js — a 64x64 PNG data URL is well under this
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 32;
const MAX_PAYLOAD = 64 * 1024;  // one skin plus JSON framing fits with plenty of room; nothing legit is bigger

const edits = new Map();     // "x,y,z" -> block id, every edit anyone has ever made this session
let nextId = 1;
let editsDirty = false;


const saved = loadData();
const SEED = positional[1] ? hashSeed(positional[1]) : (saved?.seed ?? ((Math.random() * 0x7fffffff) | 0));
if (saved && saved.seed === SEED) {
  for (const [k, b] of saved.edits) edits.set(k, b);
}

// The PvP + bot game logic lives in src/engine/PvpArena.js (shared with the game
// itself); this file is the network side: WebSockets in, messages out.
const LOOT_FORCE = (process.env.LOOT_FORCE || '').split(',').filter((k) => ['armor', 'golden', 'enchanted'].includes(k));   // testing: force drop kinds
const arena = createArena({
  seed: SEED,
  pvp: PVP,
  botsDefault: BOTS_DEFAULT,
  maxBots: MAX_BOTS_ENV,
  defaultLevel: process.env.BOT_LEVEL,
  lootForce: LOOT_FORCE,
  deliver: (id, msg) => { const p = arena.players.get(id); if (p?.conn) send(p.conn, msg); },
  log,
});
const players = arena.players;
const MAX_BOTS = arena.MAX_BOTS;
const humanCount = () => { let n = 0; for (const p of players.values()) if (!p.isBot) n++; return n; };

/* ------------------------------------------------- public server list */

const LISTING_TTL_MS = 75000;     // hosts re-announce about every 25s; miss a few and they drop off
const MAX_LISTINGS = 200;
const MAX_LISTINGS_PER_IP = 3;
const listings = new Map();       // join code -> { code, name, players, max, ip, seenAt }

function cleanName(s) {
  // eslint-disable-next-line no-control-regex
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 28);
}

function pruneListings() {
  const now = Date.now();
  for (const [code, l] of listings) if (now - l.seenAt > LISTING_TTL_MS) listings.delete(code);
}
setInterval(pruneListings, 15000).unref();

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

/** Reads a small JSON body (2 KB max), then calls back with the parsed object or null. */
function readJson(req, cb) {
  let raw = '';
  let dead = false;
  req.on('data', (d) => {
    raw += d;
    if (raw.length > 2048 && !dead) { dead = true; req.destroy(); cb(null); }
  });
  req.on('end', () => { if (dead) return; try { cb(JSON.parse(raw)); } catch { cb(null); } });
  req.on('error', () => { if (!dead) { dead = true; cb(null); } });
}

function reply(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const httpServer = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {   // CORS preflight for the website's fetch() calls
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }

  if (path === '/servers' && req.method === 'GET') {
    pruneListings();
    reply(res, 200, [...listings.values()]
      .sort((a, b) => b.players - a.players || b.seenAt - a.seenAt)
      .map(({ code, name, players, max }) => ({ code, name, players, max })));
    return;
  }

  if ((path === '/servers' || path === '/servers/remove') && req.method === 'POST') {
    const ip = clientIp(req);
    readJson(req, (body) => {
      const code = body && typeof body.code === 'string' ? body.code : '';
      if (!/^bc-[a-z0-9]{3,12}$/.test(code)) { reply(res, 400, { ok: false, error: 'bad code' }); return; }
      if (path === '/servers/remove') {
        if (listings.get(code)?.ip === ip) listings.delete(code);
        reply(res, 200, { ok: true });
        return;
      }
      const name = cleanName(body.name) || 'Blockcraft world';
      const max = Math.min(99, Math.max(1, Number(body.max) | 0 || 8));
      const playersNow = Math.min(max, Math.max(0, Number(body.players) | 0));
      pruneListings();
      const existing = listings.get(code);
      if (existing && existing.ip !== ip) { reply(res, 409, { ok: false, error: 'code in use' }); return; }
      const fromIp = [...listings.values()].filter((l) => l.ip === ip && l.code !== code).length;
      if (!existing && (fromIp >= MAX_LISTINGS_PER_IP || listings.size >= MAX_LISTINGS)) {
        reply(res, 429, { ok: false, error: 'too many listings' });
        return;
      }
      listings.set(code, { code, name, players: playersNow, max, ip, seenAt: Date.now() });
      reply(res, 200, { ok: true });
    });
    return;
  }

  const body = JSON.stringify({ ok: true, game: 'blockcraft', mode: PVP ? 'pvp' : 'coop', players: humanCount(), bots: players.size - humanCount(), maxPlayers: MAX_PLAYERS, listed: listings.size, uptime: Math.round(process.uptime()) });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(req.method === 'HEAD' ? undefined : body);
});
const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD });

wss.on('connection', (ws) => {
  if (humanCount() >= MAX_PLAYERS) { ws.close(1013, 'server full'); return; }
  const id = String(nextId++);
  let joined = false;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      if (joined) return;
      joined = true;
      const color = COLORS[(Number(id) - 1) % COLORS.length];
      const name = String(msg.name || `Player${id}`).trim().slice(0, 16) || `Player${id}`;
      const player = arena.addHuman(id, { conn: ws, name, color, skin: validSkin(msg.skin), level: msg.level, bots: msg.bots });

      send(ws, {
        t: 'welcome',
        id,
        seed: SEED,
        ...arena.welcomeFields(id),
        edits: [...edits.entries()].map(([key, b]) => [...key.split(',').map(Number), b]),
        players: arena.playersList(id),
      });
      arena.broadcast(id, { t: 'join', id, name, color, skin: player.skin });
      log(`${name} joined (${humanCount()} online)`);
      arena.syncBots();
      return;
    }

    if (!joined) return;
    const player = players.get(id);

    if (msg.t === 'move') {
      arena.onMove(id, msg);
      arena.broadcast(id, { t: 'move', id, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch });
    } else if (msg.t === 'skin') {
      player.skin = validSkin(msg.skin);
      arena.broadcast(id, { t: 'skin', id, skin: player.skin });
    } else if (msg.t === 'bots') {
      arena.onBots(id, msg);
    } else if (msg.t === 'level') {
      arena.onLevel(id, msg);
    } else if (msg.t === 'hit') {
      arena.onHit(id, msg);
    } else if (msg.t === 'shoot') {
      arena.onShoot(id, msg);
    } else if (msg.t === 'edit') {
      if (player.dead) return;
      const x = msg.x | 0;
      const y = msg.y | 0;
      const z = msg.z | 0;
      const b = msg.b | 0;
      if (y < 0 || y >= BUILD_HEIGHT || b < 0 || b > MAX_BLOCK_ID) return;
      edits.set(`${x},${y},${z}`, b);
      editsDirty = true;
      arena.broadcast(id, { t: 'edit', x, y, z, b });
    } else if (msg.t === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (text) arena.broadcast(id, { t: 'chat', id, name: player.name, text });
    }
  });

  ws.on('close', () => {
    if (!joined) return;
    const player = arena.removeHuman(id);
    arena.broadcast(id, { t: 'leave', id });
    log(`${player?.name ?? id} left (${humanCount()} online)`);
    arena.syncBots();
  });

  ws.on('error', () => { /* 'close' still follows; nothing extra to do here */ });
});

/* ------------------------------------------------------------ upkeep */

// Dead-connection sweep: a client that vanished without a proper close (lid
// shut, wifi dropped) would otherwise keep a ghost avatar forever.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* already gone */ }
  }
}, 30000).unref();

setInterval(saveData, 30000).unref();

// A long-running server shouldn't die to one bad message from one bad client.
process.on('uncaughtException', (err) => log(`uncaught error (continuing): ${err?.stack || err}`));
process.on('unhandledRejection', (err) => log(`unhandled rejection (continuing): ${err?.stack || err}`));

function shutdown(signal) {
  log(`${signal} — saving and shutting down`);
  arena.stop();
  saveData();
  for (const ws of wss.clients) { try { ws.close(1001, 'server restarting'); } catch { /* ignore */ } }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

arena.start();
httpServer.listen(PORT, '0.0.0.0', () => {
  log(`Blockcraft ${PVP ? 'PvP ' : ''}server listening on ws://0.0.0.0:${PORT} (health check: http://localhost:${PORT}/health)`);
  log(`World seed: ${SEED}`);
  if (MAX_BOTS > 0) log(`AI bots: each player picks 0-${MAX_BOTS_PER_PLAYER} (default ${BOTS_DEFAULT}), at most ${MAX_BOTS} on the server`);
  if (DATA_FILE) log(`Saving to ${DATA_FILE} (${edits.size} block edits loaded)`);
  else log('No DATA_FILE set — the world resets whenever this restarts.');
  log(`Share ws://<this machine's address>:${PORT} with whoever you want to play with.`);
});

/* ------------------------------------------------------------ helpers */

function send(ws, msg) {
  try { ws.send(JSON.stringify(msg)); } catch { /* socket already gone */ }
}

/** Only a small PNG data URL is ever relayed as a skin; anything else is
 *  dropped (null = the default look) rather than passed on to other players. */
function validSkin(s) {
  const PREFIX = 'data:image/png;base64,';
  return typeof s === 'string' && s.length > PREFIX.length && s.length <= MAX_SKIN_CHARS
    && s.startsWith(PREFIX) && /^[A-Za-z0-9+/]+={0,2}$/.test(s.slice(PREFIX.length)) ? s : null;
}

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function loadData() {
  if (!DATA_FILE) return null;
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (typeof d.seed === 'number' && Array.isArray(d.edits)) return d;
  } catch { /* first run, or unreadable — start fresh */ }
  return null;
}

/** Written to a temp file then renamed, so a crash mid-write can't leave a
 *  half-written world behind. */
function saveData() {
  if (!DATA_FILE || !editsDirty) return;
  try {
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ seed: SEED, edits: [...edits.entries()] }));
    fs.renameSync(tmp, DATA_FILE);
    editsDirty = false;
  } catch (err) {
    log(`could not save ${DATA_FILE}: ${err.message}`);
  }
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
