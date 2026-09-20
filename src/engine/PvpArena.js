/**
 * The PvP + AI-bot game logic of Blockcraft, in one transport-agnostic piece.
 *
 * It's used in two places: the standalone Node server (server/blockcraft-server.mjs,
 * which feeds it WebSocket clients) and the game itself (src/games/blockcraft.js,
 * which runs one in the browser/desktop app for a PvP world — solo, or hosted for
 * friends over WebRTC). It never touches the network: whoever creates it supplies
 * `deliver(playerId, message)` to send a message to one human, and calls the
 * on*() methods when a human's messages arrive. It owns players' hearts, damage,
 * knockback, armour and absorption, death/respawn/scoring, health regeneration,
 * the bow, loot drops and pickups, and the AI bots (which walk the real terrain,
 * generated from the seed by src/engine/terrainHeight.js).
 */
import { SEA as SEA_LEVEL, calibrateHeight, heightAt } from './terrainHeight.js';

export const MAX_BOTS_PER_PLAYER = 50;
export const clampBots = (n) => Math.max(0, Math.min(MAX_BOTS_PER_PLAYER, Math.floor(Number(n)) || 0));
const finite = (n) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };

// PvP tuning. Health is in half-hearts: 20 = ten hearts.
export const MAX_HP = 20;
export const FIST_DAMAGE = 2;           // bare hands: one heart a hit
export const SWORD_DAMAGE = 6;          // the sword: three hearts a hit → four hits to kill
const HIT_COOLDOWN_MS = 450;     // per attacker
const HIT_REACH = 5.0;           // client reach is 3.6; the extra allows for lag in the last-known positions
const RESPAWN_MS = 3000;
export const SPAWN_PROTECT_MS = 3000;   // can't be hit just after (re)spawning; attacking ends it early
const REGEN_AFTER_MS = 6000;     // hearts creep back once you've gone this long without being hit…
const REGEN_EVERY_MS = 2000;     // …one half-heart per this
const KNOCKBACK = 7;

// Loot: killing a bot can drop something to pick up (walk over it). Armour cuts
// the damage you take (10% per piece, up to four); golden apples heal and add
// "absorption" hearts that soak damage first; enchanted ones add far more.
// Absorption and armour are lost on death. LOOT_FORCE=armor|golden|enchanted
// (or a comma-separated list to cycle through) makes every kill drop that
// kind (used by the tests).
const ARMOR_MAX = 4;
const ARMOR_REDUCTION = 0.1;
const ABSORB_MAX = 20;
const GOLDEN_ABSORB = 4;         // two extra hearts
const ENCHANTED_ABSORB = 16;     // eight extra hearts
const DROP_CHANCES = [['armor', 0.35], ['golden', 0.30], ['enchanted', 0.06]];   // the rest of the time: nothing
const DROP_LIFE_MS = 90000;
const MAX_DROPS = 80;
const PICKUP_RADIUS = 1.7;
const ARMOR_PIECES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
// The bow: damage scales with how far it was drawn (2 half-hearts at a quick
// snap, 6 — same as the sword — at full draw). It reaches much further than a
// swing, but fires slower, and shoots less of a shove.
export const BOW_MIN_DAMAGE = 2;
export const BOW_MAX_DAMAGE = 6;
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
//   bow      how it shoots: [min, max] ms between arrows, how far it draws (0-1), and how far off it aims (blocks at the target)
//   notice   how close you have to get before it spots you and charges (until then it just wanders;
//            it gives up again if you get 1.8x this far away)
//   kb       how much knockback it takes (1 = normal)
const BOT_TICK_MS = 100;
const BOT_BOW_MIN_RANGE = 6;      // closer than this a bot puts the bow away and swings
const BOT_BOW_MAX_RANGE = 55;
const BOT_BOW = { reach: 90, key: 'lastBowAt', cooldown: 0, kb: 0.5 };   // bots pace their own shots; handleHit still applies protection and scoring
const BOT_SPAWN_MIN = 28;         // bots appear at least this far from their player (just outside the furthest they can notice you)
const BOT_WANDER_SPEED = 1.3;    // an unaware bot just strolls around
export const LEVELS = {
  supereasy: { speed: 1.6, damage: 1, swing: [2500, 3500], reach: 2.2, accuracy: 0.35, weave: 0.0, bow: { every: [7000, 10000], charge: 0.35, spread: 4.0 }, notice: 10, kb: 1.8 },
  easy:    { speed: 2.4, damage: 2, swing: [1500, 2300], reach: 2.6, accuracy: 0.55, weave: 0.0, bow: { every: [5000, 7500], charge: 0.5, spread: 2.5 }, notice: 14, kb: 1.4 },
  medium:  { speed: 3.6, damage: 4, swing: [900, 1500],  reach: 3.0, accuracy: 0.85, weave: 0.55, bow: { every: [3200, 5000], charge: 0.7, spread: 1.4 }, notice: 18, kb: 1.0 },
  hard:    { speed: 4.8, damage: 5, swing: [650, 1000],  reach: 3.2, accuracy: 0.95, weave: 0.8, bow: { every: [2200, 3200], charge: 0.9, spread: 0.7 }, notice: 22, kb: 0.7 },
  extreme: { speed: 6.0, damage: 6, swing: [470, 620],   reach: 3.5, accuracy: 1.0,  weave: 1.0, bow: { every: [1300, 1900], charge: 1.0, spread: 0.2 }, notice: 26, kb: 0.35 },
};
export const validLevel = (l) => (typeof l === 'string' && Object.hasOwn(LEVELS, l) ? l : null);
export const BOT_NAMES = ['Blaze', 'Creeper', 'Zed', 'Pixel', 'Nova', 'Ghost', 'Rusty', 'Bolt', 'Mango', 'Pip', 'Onyx', 'Twig', 'Echo', 'Moss', 'Ember', 'Fizz'];

export const COLORS = ['#ff5a50', '#5ad1ff', '#ffd83f', '#7fd94a', '#c77dff', '#ff9ecb', '#66ffcf', '#ffa64d'];

/**
 * @param {object} o
 * @param {number} o.seed          world seed (bots walk this terrain)
 * @param {boolean} [o.pvp=true]   false = players are tracked but nobody can be hurt and no bots run
 * @param {number} [o.botsDefault=3]  bots per player who hasn't chosen
 * @param {number} [o.maxBots=60]  ceiling on bots across everyone
 * @param {string} [o.defaultLevel='medium']
 * @param {string[]} [o.lootForce] force drop kinds (tests)
 * @param {(id:string, msg:object)=>void} o.deliver  send `msg` to human `id`
 * @param {(line:string)=>void} [o.log]
 */
export function createArena({ seed, pvp = true, botsDefault = 3, maxBots = 60, defaultLevel = 'medium', lootForce = [], deliver, log = () => {} }) {
  const PVP = !!pvp;
  const MAX_BOTS = PVP ? Math.max(0, Math.floor(maxBots) || 0) : 0;
  const BOTS_DEFAULT = clampBots(botsDefault);
  if (!validLevel(defaultLevel)) defaultLevel = 'medium';
  const TERRAIN = calibrateHeight(seed);   // once: the height curve this seed's ground is fitted to
  const players = new Map();   // id -> { conn (null for a bot), name, color, skin, x, y, z, yaw, pitch, hp, dead, kills, deaths, isBot, ... }
  let forcedIndex = 0;
  let timers = [];

  /** To every human except `fromId` (pass null for everyone). */
  function broadcast(fromId, msg) {
    for (const [pid, p] of players) {
      if (pid === fromId || p.isBot) continue;
      deliver(pid, msg);
    }
  }
  const broadcastAll = (msg) => broadcast(null, msg);

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

    // Armour trims the hit, then absorption hearts soak up what's left before real hearts do.
    const dealt = Math.max(1, Math.round(damage * (1 - ARMOR_REDUCTION * (victim.armor || 0))));
    const soaked = Math.min(victim.absorb || 0, dealt);
    victim.absorb = (victim.absorb || 0) - soaked;
    victim.hp = Math.max(0, victim.hp - (dealt - soaked));
    victim.lastHurtAt = now;
    const horiz = Math.hypot(dx, dz) || 1;
    if (victim.isBot) { victim.kx = (dx / horiz) * KNOCKBACK * kind.kb * (LEVELS[victim.fightLevel]?.kb ?? 1); victim.kz = (dz / horiz) * KNOCKBACK * kind.kb * (LEVELS[victim.fightLevel]?.kb ?? 1); }
    broadcastAll({
      t: 'hurt', id: targetId, by: attackerId, hp: victim.hp, ab: victim.absorb || 0, ar: victim.armor || 0,
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
    if (victim.isBot && !attacker.isBot) maybeDrop(victim);
    victim.respawnTimer = setTimeout(() => {
      victim.respawnTimer = null;
      if (!players.has(targetId)) return;
      victim.dead = false;
      victim.hp = MAX_HP;
      victim.armor = 0;      // gear and absorption are lost on death
      victim.absorb = 0;
      victim.protectUntil = Date.now() + SPAWN_PROTECT_MS;
      if (victim.isBot) Object.assign(victim, botSpawnPoint(players.get(victim.owner)), { kx: 0, kz: 0 });
      broadcastAll({ t: 'respawn', id: targetId, hp: MAX_HP, ab: 0, ar: 0 });
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

  /* ------------------------------------------------------------------ loot */

  const drops = new Map();   // id -> { id, kind, x, y, z, expires }
  let nextDropId = 1;

  function maybeDrop(bot) {
    let kind = lootForce.length ? lootForce[forcedIndex++ % lootForce.length] : null;
    if (!kind && !lootForce.length) {
      let r = Math.random();
      for (const [k, p] of DROP_CHANCES) { if (r < p) { kind = k; break; } r -= p; }
    }
    if (!kind) return;
    const id = `d${nextDropId++}`;
    const drop = { id, kind, x: bot.x, y: bot.y, z: bot.z, expires: Date.now() + DROP_LIFE_MS };
    drops.set(id, drop);
    while (drops.size > MAX_DROPS) {   // oldest goes first
      const oldest = drops.keys().next().value;
      drops.delete(oldest);
      broadcastAll({ t: 'pickup', id: oldest, by: null });
    }
    broadcastAll({ t: 'drop', id, kind, x: drop.x, y: drop.y, z: drop.z });
  }

  /** Anyone alive who walks over a drop picks it up (armour only if they have
   *  room for another piece; apples always). */
  function checkPickups() {
    const now = Date.now();
    for (const [id, d] of drops) {
      if (now > d.expires) { drops.delete(id); broadcastAll({ t: 'pickup', id, by: null }); continue; }
      for (const [pid, p] of players) {
        if (p.isBot || p.dead) continue;
        if (Math.hypot(p.x - d.x, p.z - d.z) > PICKUP_RADIUS || Math.abs(p.y - d.y) > 2.5) continue;
        let piece = null;
        if (d.kind === 'armor') {
          if ((p.armor || 0) >= ARMOR_MAX) continue;   // full set already: leave it for someone else
          piece = ARMOR_PIECES[p.armor || 0];
          p.armor = (p.armor || 0) + 1;
        } else {
          p.hp = MAX_HP;
          p.absorb = Math.min(ABSORB_MAX, (p.absorb || 0) + (d.kind === 'enchanted' ? ENCHANTED_ABSORB : GOLDEN_ABSORB));
        }
        drops.delete(id);
        broadcastAll({ t: 'pickup', id, by: pid, kind: d.kind, piece });
        deliver(pid, { t: 'gear', hp: p.hp, ab: p.absorb || 0, ar: p.armor || 0 });
        log(`${p.name} picked up ${piece ?? d.kind}`);
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ bots */

  let nextBotId = 1;

  /** Ground level a bot stands at for a world column: the top of the terrain. */
  const groundY = (x, z) => heightAt(Math.floor(x), Math.floor(z), seed, TERRAIN) + 1;

  /** A random dry-land point on a ring around `near` (a player) — or world
   *  spawn if there isn't one — where a bot starts and reappears. It's a good
   *  way off (at least BOT_SPAWN_MIN blocks) so the player has time to go and
   *  find their bots, and the ring widens with the number of bots so a crowd
   *  doesn't all stack on one spot. */
  function botSpawnPoint(near) {
    const cx = near ? near.x : 0.5;
    const cz = near ? near.z : 0.5;
    const spread = 12 + Math.min(30, (near?.botsHave || 0) * 0.6);
    for (let i = 0; i < 40; i++) {   // keep trying until it lands on dry ground
      const a = Math.random() * Math.PI * 2;
      const r = BOT_SPAWN_MIN + Math.random() * spread;
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
      hp: MAX_HP, dead: false, kills: 0, deaths: 0, kx: 0, kz: 0, phase: Math.random() * 6.28, fightLevel: defaultLevel,
      lastHitAt: 0, lastHurtAt: 0, nextSwingIn: 0, protectUntil: Date.now() + SPAWN_PROTECT_MS, respawnTimer: null,
      sentX: NaN, sentZ: NaN, sentYaw: NaN, alerted: false, nextShotIn: 1500, wanderTo: null, wanderWait: Math.random() * 3000, walkT: 0,
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
      if (!p.isBot && p.notifiedBots !== `${p.wantBots}/${p.botsHave}`) {
        p.notifiedBots = `${p.wantBots}/${p.botsHave}`;
        deliver(id, { t: 'bots', want: p.wantBots, have: p.botsHave });
      }
    }
  }

  /* Bot arrows are simulated here (gravity, ground, the owner's body) in real
   * time, and relayed to everyone as ordinary 'arrow' messages so they see the
   * same flight the server is resolving. */
  const botArrows = [];
  const ARROW_G = 20;

  /** True if the straight line from a to b stays above the ground — terrain only
   *  (the server doesn't know about blocks players have built). */
  function clearShot(a, b) {
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      if (y < groundY(x, z) - 0.2) return false;
    }
    return true;
  }

  /** Bot looses an arrow at its owner: aim for the chest, lead a moving target,
   *  compensate for drop, then blur the aim by the level's spread. */
  function botShoot(botId, bot, owner, L) {
    const ex = bot.x, ey = bot.y + 1.62, ez = bot.z;
    const speed = 20 + 40 * L.bow.charge;
    const dist = Math.hypot(owner.x - ex, owner.z - ez);
    const t = Math.max(0.05, dist / speed);
    const lead = L.bow.spread < 1 ? Math.min(t, 1) : 0;   // sharper levels predict where you're heading
    const tx = owner.x + (owner.vx || 0) * lead + (Math.random() - 0.5) * 2 * L.bow.spread;
    const tz = owner.z + (owner.vz || 0) * lead + (Math.random() - 0.5) * 2 * L.bow.spread;
    const ty = owner.y + 1.1 + 0.5 * ARROW_G * t * t + (Math.random() - 0.5) * 2 * L.bow.spread * 0.5;
    if (!clearShot({ x: ex, y: ey, z: ez }, { x: owner.x, y: owner.y + 1.1, z: owner.z })) return false;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const len = Math.hypot(dx, dy, dz) || 1;
    const vx = (dx / len) * speed, vy = (dy / len) * speed, vz = (dz / len) * speed;
    botArrows.push({ botId, ownerId: bot.owner, x: ex, y: ey, z: ez, vx, vy, vz, life: 4, dmg: Math.max(1, Math.round(L.damage * 0.75)) });
    bot.yaw = Math.atan2(-(owner.x - ex), -(owner.z - ez));
    broadcastAll({ t: 'arrow', id: botId, x: ex, y: ey, z: ez, vx, vy, vz });
    return true;
  }

  function stepBotArrows(dt) {
    const SUB = 0.005;   // 0.3 blocks per step at full speed — small enough that an arrow can't skip clean through a 0.8-wide body
    for (let i = botArrows.length - 1; i >= 0; i--) {
      const a = botArrows[i];
      const bot = players.get(a.botId);
      const owner = players.get(a.ownerId);
      let gone = !bot || !owner || bot.dead;
      for (let t = 0; t < dt && !gone; t += SUB) {
        a.vy -= ARROW_G * SUB;
        a.x += a.vx * SUB; a.y += a.vy * SUB; a.z += a.vz * SUB;
        a.life -= SUB;
        if (!owner.dead && Math.abs(a.x - owner.x) < 0.4 && Math.abs(a.z - owner.z) < 0.4 && a.y > owner.y - 0.05 && a.y < owner.y + 1.85) {
          handleHit(a.botId, bot, a.ownerId, a.dmg, BOT_BOW);
          gone = true;
        } else if (a.y <= groundY(a.x, a.z) || a.life <= 0) {
          gone = true;   // buried in the ground (or flew too long)
        }
      }
      if (gone) botArrows.splice(i, 1);
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
    stepBotArrows(dt);
    checkPickups();
    for (const [id, bot] of players) {
      if (!bot.isBot || bot.dead) continue;

      // A bot only ever fights the player who asked for it, at that player's level.
      // It doesn't know where you are until you get close (then it charges), and
      // loses interest again if you get well away — so you have to go and find it.
      const owner = players.get(bot.owner);
      const L = LEVELS[owner?.level ?? defaultLevel];
      bot.fightLevel = owner?.level ?? defaultLevel;
      let target = null;
      if (owner && !owner.dead) {
        const d = Math.hypot(owner.x - bot.x, owner.z - bot.z);
        if (!bot.alerted && d <= L.notice) {
          bot.alerted = true;
          bot.nextSwingIn = Math.max(bot.nextSwingIn, 700);   // a moment of surprise before the first swing
          bot.nextShotIn = Math.min(bot.nextShotIn, 300 + Math.random() * 500);   // ...but it draws its bow almost at once
        } else if (bot.alerted && d > L.notice * 1.8) {
          bot.alerted = false;
        }
        if (bot.alerted) target = { id: bot.owner, p: owner, d };
      } else {
        bot.alerted = false;
      }

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
        // Too far for a sword but in range: draw the bow (the closer it gets, the more it swings instead).
        bot.nextShotIn -= BOT_TICK_MS;
        if (dist >= BOT_BOW_MIN_RANGE && dist <= BOT_BOW_MAX_RANGE && bot.nextShotIn <= 0) {
          bot.nextShotIn = L.bow.every[0] + Math.random() * (L.bow.every[1] - L.bow.every[0]);
          botShoot(id, bot, target.p, L);
        }
      }

      if (!target) {
        // Unaware: amble toward a random spot nearby, pause a few seconds, pick another.
        if (bot.wanderTo) {
          bot.walkT += BOT_TICK_MS;
          if (Math.hypot(bot.wanderTo.x - bot.x, bot.wanderTo.z - bot.z) < 1 || bot.walkT > 9000) {
            bot.wanderTo = null;                       // arrived (or it's been blocked too long)
            bot.wanderWait = 1500 + Math.random() * 3500;
          }
        } else {
          bot.wanderWait -= BOT_TICK_MS;
          if (bot.wanderWait <= 0) {
            const a = Math.random() * Math.PI * 2;
            const r = 4 + Math.random() * 10;
            bot.wanderTo = { x: bot.x + Math.cos(a) * r, z: bot.z + Math.sin(a) * r };
            bot.walkT = 0;
          }
        }
        if (bot.wanderTo) {
          heading = Math.atan2(bot.wanderTo.z - bot.z, bot.wanderTo.x - bot.x);
          bot.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading));
          bot.pitch = 0;
        }
      }

      // Walk, but never into the sea and never up a wall — and if the straight
      // way is blocked, try sidestepping around it.
      if (heading !== null) {
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
          const h = heading + turn;
          const sp = target ? L.speed : BOT_WANDER_SPEED;
          const nx = bot.x + Math.cos(h) * sp * dt;
          const nz = bot.z + Math.sin(h) * sp * dt;
          if (canStep(bot, nx, nz)) { vx += Math.cos(h) * sp; vz += Math.sin(h) * sp; break; }
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


  /* ------------------------------------------------------------- public API */

  /** Registers a human. Returns their record. Call syncBots() after telling everyone. */
  function addHuman(id, { conn = null, name, color, skin = null, level, bots }) {
    const p = {
      conn, name, color, skin, x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
      hp: MAX_HP, dead: false, kills: 0, deaths: 0,
      level: validLevel(level) || defaultLevel,
      wantBots: bots === undefined ? BOTS_DEFAULT : clampBots(bots),
      botsHave: 0, armor: 0, absorb: 0,
      lastHitAt: 0, lastHurtAt: 0, protectUntil: Date.now() + SPAWN_PROTECT_MS, respawnTimer: null,
    };
    players.set(id, p);
    return p;
  }

  function removeHuman(id) {
    const p = players.get(id);
    if (p?.respawnTimer) clearTimeout(p.respawnTimer);
    players.delete(id);
    return p;
  }

  /** The PvP-related fields a welcome message needs for `id`. */
  function welcomeFields(id) {
    const p = players.get(id);
    return {
      pvp: PVP,
      bots: MAX_BOTS > 0,
      botsMax: MAX_BOTS_PER_PLAYER,
      botCount: MAX_BOTS > 0 ? (p ? p.wantBots : BOTS_DEFAULT) : 0,
      level: p ? p.level : defaultLevel,
      maxHp: MAX_HP,
      hp: MAX_HP,
      drops: [...drops.values()].map(({ id: did, kind, x, y, z }) => ({ id: did, kind, x, y, z })),
    };
  }

  /** Everyone (humans and bots) except `exceptId`, in the shape a welcome lists them. */
  function playersList(exceptId) {
    return [...players.entries()].filter(([pid]) => pid !== exceptId).map(([pid, p]) => ({
      id: pid, name: p.name, color: p.color, skin: p.skin, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
      hp: p.hp, dead: p.dead, kills: p.kills, deaths: p.deaths,
    }));
  }

  /** A human's position report. Also keeps a smoothed velocity so bots can lead a moving target. */
  function onMove(id, msg) {
    const p = players.get(id);
    if (!p) return null;
    const nowMs = Date.now();
    const dtm = (nowMs - (p.moveAt || nowMs)) / 1000;
    const nxp = finite(msg.x), nzp = finite(msg.z);
    if (dtm > 0.02 && dtm < 1) {
      const rvx = (nxp - p.x) / dtm;
      const rvz = (nzp - p.z) / dtm;
      if (Math.hypot(rvx, rvz) > 15) {   // faster than anyone can run: a teleport/respawn, not movement to lead
        p.vx = 0; p.vz = 0;
      } else {
        p.vx = 0.6 * (p.vx || 0) + 0.4 * rvx;
        p.vz = 0.6 * (p.vz || 0) + 0.4 * rvz;
      }
    }
    p.moveAt = nowMs;
    p.x = nxp; p.y = finite(msg.y); p.z = nzp;
    p.yaw = finite(msg.yaw); p.pitch = finite(msg.pitch);
    return p;
  }

  function onHit(id, msg) {
    const p = players.get(id);
    if (!p || !PVP) return;
    if (msg.w === 'bow') {
      const c = Math.min(1, Math.max(0, finite(msg.c)));
      handleHit(id, p, String(msg.target), BOW_MIN_DAMAGE + Math.round((BOW_MAX_DAMAGE - BOW_MIN_DAMAGE) * c), BOW);
    } else {
      handleHit(id, p, String(msg.target), msg.w === 'sword' ? SWORD_DAMAGE : FIST_DAMAGE);
    }
  }

  /** Relays a shot so everyone else sees the arrow fly (damage is a separate 'hit'). */
  function onShoot(id, msg) {
    const p = players.get(id);
    if (!p) return;
    const now = Date.now();
    if (p.dead || now - (p.lastShotAt || 0) < SHOOT_COOLDOWN_MS) return;
    const v = [msg.vx, msg.vy, msg.vz].map(finite);
    if (Math.hypot(...v) > ARROW_MAX_SPEED) return;
    p.lastShotAt = now;
    broadcast(id, { t: 'arrow', id, x: finite(msg.x), y: finite(msg.y), z: finite(msg.z), vx: v[0], vy: v[1], vz: v[2] });
  }

  function onLevel(id, msg) {
    const p = players.get(id);
    if (p) p.level = validLevel(msg.level) || p.level;
  }

  function onBots(id, msg) {
    const p = players.get(id);
    if (p && MAX_BOTS > 0) { p.wantBots = clampBots(msg.n); syncBots(); }
  }

  /** Starts the timers (bots, arrows, pickups every 100ms; regeneration every 2s). */
  function start() {
    stop();
    if (PVP) timers.push(setInterval(regenTick, REGEN_EVERY_MS));
    if (MAX_BOTS > 0) timers.push(setInterval(botTick, BOT_TICK_MS));
    for (const t of timers) t.unref?.();
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
    for (const p of players.values()) if (p.respawnTimer) { clearTimeout(p.respawnTimer); p.respawnTimer = null; }
  }

  return {
    players, drops, LEVELS, MAX_BOTS,
    broadcast, broadcastAll,
    addHuman, removeHuman, welcomeFields, playersList, syncBots,
    onMove, onHit, onShoot, onLevel, onBots,
    start, stop,
  };
}
