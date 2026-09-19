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
 * Bots (PvP only): AI fighters, chosen per player. Each player picks how many
 * bots they want to play against (0 to 50) and how hard they fight (super easy /
 * easy / medium / hard / extreme). Those bots belong to that player: they chase
 * and swing at their owner only, at the owner's level, and leave with them —
 * anyone can still shoot or hit them. `--bots=N` / BOTS=N is the default count for
 * players who don't choose (3); MAX_BOTS caps the server-wide total (60) so a few
 * players can't ask for more than the machine can run; BOT_LEVEL sets the default
 * level. Bots walk the real terrain (generated from the seed by the same code the
 * game uses) and swing through the same hit rules as everyone else — reach,
 * cooldown, spawn protection.
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
import { H as TERRAIN_H, SEA as SEA_LEVEL, calibrateHeight, heightAt } from '../src/engine/terrainHeight.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

const PORT = Number(positional[0]) || Number(process.env.PORT) || 7443;
const PVP = flags.has('--pvp') || /^(1|true|yes)$/i.test(process.env.PVP || '');
const botsFlag = args.find((a) => a.startsWith('--bots='));
const MAX_BOTS_PER_PLAYER = 50;
const clampBots = (n) => Math.max(0, Math.min(MAX_BOTS_PER_PLAYER, Math.floor(Number(n)) || 0));
const BOTS_DEFAULT = clampBots(botsFlag ? botsFlag.slice(7) : process.env.BOTS ?? 3);   // bots per player who doesn't choose
const MAX_BOTS = PVP ? Math.max(0, Math.floor(Number(process.env.MAX_BOTS ?? 60)) || 0) : 0;   // server-wide ceiling; 0 = no bots at all
const DATA_FILE = process.env.DATA_FILE || '';
const BUILD_HEIGHT = TERRAIN_H;   // shared with the game via src/engine/terrainHeight.js
const MAX_BLOCK_ID = 16;   // BLOCKS there has 17 entries, indices 0-16 — id 17 is out of range and would crash a client's mesher
const MAX_SKIN_CHARS = 30000;   // must match Skin.js — a 64x64 PNG data URL is well under this
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 32;
const MAX_PAYLOAD = 64 * 1024;  // one skin plus JSON framing fits with plenty of room; nothing legit is bigger

// PvP tuning. Health is in half-hearts: 20 = ten hearts.
const MAX_HP = 20;
const FIST_DAMAGE = 2;           // bare hands: one heart a hit
const SWORD_DAMAGE = 6;          // the sword: three hearts a hit → four hits to kill
const HIT_COOLDOWN_MS = 450;     // per attacker
const HIT_REACH = 5.0;           // client reach is 3.6; the extra allows for lag in the last-known positions
const RESPAWN_MS = 3000;
const SPAWN_PROTECT_MS = 3000;   // can't be hit just after (re)spawning; attacking ends it early
const REGEN_AFTER_MS = 6000;     // hearts creep back once you've gone this long without being hit…
const REGEN_EVERY_MS = 2000;     // …one half-heart per this
const KNOCKBACK = 7;
// The bow: damage scales with how far it was drawn (2 half-hearts at a quick
// snap, 6 — same as the sword — at full draw). It reaches much further than a
// swing, but fires slower, and shoots less of a shove.
const BOW_MIN_DAMAGE = 2;
const BOW_MAX_DAMAGE = 6;
const BOW_REACH = 70;
const BOW_COOLDOWN_MS = 550;
const ARROW_MAX_SPEED = 70;      // a shot faster than any real draw is dropped
const SHOOT_COOLDOWN_MS = 250;   // relaying arrows for others to see is rate limited per player
const MELEE = { reach: HIT_REACH, key: 'lastHitAt', cooldown: HIT_COOLDOWN_MS, kb: 1 };
const BOW = { reach: BOW_REACH, key: 'lastBowAt', cooldown: BOW_COOLDOWN_MS, kb: 0.5 };

// Bot tuning. A bot fights at the level chosen by the human it's currently
// chasing, so one server can serve a beginner and a veteran at once.
//   speed    blocks/second (a player walks at 5.2, sprints at ~8)
//   damage   half-hearts per hit (a sword does 6)
//   swing    [min, max] ms between swings (the hit cooldown itself is 450)
//   reach    how close it gets before swinging
//   accuracy chance a swing actually lands
//   weave    how hard it strafes while closing in (harder to hit)
//   sight    how far away it notices you
//   kb       how much knockback it takes (1 = normal)
const BOT_TICK_MS = 100;
const LEVELS = {
  supereasy: { speed: 1.6, damage: 1, swing: [2500, 3500], reach: 2.2, accuracy: 0.35, weave: 0.0, sight: 25, kb: 1.8 },
  easy:    { speed: 2.4, damage: 2, swing: [1500, 2300], reach: 2.6, accuracy: 0.55, weave: 0.0, sight: 35, kb: 1.4 },
  medium:  { speed: 3.6, damage: 4, swing: [900, 1500],  reach: 3.0, accuracy: 0.85, weave: 0.55, sight: 60, kb: 1.0 },
  hard:    { speed: 4.8, damage: 5, swing: [650, 1000],  reach: 3.2, accuracy: 0.95, weave: 0.8, sight: 80, kb: 0.7 },
  extreme: { speed: 6.0, damage: 6, swing: [470, 620],   reach: 3.5, accuracy: 1.0,  weave: 1.0, sight: 100, kb: 0.35 },
};
const DEFAULT_LEVEL = Object.hasOwn(LEVELS, process.env.BOT_LEVEL) ? process.env.BOT_LEVEL : 'medium';
const validLevel = (l) => (typeof l === 'string' && Object.hasOwn(LEVELS, l) ? l : null);
const BOT_NAMES = ['Blaze', 'Creeper', 'Zed', 'Pixel', 'Nova', 'Ghost', 'Rusty', 'Bolt', 'Mango', 'Pip', 'Onyx', 'Twig', 'Echo', 'Moss', 'Ember', 'Fizz'];

const COLORS = ['#ff5a50', '#5ad1ff', '#ffd83f', '#7fd94a', '#c77dff', '#ff9ecb', '#66ffcf', '#ffa64d'];

const players = new Map();   // id -> { ws (null for a bot), name, color, skin, x, y, z, yaw, pitch, hp, dead, kills, deaths, isBot, ... }
const edits = new Map();     // "x,y,z" -> block id, every edit anyone has ever made this session
let nextId = 1;
let editsDirty = false;

const humanCount = () => { let n = 0; for (const p of players.values()) if (!p.isBot) n++; return n; };

const saved = loadData();
const SEED = positional[1] ? hashSeed(positional[1]) : (saved?.seed ?? ((Math.random() * 0x7fffffff) | 0));
if (saved && saved.seed === SEED) {
  for (const [k, b] of saved.edits) edits.set(k, b);
}
const TERRAIN = calibrateHeight(SEED);   // once: the height curve this seed's ground is fitted to

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
      players.set(id, {
        ws, name, color, skin: validSkin(msg.skin), x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
        hp: MAX_HP, dead: false, kills: 0, deaths: 0,
        level: validLevel(msg.level) || DEFAULT_LEVEL,
        wantBots: msg.bots === undefined ? BOTS_DEFAULT : clampBots(msg.bots),
        botsHave: 0,
        lastHitAt: 0, lastHurtAt: 0, protectUntil: Date.now() + SPAWN_PROTECT_MS, respawnTimer: null,
      });

      send(ws, {
        t: 'welcome',
        id,
        seed: SEED,
        pvp: PVP,
        bots: MAX_BOTS > 0,
        botsMax: MAX_BOTS_PER_PLAYER,
        botCount: players.get(id).wantBots,
        level: players.get(id).level,
        maxHp: MAX_HP,
        hp: MAX_HP,
        edits: [...edits.entries()].map(([key, b]) => [...key.split(',').map(Number), b]),
        players: [...players.entries()]
          .filter(([pid]) => pid !== id)
          .map(([pid, p]) => ({
            id: pid, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
            hp: p.hp, dead: p.dead, kills: p.kills, deaths: p.deaths,
          })),
      });
      broadcast(id, { t: 'join', id, name, color, skin: players.get(id).skin });
      log(`${name} joined (${humanCount()} online)`);
      syncBots();
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
    } else if (msg.t === 'skin') {
      player.skin = validSkin(msg.skin);
      broadcast(id, { t: 'skin', id, skin: player.skin });
    } else if (msg.t === 'bots') {
      if (MAX_BOTS > 0) { player.wantBots = clampBots(msg.n); syncBots(); }
    } else if (msg.t === 'level') {
      player.level = validLevel(msg.level) || player.level;
    } else if (msg.t === 'hit') {
      if (!PVP) return;
      if (msg.w === 'bow') {
        const c = Math.min(1, Math.max(0, finite(msg.c)));
        handleHit(id, player, String(msg.target), BOW_MIN_DAMAGE + Math.round((BOW_MAX_DAMAGE - BOW_MIN_DAMAGE) * c), BOW);
      } else {
        handleHit(id, player, String(msg.target), msg.w === 'sword' ? SWORD_DAMAGE : FIST_DAMAGE);
      }
    } else if (msg.t === 'shoot') {
      // Purely visual for everyone else: a shot is relayed so they see the
      // arrow fly. Damage never rides on this — that's a separate 'hit'.
      const now = Date.now();
      if (player.dead || now - (player.lastShotAt || 0) < SHOOT_COOLDOWN_MS) return;
      const v = [msg.vx, msg.vy, msg.vz].map(finite);
      if (Math.hypot(...v) > ARROW_MAX_SPEED) return;
      player.lastShotAt = now;
      broadcast(id, { t: 'arrow', id, x: finite(msg.x), y: finite(msg.y), z: finite(msg.z), vx: v[0], vy: v[1], vz: v[2] });
    } else if (msg.t === 'edit') {
      if (player.dead) return;
      const x = msg.x | 0;
      const y = msg.y | 0;
      const z = msg.z | 0;
      const b = msg.b | 0;
      if (y < 0 || y >= BUILD_HEIGHT || b < 0 || b > MAX_BLOCK_ID) return;
      edits.set(`${x},${y},${z}`, b);
      editsDirty = true;
      broadcast(id, { t: 'edit', x, y, z, b });
    } else if (msg.t === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (text) broadcast(id, { t: 'chat', id, name: player.name, text });
    }
  });

  ws.on('close', () => {
    if (!joined) return;
    const player = players.get(id);
    if (player?.respawnTimer) clearTimeout(player.respawnTimer);
    players.delete(id);
    broadcast(id, { t: 'leave', id });
    log(`${player?.name ?? id} left (${humanCount()} online)`);
    syncBots();
  });

  ws.on('error', () => { /* 'close' still follows; nothing extra to do here */ });
});

/* ------------------------------------------------------------------- PvP */

function handleHit(attackerId, attacker, targetId, damage, kind = MELEE) {
  const now = Date.now();
  const victim = players.get(targetId);
  if (!victim || targetId === attackerId || attacker.dead || victim.dead) return;
  if (now - (attacker[kind.key] || 0) < kind.cooldown) return;
  attacker[kind.key] = now;
  attacker.protectUntil = 0;   // swinging at someone forfeits your own spawn protection

  // Reach, from the attacker's eye to the middle of the victim, using the
  // positions each client last reported.
  const dx = victim.x - attacker.x;
  const dy = victim.y + 0.9 - (attacker.y + 1.62);
  const dz = victim.z - attacker.z;
  if (Math.hypot(dx, dy, dz) > kind.reach) return;
  if (now < victim.protectUntil) return;

  victim.hp = Math.max(0, victim.hp - damage);
  victim.lastHurtAt = now;
  const horiz = Math.hypot(dx, dz) || 1;
  if (victim.isBot) { victim.kx = (dx / horiz) * KNOCKBACK * kind.kb * (LEVELS[victim.fightLevel]?.kb ?? 1); victim.kz = (dz / horiz) * KNOCKBACK * kind.kb * (LEVELS[victim.fightLevel]?.kb ?? 1); }
  broadcastAll({
    t: 'hurt', id: targetId, by: attackerId, hp: victim.hp,
    kx: (dx / horiz) * KNOCKBACK * kind.kb, kz: (dz / horiz) * KNOCKBACK * kind.kb,
  });

  if (victim.hp > 0) return;
  victim.dead = true;
  victim.deaths++;
  attacker.kills++;
  broadcastAll({
    t: 'died', id: targetId, by: attackerId, name: victim.name, byName: attacker.name,
    deaths: victim.deaths, byKills: attacker.kills,
  });
  log(`${attacker.name} killed ${victim.name}`);
  victim.respawnTimer = setTimeout(() => {
    victim.respawnTimer = null;
    if (!players.has(targetId)) return;
    victim.dead = false;
    victim.hp = MAX_HP;
    victim.protectUntil = Date.now() + SPAWN_PROTECT_MS;
    if (victim.isBot) Object.assign(victim, botSpawnPoint(players.get(victim.owner)), { kx: 0, kz: 0 });
    broadcastAll({ t: 'respawn', id: targetId, hp: MAX_HP });
  }, RESPAWN_MS);
}

/** Hearts creep back for anyone who hasn't been hit lately. */
function regenTick() {
  const now = Date.now();
  for (const [id, p] of players) {
    if (p.dead || p.hp >= MAX_HP || now - p.lastHurtAt < REGEN_AFTER_MS) continue;
    p.hp++;
    broadcastAll({ t: 'health', id, hp: p.hp });
  }
}
if (PVP) setInterval(regenTick, REGEN_EVERY_MS).unref();

/* ------------------------------------------------------------------ bots */

let nextBotId = 1;

/** Ground level a bot stands at for a world column: the top of the terrain. */
const groundY = (x, z) => heightAt(Math.floor(x), Math.floor(z), SEED, TERRAIN) + 1;

/** A random dry-land point on a ring around `near` (a player) — or world
 *  spawn if there isn't one — where a bot starts and reappears. The ring
 *  widens with the number of bots so a crowd doesn't all stack on one spot. */
function botSpawnPoint(near) {
  const cx = near ? near.x : 0.5;
  const cz = near ? near.z : 0.5;
  const spread = 14 + Math.min(30, (near?.botsHave || 0) * 0.6);
  for (let i = 0; i < 40; i++) {   // keep trying until it lands on dry ground
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * spread;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    if (groundY(x, z) - 1 >= SEA_LEVEL) return { x, z, y: groundY(x, z) };
  }
  return { x: cx, z: cz, y: groundY(cx, cz) };
}

const botsOf = (ownerId) => [...players].filter(([, p]) => p.isBot && p.owner === ownerId).map(([id]) => id);

function addBot(ownerId) {
  const owner = players.get(ownerId);
  const id = `bot${nextBotId++}`;
  const base = BOT_NAMES[(nextBotId - 2) % BOT_NAMES.length];
  const lap = Math.floor((nextBotId - 2) / BOT_NAMES.length);
  const name = `${base}${lap ? ` ${lap + 1}` : ''} [bot]`;
  const color = COLORS[(nextBotId - 1) % COLORS.length];
  const at = botSpawnPoint(owner);
  players.set(id, {
    ws: null, isBot: true, owner: ownerId, name, color, skin: null, x: at.x, y: at.y, z: at.z, yaw: 0, pitch: 0,
    hp: MAX_HP, dead: false, kills: 0, deaths: 0, kx: 0, kz: 0, phase: Math.random() * 6.28, fightLevel: DEFAULT_LEVEL,
    lastHitAt: 0, lastHurtAt: 0, nextSwingIn: 0, protectUntil: Date.now() + SPAWN_PROTECT_MS, respawnTimer: null,
    sentX: NaN, sentZ: NaN, sentYaw: NaN,
  });
  broadcast(id, { t: 'join', id, name, color, skin: null });
  return id;
}

function removeBot(id) {
  const bot = players.get(id);
  if (!bot?.isBot) return;
  if (bot.respawnTimer) clearTimeout(bot.respawnTimer);
  players.delete(id);
  broadcast(id, { t: 'leave', id });
}

/** Gives every player the bots they asked for, within the server-wide cap:
 *  players are served in join order, so if the ceiling is hit the later ones
 *  get fewer (they're told how many they actually have). Bots whose owner has
 *  gone are removed, and nothing runs at all while the arena is empty. */
function syncBots() {
  if (MAX_BOTS <= 0) return;
  for (const [id, p] of [...players]) if (p.isBot && !players.has(p.owner)) removeBot(id);
  let room = MAX_BOTS;
  for (const [id, p] of players) {
    if (p.isBot) continue;
    const want = Math.min(p.wantBots, room);
    room -= want;
    const mine = botsOf(id);
    p.botsHave = mine.length;   // (the spawn ring widens with this)
    while (mine.length > want) removeBot(mine.pop());
    while (mine.length < want) { mine.push(addBot(id)); p.botsHave = mine.length; }
    p.botsHave = mine.length;
    if (p.ws && p.notifiedBots !== `${p.wantBots}/${p.botsHave}`) {
      p.notifiedBots = `${p.wantBots}/${p.botsHave}`;
      send(p.ws, { t: 'bots', want: p.wantBots, have: p.botsHave });
    }
  }
}

/** Whether a bot can step to (nx, nz): dry land, and not a wall. */
function canStep(bot, nx, nz) {
  const gy = groundY(nx, nz);
  return gy - 1 >= SEA_LEVEL && gy - groundY(bot.x, bot.z) <= 2;
}

function botTick() {
  const dt = BOT_TICK_MS / 1000;
  const now = Date.now();
  for (const [id, bot] of players) {
    if (!bot.isBot || bot.dead) continue;

    // A bot only ever fights the player who asked for it, at that player's level.
    const owner = players.get(bot.owner);
    let target = null;
    if (owner && !owner.dead) {
      const d = Math.hypot(owner.x - bot.x, owner.z - bot.z);
      if (d <= LEVELS[owner.level].sight) target = { id: bot.owner, p: owner, d };
    }
    const L = LEVELS[target ? target.p.level : DEFAULT_LEVEL];
    bot.fightLevel = target ? target.p.level : DEFAULT_LEVEL;

    let vx = bot.kx;   // knockback carries on and fades
    let vz = bot.kz;
    bot.kx *= 0.7;
    bot.kz *= 0.7;

    let heading = null;   // direction the bot wants to walk in (radians in the x/z plane)
    if (target) {
      const dx = target.p.x - bot.x;
      const dz = target.p.z - bot.z;
      const dist = target.d || 1;
      bot.yaw = Math.atan2(-dx, -dz);
      bot.pitch = Math.max(-1, Math.min(1, Math.atan2((target.p.y + 1.2) - (bot.y + 1.62), dist)));
      const base = Math.atan2(dz, dx);
      if (dist > L.reach - 0.8) {
        // Close in, weaving so it isn't a straight line (harder levels weave more).
        heading = base + (dist < 10 ? Math.sin(now / 420 + bot.phase) * 0.7 * L.weave : 0);
      } else if (dist < 1.2) {
        heading = base + Math.PI;   // too close: back off a step
      }
      bot.nextSwingIn -= BOT_TICK_MS;
      if (dist <= L.reach && bot.nextSwingIn <= 0) {
        bot.nextSwingIn = L.swing[0] + Math.random() * (L.swing[1] - L.swing[0]);
        if (Math.random() < L.accuracy) handleHit(id, bot, target.id, L.damage);
      }
    }

    // Walk, but never into the sea and never up a wall — and if the straight
    // way is blocked, try sidestepping around it.
    if (heading !== null) {
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
        const h = heading + turn;
        const nx = bot.x + Math.cos(h) * L.speed * dt;
        const nz = bot.z + Math.sin(h) * L.speed * dt;
        if (canStep(bot, nx, nz)) { vx += Math.cos(h) * L.speed; vz += Math.sin(h) * L.speed; break; }
      }
    }
    const nx = bot.x + vx * dt;
    const nz = bot.z + vz * dt;
    if (canStep(bot, nx, nz)) { bot.x = nx; bot.z = nz; }
    bot.y += (groundY(bot.x, bot.z) - bot.y) * Math.min(1, dt * 12);

    // Only tell everyone when it actually moved or turned — with dozens of bots,
    // idle ones shouldn't cost bandwidth.
    if (Math.abs(bot.x - bot.sentX) > 0.02 || Math.abs(bot.z - bot.sentZ) > 0.02 || Math.abs(bot.yaw - bot.sentYaw) > 0.02 || bot.y !== bot.sentY) {
      bot.sentX = bot.x; bot.sentZ = bot.z; bot.sentYaw = bot.yaw; bot.sentY = bot.y;
      broadcastAll({ t: 'move', id, x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw, pitch: bot.pitch });
    }
  }
}
if (MAX_BOTS > 0) setInterval(botTick, BOT_TICK_MS).unref();

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
  saveData();
  for (const ws of wss.clients) { try { ws.close(1001, 'server restarting'); } catch { /* ignore */ } }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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

function broadcast(fromId, msg) {
  const json = JSON.stringify(msg);
  for (const [pid, p] of players) {
    if (pid === fromId) continue;
    if (!p.ws) continue;   // a bot: nothing to send to
    try { p.ws.send(json); } catch { /* ignore, its own close handler will clean it up */ }
  }
}

/** Like broadcast(), but to everyone — the player a message is about needs it too. */
function broadcastAll(msg) {
  broadcast(null, msg);
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
