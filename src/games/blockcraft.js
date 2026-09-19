import * as THREE from 'three';
import { Game } from '../engine/Game.js';
import { sky, clamp, damp, seeded, lerp, invLerp, rand, Burst } from '../engine/utils.js';
import {
  isValidSkinData, importSkinFile, skinToDataURL, skinFromDataURL, defaultSkinCanvas, buildSkinnedPlayer, drawSkinPreview,
} from '../engine/Skin.js';

/* ------------------------------------------------------------------ world */

const CHUNK = 16;
const H = 40;                     // build height
const SEA = 12;
const REACH = 6;                  // how far you can break / place

// The world has no edge: chunks generate on demand as the player walks and
// unload behind them, exactly like real Minecraft. View distance controls
// how many chunks out (in every direction) stay loaded at once.
const VIEW_DISTANCES = [
  { chunks: 3, label: 'S' },
  { chunks: 5, label: 'M' },
  { chunks: 7, label: 'L' },
];
const DEFAULT_VIEW_DIST = 5;
const UNLOAD_MARGIN = 2;          // chunks of hysteresis so walking back and forth at the
                                   // edge of view distance doesn't load/unload the same chunk repeatedly
const VIEW_DIST_KEY = 'mg.blockcraft.viewDist';

// Every world gets its own storage slot, so a player can keep several going
// at once: WORLDS_KEY is a small index (name/seed, not the terrain) and
// ACTIVE_KEY says which one to continue automatically next time. Since
// terrain regenerates identically from its seed, only the chunks a player
// actually changed need to be saved — everything else regrows for free.
const WORLDS_KEY = 'mg.blockcraft.worlds.v1';
const ACTIVE_KEY = 'mg.blockcraft.active.v1';
const worldDataKey = (id) => `mg.blockcraft.world.${id}`;
const SAVE_INTERVAL = 20;         // seconds between autosaves, only while something changed

// Multiplayer talks to a small self-hosted relay (see server/blockcraft-server.mjs)
// over a plain WebSocket, JSON messages. There's no matchmaking or accounts —
// whoever's hosting shares their address, everyone else types it in.
const MP_NAME_KEY = 'mg.blockcraft.playerName';
const MP_SERVER_KEY = 'mg.blockcraft.lastServer';
const MP_SKIN_KEY = 'mg.blockcraft.skin';   // the player's imported skin, as a small PNG data URL
const NET_MOVE_INTERVAL = 0.1;    // seconds between position updates sent to the server
// The always-on public PvP server (see deploy/). The Multiplayer panel gets a
// one-click "Join PvP Arena" button for it; a build can point elsewhere with
// VITE_PVP_SERVER=wss://… (an empty value hides the button).
const PVP_SERVER_URL = (import.meta.env && import.meta.env.VITE_PVP_SERVER) ?? 'wss://blockcraft-pvp.onrender.com';
// The public server list lives on the same always-on server (see server/blockcraft-server.mjs):
// hosts announce a join code there, everyone else reads the list back.
const REGISTRY_URL = PVP_SERVER_URL.replace(/^ws/i, 'http').replace(/\/+$/, '');
const MP_LIST_KEY = 'mg.blockcraft.listPublic';
const ANNOUNCE_EVERY_MS = 25000;
const ATTACK_REACH = 3.6;         // how far a swing at another player reaches
const ATTACK_COOLDOWN = 0.45;     // seconds between swings (the server enforces its own)

// id -> { name, tiles: [top, side, bottom], solid, alpha }
const BLOCKS = [
  null,
  { name: 'Grass',    tiles: [0, 1, 2] },
  { name: 'Dirt',     tiles: [2, 2, 2] },
  { name: 'Stone',    tiles: [3, 3, 3] },
  { name: 'Sand',     tiles: [4, 4, 4] },
  { name: 'Log',      tiles: [6, 5, 6] },
  { name: 'Leaves',   tiles: [7, 7, 7] },
  { name: 'Water',    tiles: [12, 12, 12], solid: false, alpha: true },
  { name: 'Planks',   tiles: [8, 8, 8] },
  { name: 'Brick',    tiles: [9, 9, 9] },
  { name: 'Cobble',   tiles: [10, 10, 10] },
  { name: 'Glass',    tiles: [11, 11, 11], alpha: true },
  { name: 'Gold Ore', tiles: [13, 13, 13] },
  { name: 'Snow',     tiles: [14, 14, 14] },
  { name: 'Obsidian', tiles: [15, 15, 15] },
  { name: 'Coal Ore', tiles: [16, 16, 16] },
  { name: 'Iron Ore', tiles: [17, 17, 17] },
];
const AIR = 0;
const WATER = 7;
const SWORD = 'sword';   // the one non-block hotbar entry — see updateSword() and interact()
const HOTBAR = [SWORD, 1, 3, 10, 8, 9, 5, 6, 4, 11];

// Colours handed out to joining players — same palette server/blockcraft-server.mjs
// uses, so a player's dot/avatar colour doesn't depend on which kind of
// server they happened to join.
const HOST_COLORS = ['#ff5a50', '#5ad1ff', '#ffd83f', '#7fd94a', '#c77dff', '#ff9ecb', '#66ffcf', '#ffa64d'];

// Seconds of holding to break each block. Anything unlisted takes 0.6s.
const HARDNESS = {
  1: 0.45, 2: 0.4, 3: 1.1, 4: 0.35, 5: 0.8, 6: 0.12, 8: 0.7,
  9: 1.0, 10: 1.2, 11: 0.35, 12: 1.7, 13: 0.2, 14: 3.4, 15: 1.5, 16: 1.9,
};
const hardnessOf = (id) => HARDNESS[id] ?? 0.6;

// Average colour of each block, for the debris thrown when one breaks.
const DEBRIS = {
  1: 0x6bbf3a, 2: 0x8b6239, 3: 0x8c8c96, 4: 0xecdfab, 5: 0x6e4a2a, 6: 0x3f9a2a,
  7: 0x2e72e6, 8: 0xbd8f56, 9: 0xa94a3a, 10: 0x87878f, 11: 0xcdeaf5,
  12: 0xffd83f, 13: 0xf6faff, 14: 0x1a1526, 15: 0x1c1c20, 16: 0xe3c19a,
};

const isSolid = (id) => id !== AIR && BLOCKS[id].solid !== false;
const isAlpha = (id) => id !== AIR && BLOCKS[id].alpha === true;

/* Cube faces, wound counter-clockwise as seen from outside. */
const FACES = [
  { dir: [-1, 0, 0], tile: 1, shade: 0.72, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], tile: 1, shade: 0.72, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], tile: 2, shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], tile: 0, shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], tile: 1, shade: 0.86, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], tile: 1, shade: 0.86, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

export default class Blockcraft extends Game {
  start() {
    sky(this.scene, '#7fb2f0', '#c8e0ff', 55, 130);
    this.scene.fog = new THREE.Fog(0xa8cdf5, 45, 125);

    // Every block face is unlit (MeshBasicMaterial, shaded by baked vertex
    // colour rather than a real light) — so the sun here is purely a bright
    // disc hanging in the sky, immune to fog, not an actual light source.
    this.sun = this.add(new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff6d2, fog: false }),
    ));
    this.sunGlow = this.add(new THREE.Mesh(
      new THREE.SphereGeometry(24, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xfff6d2, transparent: true, opacity: 0.22, fog: false, depthWrite: false,
      }),
    ));

    this.atlas = buildAtlas();
    this.opaqueMat = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true });
    this.alphaMat = new THREE.MeshBasicMaterial({
      map: this.atlas, vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false,
    });

    // Highlight box around the targeted block.
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }),
    );
    this.highlight.visible = false;
    this.add(this.highlight);

    this.sword = this.buildSword();
    this.swingT = 0;   // 0 = at rest, else progress 0..1 through a swing

    // Darkens over the block being mined, so a long dig shows its progress.
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0x08080a, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.crack.visible = false;
    this.add(this.crack);
    this.debris = new Burst(this.scene, 90, 0.13);

    this.slot = 1;   // start on the first block, not the sword (slot 0), so digging works straight away
    this.cool = 0;
    this.lastJump = -1;
    this.mineKey = null;    // which block the current dig is against
    this.mineT = 0;         // seconds spent digging it
    this.chip = 0;          // next chipping sound
    this.stepT = 0;         // distance left before the next footstep
    this.wasWet = false;
    this.sprinting = false;
    this.grounded = false;

    this.viewDist = loadViewDist();

    // Multiplayer: off until the player hits Connect. this.multiplayer tracks
    // whether the *current world* is a shared one from a server (as opposed
    // to a solo save) — see connectMultiplayer().
    this.net = null;
    this.netStatus = 'offline';
    this.netPeers = new Map();
    this.netMoveTimer = 0;
    this.multiplayer = false;
    this.playerName = loadPlayerName();
    this.skinData = loadSkin();     // validated PNG data URL, or null for the default look
    this.skinCanvas = null;         // decoded 64x64 canvas of it (for the preview), filled in async
    this.chatLog = [];
    // PvP (only ever on when the server says so in its welcome — see resetPvp()).
    this.pvp = false;
    this.maxHp = 20;
    this.hp = 20;
    this.dead = false;
    this.kills = 0;
    this.deaths = 0;
    this.atkCool = 0;
    this.heartsShown = -1;
    // Browser hosting (see hostMultiplayer()): this tab acting as the server
    // itself, over WebRTC, rather than connecting out to one.
    this.hostPeer = null;
    this.hostConns = new Map();
    this.hostCode = null;
    this.listPublic = loadListPublic();   // announce a browser/desktop-hosted game on the public list?
    this.announceTimer = null;
    // 'client' / 'host' / null — set the instant Connect/Host is clicked,
    // before either async attempt has actually produced this.net/hostPeer,
    // so the two buttons can't race each other while one is still loading.
    this.netMode = null;

    // Continue whichever world was last active, if it and its data both still
    // exist; otherwise a fresh world with a random seed.
    const activeId = getActiveWorldId();
    const activeMeta = activeId ? loadWorldList().find((w) => w.id === activeId) : null;
    const activeData = activeMeta ? loadWorldData(activeId) : null;

    if (activeMeta && activeData) {
      this.buildWorld(activeMeta.seed, activeData.edits, activeMeta.name, activeMeta.id);
      this.pos.set(activeData.pos.x, activeData.pos.y, activeData.pos.z);
      this.yaw = activeData.yaw;
      this.pitch = activeData.pitch;
      this.flying = !!activeData.flying;
      this.mined = activeData.mined || 0;
      this.placed = activeData.placed || 0;
      this.dirty = false;
      this.touchActive();
    } else {
      this.buildWorld(randomSeed(), null, null, null);
      this.dirty = false;
      this.save();
    }
    this.saveTimer = SAVE_INTERVAL;
    this.musicTimer = rand(14, 24);   // first ambient phrase comes a little sooner than later ones
    const loaded = !!(activeMeta && activeData);

    this.camera.fov = 75;
    this.camera.near = 0.1;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();

    // Not playing yet: the world above is already built and streaming in
    // (so it's ready the moment Play is hit), but movement/mining/pointer
    // lock all stay off until the player has actually chosen a world or
    // server — see beginPlay() and update()'s `if (this.playing)` guard.
    this.playing = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, mine: false, place: false, up: false };
    this.hud.panel(worldHtml() + multiplayerHtml() + landingHtml());
    this.bindWorldPanel();
    this.bindMultiplayerPanel();
    this.hud.$panel?.querySelector('.bc-play-solo')?.addEventListener('click', () => this.beginPlay());

    this.hud.hint(loaded ? `Continuing ${this.worldName}, seed ${this.seed}`
      : `New world, seed ${this.seed}` + ' — pick a world or a server, then hit Play');
  }

  /** Leaves the landing screen and actually starts playing: swaps to the
   *  full in-game HUD (hotbar, touch controls, plus the same world/
   *  multiplayer panels) and lets update() start processing input. Called
   *  once — from the landing Play button, from picking a world (New World /
   *  Load), or from a multiplayer server accepting the connection — after
   *  which those same New World/Load/Connect controls keep working exactly
   *  as they always have, just from inside the live HUD instead. */
  beginPlay() {
    if (this.playing) return;
    this.playing = true;
    this.hud.panel(hotbarHtml() + pvpHtml() + touchHtml() + worldHtml() + multiplayerHtml());
    this.refreshHotbar();
    this.bindTouch();
    this.bindWorldPanel();
    this.bindMultiplayerPanel();
    this.hud.hint((this.multiplayer ? `Multiplayer, seed ${this.seed} · ` : `${this.worldName}, seed ${this.seed} · `) + this.controlsHint());
  }

  /** The control scheme half of the hint text — shared by start() and the
   *  New World button, which both need to restate the current seed too. */
  controlsHint() {
    const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return touchDevice
      ? 'Left stick to move · drag the right side to look · MINE / PLACE / UP · tap FLY to toggle flying'
      : 'Click to capture the mouse · WASD + Space · hold left click to mine, right click places · middle click copies a block · 1-0 or scroll (1 is the sword) · F to fly · or plug in a controller';
  }

  /**
   * (Re)builds the world: tears down any previously loaded/meshed chunks (a
   * "New World" or Load mid-session isn't the first call), restores any
   * previously edited chunks, calibrates this seed's height curve, and
   * resets the player to spawn. Terrain itself streams in afterward via
   * updateStreaming() — this doesn't generate anything yet except spawn's
   * own column. Called once from start(), and again from the World panel.
   */
  buildWorld(seed, savedEdits, name, id) {
    for (const meshes of this.chunks?.values() ?? []) {
      for (const m of meshes) { this.scene.remove(m); m.geometry.dispose(); }
    }
    if (this.clouds) {
      this.scene.remove(this.clouds);
      for (const c of this.clouds.children) c.geometry.dispose();
      this.clouds.children[0]?.material.dispose();
    }

    this.seed = seed;
    this.worldId = id || String(seed);
    this.worldName = name || `World ${seed}`;
    this.heightCal = calibrateHeight(seed);

    // `edits` persists for the whole session, keyed by chunk, and is the only
    // thing that gets saved — everything else regenerates from the seed.
    // `chunkData` holds just the currently-loaded chunks; `chunks` their meshes.
    this.edits = new Map();
    if (savedEdits) {
      for (const key of Object.keys(savedEdits)) {
        this.edits.set(key, rleDecode(savedEdits[key], CHUNK * H * CHUNK));
      }
    }
    this.chunkData = new Map();
    this.chunks = new Map();
    this.loadQueue = [];
    this.centerChunk = null;

    // Edits from other players that arrived for a chunk that wasn't loaded
    // yet — applied on top of that chunk the moment it does load. Keyed the
    // same way chunkData is; see updateStreaming() and applyRemoteEdit().
    this.remoteEdits = new Map();

    this.clouds = this.add(buildClouds());

    // Spawn at the origin's own surface height — cheap to compute directly,
    // no need for any chunk to actually be loaded first.
    const sy = heightAt(0, 0, this.seed, this.heightCal) + 1;
    this.spawnPos = new THREE.Vector3(0.5, sy + 0.2, 0.5);
    this.pos = this.spawnPos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = -0.15;
    this.flying = false;
    this.mined = 0;
    this.placed = 0;
    this.grounded = false;
    this.mineKey = null;
    this.mineT = 0;
    this.chip = 0;
    if (this.highlight) this.highlight.visible = false;
    if (this.crack) this.crack.visible = false;

    this.updateStreaming(true);   // load what's around spawn immediately, not next frame
  }

  /** Serializes only the edited chunks (run-length encoded) plus player
   *  state, keyed by this world's own slot, and updates the world list.
   *  Untouched terrain never needs saving — it regenerates identically from
   *  the seed — so this stays small no matter how far a world has been explored. */
  save() {
    const edits = {};
    for (const [key, data] of this.edits) edits[key] = rleEncode(data);
    writeWorldData(this.worldId, {
      edits,
      pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z },
      yaw: this.yaw,
      pitch: this.pitch,
      flying: this.flying,
      mined: this.mined,
      placed: this.placed,
    });
    this.touchActive();
  }

  /** Updates this world's entry in the list (bumping it to "most recent")
   *  and marks it the one to auto-continue next time, without re-encoding
   *  the voxel data — used when nothing actually changed. */
  touchActive() {
    const list = loadWorldList().filter((w) => w.id !== this.worldId);
    list.unshift({ id: this.worldId, name: this.worldName, seed: this.seed, savedAt: Date.now() });
    writeWorldList(list);
    setActiveWorldId(this.worldId);
  }

  /** Wires the World panel: a seed field and New World button, a live view
   *  distance control, and the list of every saved world with Load/delete
   *  buttons. */
  bindWorldPanel() {
    const panel = this.hud.$panel;
    if (!panel) return;
    this.worldPanel = panel;

    const input = panel.querySelector('.bc-seed-input');
    const viewButtons = [...panel.querySelectorAll('.bc-view')];
    const newButton = panel.querySelector('.bc-new');
    const list = panel.querySelector('.bc-worlds-list');

    // None of this should reach Input's window-level listeners: a click here
    // must not try to pointer-lock the canvas, and Space in a typed seed
    // must not get eaten by the game's jump-key handling.
    input?.addEventListener('pointerdown', (e) => e.stopPropagation());
    input?.addEventListener('keydown', (e) => e.stopPropagation());
    newButton?.addEventListener('pointerdown', (e) => e.stopPropagation());
    list?.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const b of viewButtons) b.addEventListener('pointerdown', (e) => e.stopPropagation());

    const highlightView = () => {
      for (const b of viewButtons) b.classList.toggle('on', Number(b.dataset.chunks) === this.viewDist);
    };
    highlightView();
    for (const b of viewButtons) {
      // View distance is a live client setting, like in real Minecraft — it
      // applies to whatever world is open right now, not just new ones.
      b.addEventListener('click', () => {
        this.viewDist = Number(b.dataset.chunks);
        saveViewDist(this.viewDist);
        this.centerChunk = null;   // forces updateStreaming() to recompute even if standing still
        highlightView();
        this.audio.blip(0);
      });
    }

    newButton?.addEventListener('click', () => {
      // Note before disconnecting: it clears this.multiplayer, but not the
      // ephemeral "mp:" worldId, so this must be checked first or a shared
      // session's dirty edits would get saved as a junk solo world entry.
      const wasMultiplayer = this.multiplayer;
      this.disconnectMultiplayer();   // starting a solo world means leaving whatever shared one is open
      if (this.dirty && !wasMultiplayer) this.save();   // don't lose progress on the world being left
      const text = input?.value.trim();
      const seed = text ? hashSeed(text) : randomSeed();
      const name = text || `World ${seed}`;
      this.buildWorld(seed, null, name, String(seed));
      this.dirty = false;
      this.save();
      if (input) input.value = '';
      this.hud.toast(`NEW WORLD · ${name}`, 1400);
      this.hud.hint(`New world, seed ${this.seed} · ` + this.controlsHint());
      this.refreshWorldList();
      this.audio.good();
      this.beginPlay();
    });

    // Delegated: the list is re-rendered wholesale on every change, so a
    // listener on each row would just be thrown away each time.
    list?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('.bc-load')) { this.loadWorld(id); this.audio.blip(4); }
      else if (e.target.closest('.bc-del')) { deleteWorld(id); this.refreshWorldList(); this.audio.bad(); }
    });

    // No backend here, so "back up across devices" means a file the player
    // moves themselves — export downloads one, import reads one back in.
    const exportBtn = panel.querySelector('.bc-export');
    const importBtn = panel.querySelector('.bc-import');
    const importFile = panel.querySelector('.bc-import-file');
    exportBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    importBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());

    exportBtn?.addEventListener('click', () => {
      const json = this.exportWorlds();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `mimi-blockcraft-worlds-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.audio.blip(4);
    });

    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', async () => {
      const file = importFile.files?.[0];
      importFile.value = '';
      if (!file) return;
      try {
        const count = this.importWorlds(await file.text());
        this.hud.toast(count ? `IMPORTED ${count} WORLD(S)` : 'NOTHING NEW TO IMPORT', 1400);
        this.audio.good();
      } catch {
        this.hud.toast('IMPORT FAILED — not a worlds backup file', 1800);
        this.audio.bad();
      }
    });

    this.refreshWorldList();
  }

  /** Switches to a different saved world, first saving whatever is currently
   *  in progress so hopping between worlds never loses anything. */
  loadWorld(id) {
    if (id === this.worldId && !this.multiplayer) return;
    const wasMultiplayer = this.multiplayer;   // see the same note in bindWorldPanel's New World handler
    this.disconnectMultiplayer();   // loading a solo world means leaving whatever shared one is open
    if (this.dirty && !wasMultiplayer) this.save();
    const meta = loadWorldList().find((w) => w.id === id);
    const data = meta && loadWorldData(id);
    if (!meta || !data) return;
    this.buildWorld(meta.seed, data.edits, meta.name, meta.id);
    this.pos.set(data.pos.x, data.pos.y, data.pos.z);
    this.yaw = data.yaw;
    this.pitch = data.pitch;
    this.flying = !!data.flying;
    this.mined = data.mined || 0;
    this.placed = data.placed || 0;
    this.dirty = false;
    this.touchActive();
    this.hud.toast(`LOADED · ${meta.name}`, 1200);
    this.hud.hint(`Loaded ${meta.name}, seed ${this.seed} · ` + this.controlsHint());
    this.refreshWorldList();
    this.beginPlay();
  }

  /** Re-renders the "Your Worlds" list from storage — called after any
   *  change (new/load/delete) and once when the panel is first wired up. */
  refreshWorldList() {
    const list = this.worldPanel?.querySelector('.bc-worlds-list');
    if (!list) return;
    const worlds = loadWorldList();
    if (!worlds.length) {
      list.innerHTML = '<div class="bc-world-empty">No other saved worlds</div>';
      return;
    }
    list.innerHTML = worlds.map((w) => {
      const current = w.id === this.worldId;
      return `
        <div class="bc-world-row${current ? ' on' : ''}" data-id="${escapeHtml(w.id)}">
          <span class="bc-world-name">${escapeHtml(w.name)}</span>
          ${current ? '' : '<button class="bc-load">Load</button><button class="bc-del">&times;</button>'}
        </div>`;
    }).join('');
  }

  /** Bundles every saved world (including whatever's unsaved right now) into
   *  one JSON string — there's no backend, so this file *is* the backup. */
  exportWorlds() {
    if (this.dirty) this.save();
    return exportAllWorlds();
  }

  /** Merges a previously-exported bundle back in and refreshes the list.
   *  Throws if `json` isn't a worlds backup — callers show that as an error. */
  importWorlds(json) {
    const count = importWorldsBundle(json);
    this.refreshWorldList();
    return count;
  }

  /** Wires the on-screen joystick, look pad and buttons that appear on touch
   *  devices (see touchHtml's @media (pointer: coarse) guard), plus tap-to-
   *  select on the hotbar for every device. Reads `this.hud.$panel` directly,
   *  the same way refreshHotbar does, rather than trusting panel()'s return
   *  value — the test harness's Hud mock always returns null from panel(). */
  bindTouch() {
    const panel = this.hud.$panel;
    if (!panel) return;

    panel.querySelectorAll('.bc-slot').forEach((el, i) => {
      el.addEventListener('click', () => this.selectSlot(i));
    });

    const stickBase = panel.querySelector('.bc-stick-base');
    const stickKnob = panel.querySelector('.bc-stick-knob');
    if (stickBase && stickKnob) {
      bindStick(stickBase, stickKnob, (x, y) => { this.touch.move.x = x; this.touch.move.y = y; });
    }

    const look = panel.querySelector('.bc-look');
    if (look) bindLook(look, this.touch.look);

    const hold = (selector, key) => {
      const el = panel.querySelector(selector);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        this.touch[key] = true;
      });
      el.addEventListener('pointerup', (e) => { e.stopPropagation(); this.touch[key] = false; });
      el.addEventListener('pointercancel', (e) => { e.stopPropagation(); this.touch[key] = false; });
    };
    hold('.bc-btn-mine', 'mine');
    hold('.bc-btn-place', 'place');
    hold('.bc-btn-jump', 'up');

    const flyBtn = panel.querySelector('.bc-btn-fly');
    flyBtn?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.flying = !this.flying;
      this.vel.y = 0;
      this.hud.toast(this.flying ? 'FLYING' : 'WALKING', 700);
    });
  }

  /* ----------------------------------------------------------- voxel access */

  /** Any (x,z) is valid — the world has no edge. A coordinate in a chunk
   *  that isn't currently loaded just reads as air, the same fallback the
   *  old fixed-size world used for anything out of bounds. */
  get(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (y < 0 || y >= H) return AIR;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const data = this.chunkData.get(`${cx},${cz}`);
    if (!data) return AIR;
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    return data[(y * CHUNK + lz) * CHUNK + lx];
  }

  /** The local player's own edit: mutates the world, marks it dirty for
   *  autosave, and — if a multiplayer server is connected — tells it, so
   *  everyone else's world updates too. */
  set(x, y, z, id) {
    if (!this.writeVoxel(x, y, z, id)) return;
    this.dirty = true;
    if (this.net && this.net.readyState === 1) {
      this.net.send(JSON.stringify({ t: 'edit', x: x | 0, y: y | 0, z: z | 0, b: id }));
    } else if (this.hostPeer) {
      this.hostBroadcast({ t: 'edit', x: x | 0, y: y | 0, z: z | 0, b: id });
    }
  }

  /** An edit that arrived from another player over the network: mutates the
   *  world the same way set() does, but never re-broadcasts it (that would
   *  echo forever) and doesn't count as "your" unsaved progress. Recorded in
   *  remoteEdits regardless of whether the chunk is loaded right now, so a
   *  chunk that streams in later still picks it up — see updateStreaming(). */
  applyRemoteEdit(x, y, z, id) {
    x |= 0; y |= 0; z |= 0;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = `${cx},${cz}`;
    let pending = this.remoteEdits.get(key);
    if (!pending) { pending = new Map(); this.remoteEdits.set(key, pending); }
    pending.set(`${x},${y},${z}`, id);
    this.writeVoxel(x, y, z, id);
  }

  /** The actual voxel mutation shared by set() and applyRemoteEdit(): writes
   *  into the loaded chunk (a no-op, returning false, if it isn't loaded),
   *  promotes the chunk into `edits` so it's remembered from here on, and
   *  queues affected chunks for remeshing. */
  writeVoxel(x, y, z, id) {
    x |= 0; y |= 0; z |= 0;
    if (y < 0 || y >= H) return false;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = `${cx},${cz}`;
    const data = this.chunkData.get(key);
    if (!data) return false;   // not currently loaded
    const lx = x - cx * CHUNK;
    const lz = z - cz * CHUNK;
    data[(y * CHUNK + lz) * CHUNK + lx] = id;
    // The very first edit "promotes" this chunk to persistent: edits and
    // chunkData share the same array from here on, so every later edit to
    // it is automatically visible to save() with no extra bookkeeping.
    this.edits.set(key, data);
    // Rebuild this chunk, plus any neighbour whose border faces just changed.
    // (lx/lz, not x/z % CHUNK — the world spans negative coordinates too, and
    // JS's % keeps the sign of its left operand, which breaks the boundary
    // check for e.g. x = -1.)
    this.dirtyChunk(cx, cz);
    if (lx === 0) this.dirtyChunk(cx - 1, cz);
    if (lx === CHUNK - 1) this.dirtyChunk(cx + 1, cz);
    if (lz === 0) this.dirtyChunk(cx, cz - 1);
    if (lz === CHUNK - 1) this.dirtyChunk(cx, cz + 1);
    return true;
  }

  /** Queues a chunk for remeshing — only meaningful for chunks that are
   *  actually loaded; an unloaded neighbour will just pick up the change
   *  whenever it next loads, since get() reads the edit directly. */
  dirtyChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunkData.has(key) && !this.loadQueue.includes(key)) this.loadQueue.push(key);
  }

  /* -------------------------------------------------------------- streaming */

  /**
   * Loads chunks newly within view distance of the player and unloads ones
   * now well outside it (a margin past view distance avoids reloading the
   * same chunk over and over while walking back and forth at the edge).
   * Cheap to call every frame: it does nothing once the player's current
   * chunk stops changing, unless `force` or a view-distance change asks it
   * to recompute anyway.
   */
  updateStreaming(force = false) {
    const cx0 = Math.floor(this.pos.x / CHUNK);
    const cz0 = Math.floor(this.pos.z / CHUNK);
    if (!force && this.centerChunk && cx0 === this.centerChunk.cx && cz0 === this.centerChunk.cz) return;
    this.centerChunk = { cx: cx0, cz: cz0 };

    for (let dz = -this.viewDist; dz <= this.viewDist; dz++) {
      for (let dx = -this.viewDist; dx <= this.viewDist; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        const key = `${cx},${cz}`;
        if (this.chunkData.has(key)) continue;
        const data = this.edits.get(key) || generateChunk(cx, cz, this.seed, this.heightCal);
        // This chunk — freshly generated, or one carrying its own earlier
        // local edits — may still be missing edits another player made while
        // it was unloaded here (writeVoxel() can't touch an unloaded chunk's
        // array, so those were only ever recorded in remoteEdits); stamp
        // them in now regardless of which case this is.
        const pending = this.remoteEdits.get(key);
        if (pending) {
          for (const [posKey, id] of pending) {
            const [wx, wy, wz] = posKey.split(',').map(Number);
            data[(wy * CHUNK + (wz - cz * CHUNK)) * CHUNK + (wx - cx * CHUNK)] = id;
          }
          this.edits.set(key, data);
        }
        this.chunkData.set(key, data);
        if (!this.loadQueue.includes(key)) this.loadQueue.push(key);
      }
    }

    const unloadDist = this.viewDist + UNLOAD_MARGIN;
    for (const key of [...this.chunkData.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.max(Math.abs(cx - cx0), Math.abs(cz - cz0)) <= unloadDist) continue;
      const meshes = this.chunks.get(key);
      if (meshes) {
        for (const m of meshes) { this.scene.remove(m); m.geometry.dispose(); }
        this.chunks.delete(key);
      }
      this.chunkData.delete(key);
      const qi = this.loadQueue.indexOf(key);
      if (qi >= 0) this.loadQueue.splice(qi, 1);
    }

    this.loadQueue.sort((a, b) => this.chunkDist(a) - this.chunkDist(b));
  }

  chunkDist(key) {
    const [cx, cz] = key.split(',').map(Number);
    return (cx - this.centerChunk.cx) ** 2 + (cz - this.centerChunk.cz) ** 2;
  }

  /* -------------------------------------------------------------- meshing */

  buildChunk(key) {
    const [cx, cz] = key.split(',').map(Number);
    const old = this.chunks.get(key);
    if (old) {
      for (const m of old) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }

    const solid = { pos: [], uv: [], col: [], idx: [] };
    const alpha = { pos: [], uv: [], col: [], idx: [] };

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const wx = cx * CHUNK + x;
          const wz = cz * CHUNK + z;
          const id = this.get(wx, y, wz);
          if (id === AIR) continue;
          const target = isAlpha(id) ? alpha : solid;

          for (const face of FACES) {
            const nx = wx + face.dir[0];
            const ny = y + face.dir[1];
            const nz = wz + face.dir[2];
            const n = this.get(nx, ny, nz);
            // Draw a face only where it would actually be visible.
            if (n !== AIR && !(isAlpha(n) && n !== id)) continue;
            if (id === WATER && n === WATER) continue;

            const tile = BLOCKS[id].tiles[face.tile];
            const base = target.pos.length / 3;
            const s = face.shade;
            for (const [ox, oy, oz, u, v] of face.corners) {
              target.pos.push(wx + ox, y + oy, wz + oz);
              target.uv.push(...tileUV(tile, u, v));
              target.col.push(s, s, s);
            }
            target.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }

    const meshes = [];
    for (const [data, mat] of [[solid, this.opaqueMat], [alpha, this.alphaMat]]) {
      if (!data.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(data.col, 3));
      g.setIndex(data.idx);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = true;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.set(key, meshes);
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    this.updateStreaming();
    // Amortise chunk meshing so the frame never stalls.
    for (let i = 0; i < 2 && this.loadQueue.length; i++) this.buildChunk(this.loadQueue.shift());

    // Chunks keep streaming in and the world stays visible behind the landing
    // screen, but nothing reads player input (and pointer lock never gets
    // requested) until the player has actually chosen a world or server.
    if (this.playing && !this.dead) {
      this.look(dt);
      this.move(dt);
      this.interact(dt);
    }

    this.debris.update(dt);
    this.driftClouds(dt);
    // Fixed offset from the player, not a fixed world position — reads as
    // infinitely far away no matter how far the player wanders, the same
    // trick driftClouds uses.
    this.sun.position.set(this.pos.x + 140, 220, this.pos.z - 90);
    this.sunGlow.position.copy(this.sun.position);

    // Autosave on a timer, but only when something actually changed — no
    // point writing an identical world to storage every 20 seconds. A
    // multiplayer session isn't "yours" to save as a solo world slot — it
    // lives on the server for as long as that stays running.
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = SAVE_INTERVAL;
      if (this.dirty && !this.multiplayer) { this.save(); this.dirty = false; }
    }

    this.updateNet(dt);

    // A calm ambient phrase now and then — sparse, like Minecraft's own
    // soundtrack, not a tight background loop.
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = rand(28, 46);
      this.audio.ambientChime(0.6);
    }

    this.camera.position.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.updateSword(dt);

    // A little FOV kick while sprinting; the speed reads better than the number.
    const wantFov = this.sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, wantFov, 8, dt);
      this.camera.updateProjectionMatrix();
    }

    const head = this.get(this.pos.x, this.pos.y + 1.6, this.pos.z);
    this.scene.fog.color.setHex(head === WATER ? 0x2a5f9e : 0xa8cdf5);

    this.hud.stat('Mined', this.mined);
    this.hud.stat('Placed', this.placed);
    this.hud.stat('XYZ', `${this.pos.x.toFixed(0)} ${this.pos.y.toFixed(0)} ${this.pos.z.toFixed(0)}`);
    this.hud.stat('Mode', this.flying ? 'flying' : 'walking');
    this.hud.stat('Seed', this.seed);
    if (this.loadQueue.length) {
      this.hud.stat('Chunks', `${this.chunks.size}/${this.chunkData.size}`);
    } else if (this.hud.stats.has('Chunks')) {
      this.hud.stats.get('Chunks').remove?.();
      this.hud.stats.delete('Chunks');
    }
    if (this.multiplayer) {
      this.hud.stat('Online', this.netPeers.size + 1);
    } else if (this.hud.stats.has('Online')) {
      this.hud.stats.get('Online').remove?.();
      this.hud.stats.delete('Online');
    }
  }

  look(dt) {
    if (this.input.clicked && !this.input.locked) this.input.requestLock();
    if (this.input.locked) {
      this.yaw -= this.input.delta.x * 0.0022;
      this.pitch = clamp(this.pitch - this.input.delta.y * 0.0022, -1.55, 1.55);
    }
    if (this.input.key('KeyQ')) this.yaw += 2 * dt;
    if (this.input.key('KeyE')) this.yaw -= 2 * dt;

    // A gamepad's right stick turns at a steady rate rather than by delta.
    const gx = this.input.gpAxis(2);
    const gy = this.input.gpAxis(3);
    if (gx || gy) {
      this.yaw -= gx * 2.4 * dt;
      this.pitch = clamp(this.pitch - gy * 2.4 * dt, -1.55, 1.55);
    }

    // The touch look pad reports accumulated finger movement since last read,
    // the same shape as a locked mouse's delta — consume and clear it.
    if (this.touch.look.x || this.touch.look.y) {
      this.yaw -= this.touch.look.x * 0.0026;
      this.pitch = clamp(this.pitch - this.touch.look.y * 0.0026, -1.55, 1.55);
      this.touch.look.x = 0;
      this.touch.look.y = 0;
    }
  }

  move(dt) {
    if (this.input.hit('KeyF') || this.input.gpHit(3)) {
      this.flying = !this.flying;
      this.vel.y = 0;
      this.hud.toast(this.flying ? 'FLYING' : 'WALKING', 700);
    }

    // Space/A/the jump button all mean "up"; shift/B all mean "down" — each
    // pair does the same double duty (jump vs. fly-up, sprint vs. fly-down).
    const jumpHeld = this.input.key('Space') || this.input.gpButton(0) || this.touch.up;
    const downHeld = this.input.key('ShiftLeft') || this.input.gpButton(1);

    const fwd = this.input.axisY() || this.touch.move.y;
    const strafe = this.input.axisX() || this.touch.move.x;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const sprint = downHeld && !this.flying ? 1.6 : 1;
    const speed = (this.flying ? 16 : 5.2) * sprint;
    this.sprinting = sprint > 1 && (fwd !== 0 || strafe !== 0);

    const wishX = (-sin * fwd + cos * strafe) * speed;
    const wishZ = (-cos * fwd - sin * strafe) * speed;
    const rate = this.grounded || this.flying ? 16 : 5;
    this.vel.x = damp(this.vel.x, wishX, rate, dt);
    this.vel.z = damp(this.vel.z, wishZ, rate, dt);

    const inWater = this.get(this.pos.x, this.pos.y + 0.4, this.pos.z) === WATER;

    if (this.flying) {
      const up = (jumpHeld ? 1 : 0) - (downHeld ? 1 : 0);
      this.vel.y = damp(this.vel.y, up * 12, 14, dt);
    } else if (inWater) {
      this.vel.y = damp(this.vel.y, jumpHeld ? 4 : -2.4, 6, dt);
    } else {
      this.vel.y -= 28 * dt;
      if (jumpHeld && this.grounded) {
        this.vel.y = 9;
        this.grounded = false;
        this.audio.tone([420, 560], 0.07, { type: 'triangle', gain: 0.08 });
      }
      this.vel.y = Math.max(this.vel.y, -55);
    }

    // Axis-separated sweep against the voxel grid.
    const falling = this.vel.y;
    this.grounded = false;
    this.sweep('x', this.vel.x * dt);
    this.sweep('z', this.vel.z * dt);
    this.sweep('y', this.vel.y * dt);

    if (this.grounded && falling < -7) this.audio.noise(0.09, { gain: 0.1, cutoff: 300 });
    if (inWater !== this.wasWet) {
      this.audio.noise(0.3, { gain: 0.12, cutoff: 900, sweep: 0.6 });
      this.wasWet = inWater;
    }
    // Footsteps are paced by distance covered, not by time, so they keep step
    // with the walk whether you are sprinting or crawling along.
    const pace = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (this.grounded && !this.flying && pace > 0.001) {
      this.stepT -= pace;
      if (this.stepT <= 0) {
        this.stepT = 1.9;
        this.audio.noise(0.05, { gain: 0.05, cutoff: 520 });
      }
    }

    if (this.pos.y < -20) {           // fell out of the world
      this.pos.copy(this.spawnPos);
      this.vel.set(0, 0, 0);
      this.updateStreaming(true);    // spawn's chunk may since have unloaded behind us
    }
  }

  /** Move one axis and stop at the first solid block the player body hits. */
  sweep(axis, delta) {
    if (!delta) return;
    const R = 0.3;
    const HEIGHT = 1.8;
    this.pos[axis] += delta;

    const minX = Math.floor(this.pos.x - R);
    const maxX = Math.floor(this.pos.x + R);
    const minY = Math.floor(this.pos.y);
    const maxY = Math.floor(this.pos.y + HEIGHT);
    const minZ = Math.floor(this.pos.z - R);
    const maxZ = Math.floor(this.pos.z + R);

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isSolid(this.get(x, y, z))) continue;
          if (axis === 'x') {
            this.pos.x = delta > 0 ? x - R - 0.001 : x + 1 + R + 0.001;
            this.vel.x = 0;
          } else if (axis === 'z') {
            this.pos.z = delta > 0 ? z - R - 0.001 : z + 1 + R + 0.001;
            this.vel.z = 0;
          } else {
            if (delta > 0) { this.pos.y = y - HEIGHT - 0.001; }
            else { this.pos.y = y + 1.001; this.grounded = true; }
            this.vel.y = 0;
          }
          return;
        }
      }
    }
  }

  /* ------------------------------------------------------- block targeting */

  /** March the view ray a step at a time; returns the hit block and the empty
   *  cell in front of it (where a new block would go). */
  raycast() {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );
    const p = new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z);
    let prev = null;
    for (let t = 0; t < REACH; t += 0.04) {
      const x = Math.floor(p.x + dir.x * t);
      const y = Math.floor(p.y + dir.y * t);
      const z = Math.floor(p.z + dir.z * t);
      const id = this.get(x, y, z);
      if (isSolid(id)) return { x, y, z, id, prev };
      prev = { x, y, z };
    }
    return null;
  }

  /** The first-person sword: a few flat-shaded boxes drawn on top of the world
   *  (no depth test, so it never sinks into a nearby wall) and posed relative
   *  to the camera each frame by updateSword(). */
  buildSword() {
    const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, fog: false });
    const part = (w, h, d, x, y, color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
      m.position.set(x, y, 0);
      m.renderOrder = 999;
      return m;
    };
    const model = new THREE.Group();   // blade points up its local +Y from the grip
    model.add(
      part(0.07, 0.62, 0.025, 0, 0.42, 0xdfe8f5),    // blade
      part(0.025, 0.6, 0.03, 0, 0.42, 0xffffff),     // bright edge down the middle
      part(0.07, 0.05, 0.03, 0, 0.74, 0xdfe8f5),     // tip
      part(0.26, 0.05, 0.07, 0, 0.07, 0xd4a72c),     // guard
      part(0.05, 0.22, 0.05, 0, -0.06, 0x6b4423),    // grip
      part(0.09, 0.05, 0.09, 0, -0.19, 0xd4a72c),    // pommel
    );
    const rig = new THREE.Group();     // placed on the camera; `model` swings inside it
    rig.add(model);
    rig.visible = false;
    rig.userData.model = model;
    this.add(rig);
    return rig;
  }

  /** Shows the sword only while it's the selected slot and you're alive and
   *  playing; carries it with the camera; and runs the swing (a quick
   *  down-and-across chop) plus a small walking sway. */
  updateSword(dt) {
    const show = this.playing && !this.dead && HOTBAR[this.slot] === SWORD;
    this.sword.visible = show;
    if (!show) { this.swingT = 0; return; }
    if (this.swingT > 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) this.swingT = 0;
    }
    const k = this.swingT > 0 ? Math.sin(this.swingT * Math.PI) : 0;
    this.swayT = (this.swayT || 0) + dt * 7 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4);
    const sway = Math.sin(this.swayT) * 0.008;
    this.sword.position.copy(this.camera.position);
    this.sword.quaternion.copy(this.camera.quaternion);
    const model = this.sword.userData.model;
    model.position.set(0.36 - k * 0.2, -0.38 + sway + k * 0.06, -0.72 - k * 0.12);
    model.rotation.set(-0.3 - k * 1.5, -0.2, 0.45 - k * 0.5);
    model.scale.setScalar(0.8);
  }

  /** The id of the nearest living player the view ray hits within reach and
   *  before any block in the way, or null. Each player is a 0.6 x 1.8 x 0.6
   *  box, tested with the standard slab method. */
  pickPlayer(blockHit) {
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const ox = this.pos.x, oy = this.pos.y + 1.62, oz = this.pos.z;
    let maxT = ATTACK_REACH;
    if (blockHit) {
      const bt = Math.hypot(blockHit.x + 0.5 - ox, blockHit.y + 0.5 - oy, blockHit.z + 0.5 - oz) - 0.5;
      if (bt < maxT) maxT = bt;
    }
    let best = null;
    let bestT = maxT;
    for (const [id, peer] of this.netPeers) {
      if (peer.dead) continue;
      const lo = [peer.x - 0.3, peer.y, peer.z - 0.3];
      const hi = [peer.x + 0.3, peer.y + 1.8, peer.z + 0.3];
      const o = [ox, oy, oz];
      const d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = bestT;
      for (let i = 0; i < 3 && t0 <= t1; i++) {
        if (Math.abs(d[i]) < 1e-9) {
          if (o[i] < lo[i] || o[i] > hi[i]) t1 = -1;
        } else {
          let a = (lo[i] - o[i]) / d[i];
          let b = (hi[i] - o[i]) / d[i];
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
        }
      }
      if (t0 <= t1) { best = id; bestT = t0; }
    }
    return best;
  }

  interact(dt) {
    this.cool -= dt;

    // Block selection
    const N = HOTBAR.length;
    for (let i = 0; i < N; i++) {
      if (this.input.hit(`Digit${(i + 1) % 10}`)) this.selectSlot(i);   // 1-9, then 0 for the tenth
    }
    if (this.input.wheel) this.selectSlot((this.slot + (this.input.wheel > 0 ? 1 : -1) + N) % N);
    if (this.input.gpHit(4)) this.selectSlot((this.slot + N - 1) % N);
    if (this.input.gpHit(5)) this.selectSlot((this.slot + 1) % N);

    const hit = this.raycast();
    this.highlight.visible = !!hit;
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    // Middle click copies the block you are looking at, if it is on the bar.
    if (hit && this.input.clickedButton(1)) {
      const slot = HOTBAR.indexOf(hit.id);
      if (slot >= 0) this.selectSlot(slot);
    }

    // Holding the sword, the attack button swings it (and hits whoever is under
    // the crosshair); it never digs or places. Without it, a swing at a player
    // in PvP still lands, just as a weak punch, and otherwise digs as normal.
    const sword = HOTBAR[this.slot] === SWORD;
    this.atkCool -= dt;
    const target = this.pvp && this.net ? this.pickPlayer(hit) : null;
    if (target || sword) {
      this.mine(dt, null);
      const swinging = (this.input.button(0) && this.input.locked) || this.input.gpButton(7) || this.touch.mine;
      if (swinging && this.atkCool <= 0) {
        this.atkCool = ATTACK_COOLDOWN;
        if (sword) this.swingT = 0.001;
        if (target && this.net.readyState === 1) {
          this.net.send(JSON.stringify(sword ? { t: 'hit', target, w: SWORD } : { t: 'hit', target }));
        }
        this.audio.tone(sword ? 320 : 200, 0.06, { type: 'square', gain: 0.09 });
      }
    } else {
      this.mine(dt, hit);
    }
    if (sword) return;   // nothing to place with a sword in hand

    if (!hit || this.cool > 0) return;
    const placing = this.input.button(2) || this.input.gpButton(6) || this.touch.place;
    if (placing && hit.prev) {
      const { x, y, z } = hit.prev;
      if (this.get(x, y, z) === AIR && !this.intersectsPlayer(x, y, z)) {
        this.set(x, y, z, HOTBAR[this.slot]);
        this.placed++;
        this.cool = 0.18;
        this.audio.tone(280, 0.06, { type: 'square', gain: 0.09 });
      }
    }
  }

  /**
   * Digging takes time now: every block has a hardness, and holding the button
   * works through it. Looking away resets the dig, so you cannot chip at four
   * blocks at once.
   */
  mine(dt, hit) {
    // A mouse click only counts once the pointer is actually locked — the
    // very click that requests lock must not also register as a mine. The
    // gamepad trigger and the touch mine button have no such lock to wait on.
    const digging = hit && ((this.input.button(0) && this.input.locked)
      || this.input.gpButton(7) || this.touch.mine);
    const key = digging ? `${hit.x},${hit.y},${hit.z}` : null;
    if (key !== this.mineKey) {
      this.mineKey = key;
      this.mineT = 0;
      this.chip = 0;
    }
    if (!digging) {
      this.crack.visible = false;
      return;
    }

    const need = hardnessOf(hit.id);
    this.mineT += dt;
    const progress = clamp(this.mineT / need, 0, 1);

    this.crack.visible = true;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.material.opacity = progress * 0.55;

    this.chip -= dt;
    if (this.chip <= 0) {
      this.chip = 0.16;
      this.audio.noise(0.05, { gain: 0.07, cutoff: 900 + progress * 900 });
    }

    if (progress < 1) return;

    const centre = new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.debris.burst(centre, DEBRIS[hit.id] ?? 0x9a9aa2, 10, 4.5);
    this.set(hit.x, hit.y, hit.z, AIR);
    this.mined++;
    this.mineKey = null;
    this.mineT = 0;
    this.crack.visible = false;
    this.audio.noise(0.13, { gain: 0.15, cutoff: 1200, sweep: 0.4 });
    if (hit.id === 12 || hit.id === 15 || hit.id === 16) this.audio.good();   // a little reward for striking ore
  }

  driftClouds(dt) {
    // Wrapped relative to the player, not a fixed world footprint — there
    // is no fixed footprint any more, and clouds should still be overhead
    // no matter how far from spawn the player has wandered.
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x - this.pos.x > 110) c.position.x = this.pos.x - 110;
    }
  }

  /* ------------------------------------------------------------ multiplayer */

  /** Sends this player's own position on a throttled timer (never every
   *  frame — that's a lot of WebSocket traffic for no visible benefit), and
   *  eases every other connected player's avatar toward wherever their last
   *  update placed them, rather than snapping. */
  updateNet(dt) {
    if (this.net && this.net.readyState === 1) {
      this.netMoveTimer -= dt;
      if (this.netMoveTimer <= 0) {
        this.netMoveTimer = NET_MOVE_INTERVAL;
        this.net.send(JSON.stringify({
          t: 'move', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch,
        }));
      }
    } else if (this.hostPeer && this.hostConns.size) {
      this.netMoveTimer -= dt;
      if (this.netMoveTimer <= 0) {
        this.netMoveTimer = NET_MOVE_INTERVAL;
        this.hostBroadcast({
          t: 'move', id: 'host', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch,
        });
      }
    }
    for (const peer of this.netPeers.values()) {
      peer.x = damp(peer.x, peer.tx, 12, dt);
      peer.y = damp(peer.y, peer.ty, 12, dt);
      peer.z = damp(peer.z, peer.tz, 12, dt);
      peer.yaw = damp(peer.yaw, peer.tyaw, 12, dt);
      const moved = Math.hypot(peer.tx - peer.x, peer.tz - peer.z);
      peer.walk = damp(peer.walk, clamp(moved * 6, 0, 1), 10, dt);   // how hard they're walking right now (0..1), smoothed
      peer.phase += dt * 9 * peer.walk;
      const swing = Math.sin(peer.phase) * 0.9 * peer.walk;
      const { head, armL, armR, legL, legR } = peer.avatar.parts;
      armR.rotation.x = swing; armL.rotation.x = -swing;
      legR.rotation.x = -swing; legL.rotation.x = swing;
      peer.pitch = damp(peer.pitch, peer.tpitch, 12, dt);
      head.rotation.x = clamp(-peer.pitch, -1.2, 1.2);
      peer.avatar.group.position.set(peer.x, peer.y, peer.z);
      peer.avatar.group.rotation.y = peer.yaw;
      peer.tag.sprite.position.set(peer.x, peer.y + 2.2, peer.z);
    }
  }

  /** Opens a connection to either a self-hosted Node server (a ws:// or
   *  wss:// address — see server/blockcraft-server.mjs) or someone else's
   *  browser-hosted game (any other text is treated as their join code —
   *  see hostMultiplayer()), and once accepted, rebuilds the world to the
   *  shared seed so everyone on the same session stands on the same terrain.
   *  Either way `this.net` ends up holding something that looks enough like
   *  a WebSocket (readyState / send(jsonString) / addEventListener) that
   *  nothing past this point needs to know which transport is really in
   *  use — see dialPeerHost() for the PeerJS side of that. */
  async connectMultiplayer(address) {
    this.leaveMultiplayer();
    this.netMode = 'client';
    this.netStatus = 'connecting';
    this.chatLog = [];
    this.refreshMultiplayerPanel();

    let link;
    try {
      link = /^wss?:\/\//i.test(address) ? new WebSocket(address) : await this.dialPeerHost(address);
    } catch {
      this.netMode = null;
      this.netStatus = 'offline';
      this.hud.toast('MULTIPLAYER — could not reach that address', 1800);
      this.refreshMultiplayerPanel();
      return;
    }
    if (this.net || this.hostPeer) { try { link.close(); } catch { /* ignore */ } return; }   // superseded while dialling
    this.net = link;

    link.addEventListener('open', () => {
      link.send(JSON.stringify({ t: 'hello', name: this.playerName, skin: this.skinData }));
    });
    link.addEventListener('message', (e) => this.handleNetMessage(e.data));
    link.addEventListener('close', () => this.handleNetClose());
    link.addEventListener('error', () => { /* the 'close' event still follows this */ });
  }

  /** Joins someone else's browser-hosted game over WebRTC (PeerJS), wrapped
   *  to look enough like a WebSocket that connectMultiplayer() (and every-
   *  thing downstream of it — set(), updateNet(), sendChat()) can treat it
   *  exactly the same as a real one. */
  async dialPeerHost(code) {
    const { Peer } = await import('peerjs');
    const peer = new Peer();
    await new Promise((resolve, reject) => {
      peer.on('open', resolve);
      peer.on('error', reject);
    });
    const conn = peer.connect(code, { reliable: true });
    // Wait for the connection itself to actually open (or fail) before
    // handing it back — otherwise a code that doesn't belong to anyone
    // would leave connectMultiplayer() stuck at "Connecting…" forever
    // instead of surfacing an error the way a bad ws:// address already does.
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 15000);
        conn.on('open', () => { clearTimeout(timer); resolve(); });
        conn.on('error', (e) => { clearTimeout(timer); reject(e); });
        peer.on('error', (e) => { clearTimeout(timer); reject(e); });   // e.g. "peer-unavailable" for a bad code
      });
    } catch (err) {
      peer.destroy();   // a failed/timed-out join must not leave a live connection to the broker behind
      throw err;
    }
    return {
      get readyState() { return conn.open ? 1 : 0; },
      send: (raw) => conn.send(JSON.parse(raw)),
      close: () => { try { conn.close(); } finally { peer.destroy(); } },
      addEventListener(type, cb) {
        if (type === 'open') cb();   // already open by the time dialPeerHost() returns
        else if (type === 'message') conn.on('data', (data) => cb({ data: JSON.stringify(data) }));
        else if (type === 'close') { conn.on('close', cb); peer.on('disconnected', cb); peer.on('error', cb); }
      },
    };
  }

  /** The browser-hosting counterpart to connectMultiplayer(): instead of
   *  talking to a separate server process, this tab *is* the server — it
   *  opens a PeerJS peer (WebRTC, signalled through PeerJS's free public
   *  broker, so no port-forwarding is needed even across the open internet),
   *  shares a short join code, and relays moves/edits/chat between whoever
   *  connects exactly the way server/blockcraft-server.mjs does — see
   *  handleHostData() and hostBroadcast(). The host keeps playing on their
   *  own current world rather than switching to a fresh "Multiplayer" one;
   *  everyone who joins is handed that same seed and its edits so far. */
  async hostMultiplayer() {
    this.leaveMultiplayer();
    this.netMode = 'host';
    this.netStatus = 'connecting';
    this.chatLog = [];
    this.refreshMultiplayerPanel();

    let PeerCtor;
    try {
      ({ Peer: PeerCtor } = await import('peerjs'));
    } catch {
      this.netMode = null;
      this.netStatus = 'offline';
      this.hud.toast('HOSTING — could not load networking', 1800);
      this.refreshMultiplayerPanel();
      return;
    }
    if (this.hostPeer || this.net) return;   // a connect/disconnect raced this while it was loading

    const code = `bc-${Math.random().toString(36).slice(2, 8)}`;
    const peer = new PeerCtor(code);
    this.hostPeer = peer;
    this.hostConns = new Map();

    peer.on('open', () => {
      this.hostCode = code;
      this.netStatus = 'online';
      this.startAnnounce();
      this.hud.toast(`HOSTING · code ${code}`, 2200);
      this.beginPlay();
      this.refreshMultiplayerPanel();
    });
    peer.on('connection', (conn) => {
      conn.on('data', (msg) => this.handleHostData(conn, msg));
      conn.on('close', () => this.handleHostConnClose(conn.peer));
    });
    peer.on('error', (err) => {
      if (this.hostPeer !== peer) return;   // a stale error from a peer we've already torn down
      this.hud.toast(`HOSTING ERROR — ${err?.type || err?.message || 'could not host'}`, 2200);
      if (this.netStatus !== 'online') { this.stopHosting(); this.refreshMultiplayerPanel(); }
    });
  }

  /** One message arriving from a connected player, while this tab is the
   *  host — mirrors server/blockcraft-server.mjs's per-connection handling,
   *  just addressed by PeerJS connection instead of a WebSocket. */
  handleHostData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const pid = conn.peer;

    if (msg.t === 'hello') {
      if (this.hostConns.has(pid)) return;
      const color = HOST_COLORS[this.hostConns.size % HOST_COLORS.length];
      const name = String(msg.name || 'Player').trim().slice(0, 16) || 'Player';
      const skin = isValidSkinData(msg.skin) ? msg.skin : null;
      this.hostConns.set(pid, { conn, name, color, skin });
      conn.send({
        t: 'welcome', id: pid, seed: this.seed, edits: this.flattenEditsForNet(),
        players: [
          { id: 'host', name: this.playerName, color: '#ffffff', skin: this.skinData, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw },
          ...[...this.hostConns].filter(([k]) => k !== pid).map(([k, v]) => {
            const p = this.netPeers.get(k);
            return { id: k, name: v.name, color: v.color, skin: v.skin, x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, yaw: p?.yaw ?? 0 };
          }),
        ],
      });
      this.addNetPeer(pid, { name, color, skin, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw });
      this.hostBroadcast({ t: 'join', id: pid, name, color, skin }, pid);
      this.hud.toast(`${name} joined`, 1200);
      this.refreshMultiplayerPanel();
      this.announceNow();
      return;
    }

    const entry = this.hostConns.get(pid);
    if (!entry) return;   // never said hello

    if (msg.t === 'move') {
      const peer = this.netPeers.get(pid);
      if (peer) { peer.tx = msg.x; peer.ty = msg.y; peer.tz = msg.z; peer.tyaw = msg.yaw; peer.tpitch = Number(msg.pitch) || 0; }
      this.hostBroadcast({ t: 'move', id: pid, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch }, pid);
    } else if (msg.t === 'skin') {
      const skin = isValidSkinData(msg.skin) ? msg.skin : null;
      entry.skin = skin;
      this.setPeerSkin(pid, skin);
      this.hostBroadcast({ t: 'skin', id: pid, skin }, pid);
    } else if (msg.t === 'edit') {
      const x = msg.x | 0, y = msg.y | 0, z = msg.z | 0, b = msg.b | 0;
      if (y < 0 || y >= H || b < 0 || b >= BLOCKS.length) return;
      this.applyRemoteEdit(x, y, z, b);
      this.hostBroadcast({ t: 'edit', x, y, z, b }, pid);
    } else if (msg.t === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 140);
      if (!text) return;
      this.pushChat(entry.name, text, false);
      this.hostBroadcast({ t: 'chat', id: pid, name: entry.name, text }, pid);
    }
  }

  handleHostConnClose(pid) {
    const entry = this.hostConns.get(pid);
    if (!entry) return;
    this.hostConns.delete(pid);
    this.removeNetPeer(pid);
    this.hud.toast(`${entry.name} left`, 1200);
    this.hostBroadcast({ t: 'leave', id: pid }, pid);
    this.refreshMultiplayerPanel();
    this.announceNow();
  }

  /* --------------------------------------------------- public server list */

  /** Posts this hosted game to the public list (if the player opted in), and
   *  keeps re-posting so the entry doesn't expire. The listing is only a join
   *  code, a name and a headcount — the game itself still runs peer-to-peer
   *  between the host and each joiner. */
  startAnnounce() {
    this.stopAnnounce(false);
    if (!REGISTRY_URL || !this.listPublic || !this.hostCode) return;
    this.announceNow();
    this.announceTimer = setInterval(() => this.announceNow(), ANNOUNCE_EVERY_MS);
  }

  announceNow() {
    if (!REGISTRY_URL || !this.listPublic || !this.hostPeer || !this.hostCode || typeof fetch !== 'function') return;
    fetch(`${REGISTRY_URL}/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: this.hostCode, name: `${this.playerName}'s world`, players: this.hostConns.size + 1, max: 8,
      }),
      keepalive: true,
    }).catch(() => { /* the list being unreachable must never affect the game itself */ });
  }

  /** Stops re-announcing and (unless told not to) takes the listing down now
   *  rather than waiting for it to expire. */
  stopAnnounce(remove = true) {
    if (this.announceTimer) { clearInterval(this.announceTimer); this.announceTimer = null; }
    if (remove && REGISTRY_URL && this.hostCode && typeof fetch === 'function') {
      fetch(`${REGISTRY_URL}/servers/remove`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.hostCode }), keepalive: true,
      }).catch(() => { /* it expires by itself in a minute anyway */ });
    }
  }

  /** Fills the "Public servers" list: the official always-on PvP arena first,
   *  then whatever games people are hosting right now. */
  async refreshServerList() {
    const box = this.mpPanel?.querySelector('.bc-srv-list');
    if (!box || !REGISTRY_URL) return;
    box.innerHTML = '<div class="bc-srv-note">Loading…</div>';
    const get = async (path) => (await fetch(REGISTRY_URL + path, { signal: AbortSignal.timeout(12000) })).json();
    const [arena, hosted] = await Promise.allSettled([get('/health'), get('/servers')]);
    if (!this.mpPanel?.querySelector('.bc-srv-list')) return;   // panel was rebuilt while we waited
    let html = '';
    if (PVP_SERVER_URL) {
      const a = arena.status === 'fulfilled' ? arena.value : null;
      html += `<div class="bc-srv"><span class="bc-srv-name">⚔ Arena (PvP)</span>`
        + `<span class="bc-srv-count">${a ? `${a.players | 0}/${a.maxPlayers | 0}` : 'waking…'}</span>`
        + `<button data-join="${escapeHtml(PVP_SERVER_URL)}">Join</button></div>`;
    }
    if (hosted.status === 'fulfilled' && Array.isArray(hosted.value)) {
      for (const h of hosted.value) {
        if (h.code === this.hostCode || !/^bc-[a-z0-9]{3,12}$/.test(String(h.code))) continue;   // not our own, and only well-formed codes
        html += `<div class="bc-srv"><span class="bc-srv-name">${escapeHtml(String(h.name).slice(0, 28))}</span>`
          + `<span class="bc-srv-count">${h.players | 0}/${h.max | 0}</span>`
          + `<button data-join="${escapeHtml(h.code)}">Join</button></div>`;
      }
      if (!hosted.value.some((h) => h.code !== this.hostCode)) html += '<div class="bc-srv-note">No player-hosted games right now.</div>';
    } else {
      html += '<div class="bc-srv-note">Couldn\'t reach the server list.</div>';
    }
    box.innerHTML = html;
  }

  /** this.edits holds whole edited-chunk arrays — a chunk touched once looks
   *  identical to one touched a thousand times, since every edit reuses the
   *  same array. Hosting needs the sparse [[x,y,z,id],...] shape the network
   *  protocol actually uses instead (matching what a fresh join over
   *  server/blockcraft-server.mjs would send), so this diffs each edited
   *  chunk against a freshly regenerated one and keeps only what differs —
   *  otherwise a world with a long solo history would hand every joining
   *  player its entire edited terrain instead of just the real edits. */
  flattenEditsForNet() {
    const out = [];
    for (const [key, data] of this.edits) {
      const [cx, cz] = key.split(',').map(Number);
      const base = generateChunk(cx, cz, this.seed, this.heightCal);
      const ox = cx * CHUNK;
      const oz = cz * CHUNK;
      for (let y = 0; y < H; y++) {
        for (let lz = 0; lz < CHUNK; lz++) {
          for (let lx = 0; lx < CHUNK; lx++) {
            const i = (y * CHUNK + lz) * CHUNK + lx;
            if (data[i] !== base[i]) out.push([ox + lx, y, oz + lz, data[i]]);
          }
        }
      }
    }
    return out;
  }

  /** Sends one message to every connected player except (optionally) one —
   *  e.g. the player whose own move/edit/chat this is being relayed from. */
  hostBroadcast(msg, exceptId = null) {
    for (const [pid, entry] of this.hostConns) {
      if (pid !== exceptId) { try { entry.conn.send(msg); } catch { /* their close handler will clean it up */ } }
    }
  }

  /** Stops hosting: closes every connection, tears down the peer, and clears
   *  every joined player's avatar — the mirror image of disconnectMultiplayer(). */
  stopHosting() {
    if (!this.hostPeer) return;
    this.stopAnnounce();
    for (const entry of this.hostConns.values()) { try { entry.conn.close(); } catch { /* already closed */ } }
    this.hostConns.clear();
    this.clearNetPeers();
    try { this.hostPeer.destroy(); } catch { /* already gone */ }
    this.hostPeer = null;
    this.hostCode = null;
    this.netStatus = 'offline';
    this.netMode = null;
  }

  /** Leaves whatever multiplayer state is active, client or host — called
   *  before starting a new connection/hosting attempt, when the player
   *  explicitly disconnects, and when they start or load a solo world
   *  (which isn't a thing you can do mid-session and stay synced). */
  leaveMultiplayer() {
    if (this.net) {
      const ws = this.net;
      this.net = null;
      try { ws.close(); } catch { /* already closing */ }
    }
    this.stopHosting();
    this.multiplayer = false;
    this.netStatus = 'offline';
    this.netMode = null;
    this.clearNetPeers();
    this.resetPvp();
    this.refreshMultiplayerPanel();
  }

  /** Kept as the name the rest of the file (and the tests) already call —
   *  leaving is leaving, whichever side of it you were on. */
  disconnectMultiplayer() { this.leaveMultiplayer(); }

  /** The server closed the connection (host stopped it, network dropped,
   *  etc.) rather than us choosing to leave — clean up the same way, plus
   *  tell the player, since this one wasn't their doing. Guarded against
   *  firing again after an explicit disconnectMultiplayer() already ran. */
  handleNetClose() {
    if (!this.net) return;
    const wasOnline = this.multiplayer;
    this.leaveMultiplayer();
    if (wasOnline) this.hud.toast('DISCONNECTED from multiplayer server', 1800);
  }

  /** Handles one message from whatever this.net is connected to — a real
   *  server (server/blockcraft-server.mjs) or someone else's browser-hosted
   *  game (dialPeerHost() wraps that connection to hand back JSON text here
   *  too, so this side never needs to know which). The host's own symmetric
   *  handling of messages *from* its players is separate — see
   *  handleHostData(). */
  handleNetMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'welcome') {
      this.netId = msg.id;
      this.netStatus = 'online';
      if (this.dirty) this.save();   // don't lose the solo world being left behind
      this.buildWorld(msg.seed, null, 'Multiplayer', `mp:${Date.now()}`);
      this.multiplayer = true;
      this.dirty = false;
      for (const [x, y, z, id] of msg.edits) {
        if (y >= 0 && y < H && id >= 0 && id < BLOCKS.length) this.applyRemoteEdit(x, y, z, id);
      }
      this.pvp = !!msg.pvp;   // before the players are added, so their name tags know whether to show health
      this.maxHp = Number(msg.maxHp) || 20;
      this.hp = clamp(Number(msg.hp) || this.maxHp, 0, this.maxHp);
      this.dead = false;
      this.kills = 0;
      this.deaths = 0;
      for (const p of msg.players) this.addNetPeer(p.id, p);
      this.hud.toast(`CONNECTED · seed ${msg.seed}`, 1600);
      this.beginPlay();   // connecting successfully is enough to jump straight into playing
      this.hud.hint(`${this.pvp ? 'PvP arena' : 'Multiplayer'}, seed ${msg.seed} · ` + this.controlsHint());
      this.refreshHearts(true);
      this.refreshMultiplayerPanel();
    } else if (msg.t === 'join') {
      this.addNetPeer(msg.id, {
        name: msg.name, color: msg.color, skin: msg.skin, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw,
      });
      this.hud.toast(`${msg.name} joined`, 1200);
      this.refreshMultiplayerPanel();
    } else if (msg.t === 'leave') {
      const peer = this.netPeers.get(msg.id);
      if (peer) this.hud.toast(`${peer.name} left`, 1200);
      this.removeNetPeer(msg.id);
      this.refreshMultiplayerPanel();
    } else if (msg.t === 'move') {
      const peer = this.netPeers.get(msg.id);
      if (peer) { peer.tx = msg.x; peer.ty = msg.y; peer.tz = msg.z; peer.tyaw = msg.yaw; peer.tpitch = Number(msg.pitch) || 0; }
    } else if (msg.t === 'skin') {
      this.setPeerSkin(msg.id, isValidSkinData(msg.skin) ? msg.skin : null);
    } else if (this.pvp && (msg.t === 'hurt' || msg.t === 'health' || msg.t === 'died' || msg.t === 'respawn')) {
      this.handlePvpMessage(msg);
    } else if (msg.t === 'edit') {
      const y = msg.y | 0;
      const b = msg.b | 0;
      if (y >= 0 && y < H && b >= 0 && b < BLOCKS.length) this.applyRemoteEdit(msg.x, y, msg.z, b);
    } else if (msg.t === 'chat') {
      this.hud.toast(`${msg.name}: ${msg.text}`, 2200);
      this.pushChat(msg.name, msg.text, false);
    }
  }

  addNetPeer(id, info) {
    if (this.netPeers.has(id)) return;
    const avatar = buildSkinnedPlayer(defaultSkinCanvas(info.color));
    avatar.group.position.set(info.x, info.y, info.z);
    this.scene.add(avatar.group);
    const tag = makeNameTag();
    this.scene.add(tag.sprite);
    this.netPeers.set(id, {
      avatar, tag, name: info.name, color: info.color, skinToken: 0,
      hp: Number(info.hp) || this.maxHp, dead: !!info.dead, kills: info.kills | 0, deaths: info.deaths | 0,
      x: info.x, y: info.y, z: info.z, yaw: info.yaw || 0,
      tx: info.x, ty: info.y, tz: info.z, tyaw: info.yaw || 0,
      pitch: 0, tpitch: 0, walk: 0, phase: 0,
    });
    this.setPeerSkin(id, isValidSkinData(info.skin) ? info.skin : null);
    this.drawPeerTag(this.netPeers.get(id));
  }

  drawPeerTag(peer) {
    peer.tag.draw(peer.name, this.pvp ? peer.hp / this.maxHp : null);
    peer.tag.sprite.visible = !peer.dead;
    peer.avatar.group.visible = !peer.dead;
  }

  removeNetPeer(id) {
    const peer = this.netPeers.get(id);
    if (!peer) return;
    this.scene.remove(peer.avatar.group);
    peer.avatar.dispose();
    this.scene.remove(peer.tag.sprite);
    peer.tag.dispose();
    this.netPeers.delete(id);
  }

  clearNetPeers() {
    for (const id of [...this.netPeers.keys()]) this.removeNetPeer(id);
  }

  /** Dresses a connected player in their imported skin (or, with `null`, back
   *  in the plain default). Decoding is async, so a token guards against an
   *  older, slower decode landing after a newer skin — or after they've left. */
  async setPeerSkin(id, skinData) {
    const peer = this.netPeers.get(id);
    if (!peer) return;
    const token = ++peer.skinToken;
    let canvas;
    try {
      canvas = skinData ? await skinFromDataURL(skinData) : defaultSkinCanvas(peer.color);
    } catch {
      canvas = defaultSkinCanvas(peer.color);   // a bad image just means the default look, never a crash
    }
    const live = this.netPeers.get(id);
    if (live !== peer || peer.skinToken !== token) return;
    const next = buildSkinnedPlayer(canvas);
    next.group.position.copy(peer.avatar.group.position);
    next.group.rotation.y = peer.avatar.group.rotation.y;
    this.scene.remove(peer.avatar.group);
    peer.avatar.dispose();
    peer.avatar = next;
    next.group.visible = !peer.dead;
    this.scene.add(next.group);
  }

  /** Sets (or, with `null`, clears) this player's own skin: remembers it,
   *  refreshes the preview, and — if connected or hosting — tells everyone. */
  async setOwnSkin(canvas) {
    this.skinCanvas = canvas;
    this.skinData = canvas ? skinToDataURL(canvas) : null;
    if (this.skinData && !isValidSkinData(this.skinData)) {   // a wildly noisy skin that won't fit the wire limit
      this.skinData = null;
      this.skinCanvas = null;
      this.hud.toast('That skin is too detailed to send — try another', 2200);
    }
    saveSkin(this.skinData);
    this.refreshSkinPreview();
    if (this.net && this.net.readyState === 1) {
      this.net.send(JSON.stringify({ t: 'skin', skin: this.skinData }));
    } else if (this.hostPeer) {
      this.hostBroadcast({ t: 'skin', id: 'host', skin: this.skinData });
    }
  }

  refreshSkinPreview() {
    const cv = this.mpPanel?.querySelector('.bc-skin-preview');
    if (!cv) return;
    drawSkinPreview(cv, this.skinCanvas || defaultSkinCanvas('#5ad1ff'));
  }

  /** Reads a picked/dropped skin file, applies it, and reports any problem. */
  async importSkin(file) {
    try {
      const canvas = await importSkinFile(file);
      await this.setOwnSkin(canvas);
      if (this.skinData) this.hud.toast('SKIN IMPORTED', 1400);
    } catch (err) {
      this.hud.toast(err?.message || 'Could not read that skin', 2600);
    }
  }

  /* ------------------------------------------------------------------ PvP */

  /** hurt / health / died / respawn from a PvP server. The server decides all
   *  of it; this just shows the result — hearts, knockback, the kill feed,
   *  the death screen and the scoreboard. */
  handlePvpMessage(msg) {
    const me = msg.id === this.netId;
    const peer = this.netPeers.get(msg.id);

    if (msg.t === 'hurt') {
      if (me) {
        this.setHp(msg.hp);
        this.vel.x += Number(msg.kx) || 0;
        this.vel.z += Number(msg.kz) || 0;
        this.vel.y = Math.max(this.vel.y, 5);
        this.flashHurt();
        this.audio.tone(140, 0.12, { type: 'sawtooth', gain: 0.12 });
      } else if (peer) {
        peer.hp = msg.hp;
        this.drawPeerTag(peer);
      }
    } else if (msg.t === 'health') {
      if (me) this.setHp(msg.hp);
      else if (peer) { peer.hp = msg.hp; this.drawPeerTag(peer); }
    } else if (msg.t === 'died') {
      const killerIsMe = msg.by === this.netId;
      if (me) {
        this.dead = true;
        this.deaths = msg.deaths | 0;
        this.setHp(0);
        this.showDeath(`Killed by ${String(msg.byName).slice(0, 16)}`);
      } else if (peer) {
        peer.dead = true;
        peer.deaths = msg.deaths | 0;
        peer.hp = 0;
        this.drawPeerTag(peer);
      }
      if (killerIsMe) { this.kills = msg.byKills | 0; this.audio.good(); }
      else if (this.netPeers.has(msg.by)) this.netPeers.get(msg.by).kills = msg.byKills | 0;
      const line = `${String(msg.byName).slice(0, 16)} killed ${String(msg.name).slice(0, 16)}`;
      this.pushChat('⚔', line, false);
      this.hud.toast(killerIsMe ? `You killed ${String(msg.name).slice(0, 16)}` : line, 1800);
      this.refreshMultiplayerPanel();
    } else if (msg.t === 'respawn') {
      if (me) {
        this.dead = false;
        this.pos.copy(this.spawnPos);
        this.vel.set(0, 0, 0);
        this.updateStreaming(true);
        this.setHp(msg.hp);
        this.showDeath(null);
      } else if (peer) {
        peer.dead = false;
        peer.hp = msg.hp;
        peer.x = peer.tx = this.spawnPos.x; peer.y = peer.ty = this.spawnPos.y; peer.z = peer.tz = this.spawnPos.z;
        this.drawPeerTag(peer);
      }
    }
  }

  setHp(hp) {
    this.hp = clamp(Number(hp) || 0, 0, this.maxHp);
    this.refreshHearts();
  }

  /** Redraws the row of hearts (10 of them; each is 2 hp, so half hearts
   *  show) — only when the number actually changed, or when forced. */
  refreshHearts(force = false) {
    const el = this.hud.$panel?.querySelector('.bc-hearts');
    if (!el) return;
    el.hidden = !this.pvp;
    if (!this.pvp) { this.heartsShown = -1; return; }
    if (!force && this.heartsShown === this.hp) return;
    this.heartsShown = this.hp;
    const n = Math.ceil(this.maxHp / 2);
    let html = '';
    for (let i = 0; i < n; i++) {
      const cls = this.hp >= 2 * (i + 1) ? 'full' : this.hp === 2 * i + 1 ? 'half' : 'empty';
      html += `<span class="bc-heart ${cls}">♥</span>`;
    }
    el.innerHTML = html;
    el.classList.toggle('low', this.hp > 0 && this.hp <= 6);
  }

  flashHurt() {
    const el = this.hud.$panel?.querySelector('.bc-hurt');
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '0.55';
    void el.offsetWidth;   // restart the transition
    el.style.transition = 'opacity .5s ease-out';
    el.style.opacity = '0';
  }

  showDeath(text) {
    const el = this.hud.$panel?.querySelector('.bc-death');
    if (!el) return;
    el.hidden = !text;
    if (text) el.querySelector('.bc-death-by').textContent = text;
  }

  /** Back to ordinary (non-PvP) play: no hearts, no death screen. */
  resetPvp() {
    this.pvp = false;
    this.dead = false;
    this.hp = this.maxHp = 20;
    this.kills = 0;
    this.deaths = 0;
    this.refreshHearts(true);
    this.showDeath(null);
  }

  /** Wires the Multiplayer panel: name field, server address field, and the
   *  Connect/Disconnect toggle, plus renders its own status/player list. */
  bindMultiplayerPanel() {
    const panel = this.hud.$panel;
    if (!panel) return;
    this.mpPanel = panel;

    const nameInput = panel.querySelector('.bc-name-input');
    const serverInput = panel.querySelector('.bc-server-input');
    const connectBtn = panel.querySelector('.bc-connect');
    const hostBtn = panel.querySelector('.bc-host');
    const copyBtn = panel.querySelector('.bc-copy-code');
    nameInput?.addEventListener('pointerdown', (e) => e.stopPropagation());
    nameInput?.addEventListener('keydown', (e) => e.stopPropagation());
    serverInput?.addEventListener('pointerdown', (e) => e.stopPropagation());
    serverInput?.addEventListener('keydown', (e) => e.stopPropagation());
    connectBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    hostBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    copyBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());

    if (nameInput) nameInput.value = this.playerName;

    const skinFile = panel.querySelector('.bc-skin-file');
    const skinImport = panel.querySelector('.bc-skin-import');
    const skinReset = panel.querySelector('.bc-skin-reset');
    for (const el of [skinImport, skinReset, skinFile]) el?.addEventListener('pointerdown', (e) => e.stopPropagation());
    skinImport?.addEventListener('click', () => skinFile?.click());
    skinFile?.addEventListener('change', () => {
      const f = skinFile.files?.[0];
      skinFile.value = '';   // so picking the same file again still fires 'change'
      if (f) this.importSkin(f);
    });
    skinReset?.addEventListener('click', () => { this.setOwnSkin(null); this.hud.toast('SKIN RESET', 1000); });
    panel.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    panel.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      this.importSkin(f);
    });
    if (this.skinData && !this.skinCanvas) {   // restore last session's skin
      skinFromDataURL(this.skinData).then((c) => { this.skinCanvas = c; this.refreshSkinPreview(); }, () => {});
    }
    this.refreshSkinPreview();
    if (serverInput) serverInput.value = loadLastServer();

    nameInput?.addEventListener('change', () => {
      this.playerName = nameInput.value.trim().slice(0, 16) || 'Player';
      savePlayerName(this.playerName);
    });

    connectBtn?.addEventListener('click', () => {
      if (this.net) {
        this.disconnectMultiplayer();
        this.hud.toast('DISCONNECTED', 1000);
        return;
      }
      if (this.hostPeer) return;   // Host is the active mode; Connect is disabled, but guard anyway
      const url = serverInput?.value.trim();
      if (!url) { this.hud.toast('Enter a server address or host code first', 1600); return; }
      saveLastServer(url);
      this.connectMultiplayer(url);
    });

    hostBtn?.addEventListener('click', () => {
      if (this.hostPeer) {
        this.stopHosting();
        this.refreshMultiplayerPanel();
        this.hud.toast('STOPPED HOSTING', 1000);
        return;
      }
      if (this.net) return;   // Connect is the active mode; Host is disabled, but guard anyway
      this.hostMultiplayer();
    });

    const pvpBtn = panel.querySelector('.bc-pvp-join');
    pvpBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    pvpBtn?.addEventListener('click', () => {
      if (this.hostPeer) return;   // hosting your own game is the active mode
      if (serverInput) serverInput.value = PVP_SERVER_URL;
      saveLastServer(PVP_SERVER_URL);
      this.connectMultiplayer(PVP_SERVER_URL);
    });

    const listBox = panel.querySelector('.bc-list-public');
    const srvRefresh = panel.querySelector('.bc-srv-refresh');
    const srvList = panel.querySelector('.bc-srv-list');
    for (const el of [listBox, srvRefresh, srvList]) el?.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (listBox) {
      listBox.checked = this.listPublic;
      listBox.addEventListener('change', () => {
        this.listPublic = listBox.checked;
        saveListPublic(this.listPublic);
        if (this.hostPeer) {
          if (this.listPublic) this.startAnnounce();
          else { this.stopAnnounce(); }
        }
      });
    }
    srvRefresh?.addEventListener('click', () => this.refreshServerList());
    srvList?.addEventListener('click', (e) => {
      const target = e.target.closest?.('button[data-join]');
      if (!target) return;
      if (this.hostPeer) { this.hud.toast('Stop hosting before joining another game', 1800); return; }
      const addr = target.dataset.join;
      if (serverInput) serverInput.value = addr;
      saveLastServer(addr);
      this.connectMultiplayer(addr);
    });
    this.refreshServerList();

    copyBtn?.addEventListener('click', () => {
      if (!this.hostCode) return;
      navigator.clipboard?.writeText?.(this.hostCode).then(
        () => this.hud.toast('CODE COPIED', 1000),
        () => this.hud.toast(this.hostCode, 2400),   // clipboard blocked — at least show it long enough to read
      );
    });

    const chatInput = panel.querySelector('.bc-chat-input');
    const chatSend = panel.querySelector('.bc-chat-send');
    chatInput?.addEventListener('pointerdown', (e) => e.stopPropagation());
    chatInput?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.sendChat();
    });
    chatSend?.addEventListener('pointerdown', (e) => e.stopPropagation());
    chatSend?.addEventListener('click', () => this.sendChat());

    this.refreshMultiplayerPanel();
    this.renderChatLog();
  }

  /** Sends whatever's typed in the chat box (if there's a server to send it
   *  to and anything to send), echoing it into the local log immediately —
   *  the server only relays a chat message to *other* players, not back to
   *  whoever sent it. */
  sendChat() {
    const input = this.mpPanel?.querySelector('.bc-chat-input');
    const text = input?.value.trim();
    if (!text) return;
    if (this.net && this.net.readyState === 1) {
      this.net.send(JSON.stringify({ t: 'chat', text }));
    } else if (this.hostPeer) {
      this.hostBroadcast({ t: 'chat', id: 'host', name: this.playerName, text });
    } else {
      return;   // not connected to (or hosting) anything
    }
    this.pushChat(this.playerName, text, true);
    if (input) input.value = '';
  }

  /** Appends one line to the chat scrollback (capped so it can't grow
   *  forever across a long session) and re-renders it. */
  pushChat(name, text, self = false) {
    this.chatLog.push({ name, text, self });
    if (this.chatLog.length > 30) this.chatLog.shift();
    this.renderChatLog();
  }

  renderChatLog() {
    const log = this.mpPanel?.querySelector('.bc-mp-chat');
    if (!log) return;
    log.innerHTML = this.chatLog.map((m) => (
      `<div class="bc-mp-msg${m.self ? ' self' : ''}"><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`
    )).join('');
    log.scrollTop = log.scrollHeight;
  }

  /** Re-renders the connect button label, status line, and connected-player
   *  list — called on every state change (connecting/online/offline, peers
   *  joining or leaving). */
  refreshMultiplayerPanel() {
    const panel = this.mpPanel;
    if (!panel) return;
    const connectBtn = panel.querySelector('.bc-connect');
    const hostBtn = panel.querySelector('.bc-host');
    const hostCode = panel.querySelector('.bc-host-code');
    const status = panel.querySelector('.bc-mp-status');
    const list = panel.querySelector('.bc-mp-players');
    if (connectBtn) {
      connectBtn.textContent = this.net ? 'Disconnect' : 'Connect';
      connectBtn.classList.toggle('on', !!this.net);
      connectBtn.disabled = this.netMode === 'host';
    }
    if (hostBtn) {
      hostBtn.textContent = this.hostPeer ? 'Stop Hosting' : 'Host';
      hostBtn.classList.toggle('on', !!this.hostPeer);
      hostBtn.disabled = this.netMode === 'client';
    }
    if (hostCode) {
      hostCode.hidden = !this.hostCode;
      const code = hostCode.querySelector('code');
      if (code) code.textContent = this.hostCode || '';
    }
    if (status) {
      status.textContent = this.netStatus === 'online' && this.netMode === 'host' ? `Hosting · ${this.netPeers.size + 1} playing`
        : this.netStatus === 'online' ? `Online · ${this.netPeers.size + 1} playing`
          : this.netStatus === 'connecting' ? (this.netMode === 'host' ? 'Starting up…' : 'Connecting…')
            : 'Offline — playing solo';
    }
    if (list) {
      const score = (k, d) => (this.pvp ? `<span class="bc-mp-score">⚔${k} ☠${d}</span>` : '');
      const me = this.pvp && this.net
        ? `<div class="bc-mp-player"><span class="bc-mp-dot" style="background:#fff"></span>You${score(this.kills, this.deaths)}</div>` : '';
      list.innerHTML = me + [...this.netPeers.values()].map((p) => (
        `<div class="bc-mp-player"><span class="bc-mp-dot" style="background:${escapeHtml(p.color)}"></span>${escapeHtml(p.name)}${score(p.kills, p.deaths)}</div>`
      )).join('');
    }
  }

  intersectsPlayer(x, y, z) {
    const R = 0.3;
    return x + 1 > this.pos.x - R && x < this.pos.x + R
      && z + 1 > this.pos.z - R && z < this.pos.z + R
      && y + 1 > this.pos.y && y < this.pos.y + 1.8;
  }

  selectSlot(i) {
    this.slot = i;
    this.refreshHotbar();
    this.audio.blip(2);
  }

  refreshHotbar() {
    const el = this.hud.$panel?.querySelector('.bc-hotbar');
    if (!el) return;
    el.querySelectorAll('.bc-slot').forEach((s, i) => {
      s.classList.toggle('on', i === this.slot);
    });
    const label = this.hud.$panel.querySelector('.bc-name');
    if (label) label.textContent = HOTBAR[this.slot] === SWORD ? 'Sword' : BLOCKS[HOTBAR[this.slot]].name;
  }

  dispose() {
    this.input.exitLock();
    if (this.net) { const ws = this.net; this.net = null; try { ws.close(); } catch { /* ignore */ } }
    this.stopHosting();
    if (this.dirty && !this.multiplayer) { this.save(); this.dirty = false; }
  }
}

/** A handful of flat slabs drifting overhead, well above the build height.
 *  Spawns near the origin — driftClouds() re-centers them on the player
 *  every frame, so this starting spread only matters for the first moment. */
function buildClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false,
  });
  const rng = seeded(4242);
  for (let i = 0; i < 16; i++) {
    const w = 10 + rng() * 22;
    const d = 8 + rng() * 16;
    const span = 110;
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(w, 2 + rng() * 2, d), mat);
    cloud.position.set(rng() * span * 2 - span, H + 14 + rng() * 10, rng() * span * 2 - span);
    cloud.userData.speed = 0.7 + rng() * 1.1;
    group.add(cloud);
  }
  return group;
}

/** A floating name (and, in PvP, health bar) above another player — a sprite
 *  that always faces the camera. draw(name, frac) repaints it; frac is 0..1
 *  health, or null to leave the bar off. */
function makeNameTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.6, 0.4, 1);
  return {
    sprite,
    draw(name, frac) {
      if (typeof ctx.fillText !== 'function') return;   // a stub 2D context (tests) can't draw text
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(name, 128, 28);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, 128, 28);
      if (frac !== null) {
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(48, 40, 160, 14);
        ctx.fillStyle = frac > 0.3 ? '#ff4d5e' : '#ffb020';
        ctx.fillRect(50, 42, 156 * Math.max(0, Math.min(1, frac)), 10);
      }
      texture.needsUpdate = true;
    },
    dispose() { texture.dispose(); material.dispose(); },
  };
}

/** PvP overlays: the row of hearts, the red damage flash, and the "you died"
 *  screen. All hidden until a PvP server's welcome turns them on. */
function pvpHtml() {
  return `
    <style>
      .bc-hearts { position:absolute; left:50%; bottom:132px; transform:translateX(-50%);
        display:flex; gap:2px; pointer-events:none; }
      .bc-hearts[hidden] { display:none; }
      .bc-heart { font:400 24px/1 system-ui; color:#ff4d5e; text-shadow:0 2px 4px rgba(0,0,0,.7); }
      .bc-heart.empty { color:rgba(255,255,255,.28); }
      .bc-heart.half { background:linear-gradient(90deg,#ff4d5e 50%,rgba(255,255,255,.28) 50%);
        -webkit-background-clip:text; background-clip:text; color:transparent; text-shadow:none; }
      .bc-hearts.low .bc-heart.full, .bc-hearts.low .bc-heart.half { animation:bc-pulse .7s ease-in-out infinite alternate; }
      @keyframes bc-pulse { to { transform:scale(1.18); } }
      .bc-hurt { position:absolute; inset:0; pointer-events:none; opacity:0;
        background:radial-gradient(ellipse at center, rgba(255,0,0,0) 35%, rgba(200,0,0,.85) 100%); }
      .bc-death { position:absolute; inset:0; display:grid; place-content:center; text-align:center;
        background:rgba(120,0,0,.5); pointer-events:none; color:#fff; }
      .bc-death[hidden] { display:none; }
      .bc-death h2 { margin:0 0 6px; font:800 44px system-ui; text-shadow:0 4px 14px rgba(0,0,0,.6); }
      .bc-death p { margin:0; font:600 16px system-ui; opacity:.9; }
    </style>
    <div class="bc-hurt"></div>
    <div class="bc-hearts" hidden></div>
    <div class="bc-death" hidden><h2>You died</h2><p class="bc-death-by"></p><p>Respawning…</p></div>`;
}

/* ------------------------------------------------------------- generation */

/** Layered value noise for elevation. A stationary field — statistically the
 *  same everywhere — which is exactly what makes chunk-at-a-time generation
 *  possible: any column can be evaluated on its own, in any order. */
function fieldAt(x, z, seed) {
  let e = 0;
  let amp = 1;
  let freq = 0.012;
  let sum = 0;
  for (let o = 0; o < 4; o++) {
    e += noise2(x * freq, z * freq, seed + o * 71) * amp;
    sum += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return e / sum;
}

/**
 * Fits the height curve to this seed's own spread rather than to fixed
 * constants — a flat mapping left some seeds with no sea at all and others
 * half drowned. Pinning the 30th percentile to the waterline gives every
 * seed a coast. There's no whole world to scan any more, so this samples a
 * large, sparse, deterministic spread of columns instead: since the field is
 * stationary, that sample's percentiles match the true (infinite) field's.
 */
function calibrateHeight(seed) {
  const N = 96;
  const STRIDE = 37;   // no relation to the noise's own frequencies, so it can't alias with them
  const samples = new Float32Array(N * N);
  let i = 0;
  for (let sz = 0; sz < N; sz++) {
    for (let sx = 0; sx < N; sx++) {
      samples[i++] = fieldAt((sx - N / 2) * STRIDE, (sz - N / 2) * STRIDE, seed);
    }
  }
  const sorted = Float32Array.from(samples).sort();
  return {
    low: sorted[0],
    shore: sorted[Math.floor(sorted.length * 0.3)],
    peak: sorted[Math.floor(sorted.length * 0.995)],
  };
}

function heightAt(x, z, seed, cal) {
  const e = fieldAt(x, z, seed);
  const h = e <= cal.shore
    ? Math.round(lerp(2, SEA, invLerp(cal.low, cal.shore, e)))
    : Math.round(lerp(SEA, H - 6, clamp(invLerp(cal.shore, cal.peak, e), 0, 1) ** 1.15));
  return clamp(h, 1, H - 6);
}

/** Whether world column (x,z) roots a tree, and if so its trunk height — a
 *  pure function of the column, so it comes out the same regardless of
 *  which chunk asks (needed since a canopy can cross into a neighbour). */
function treeAt(x, z, seed, cal) {
  const h = heightAt(x, z, seed, cal);
  if (h < SEA + 2 || h > 26) return null;               // underwater/beach or above the treeline
  if (hash2(x, z, seed ^ 0x5eed) > 0.012) return null;   // ~1.2% of eligible columns
  return { y: h, trunk: 4 + Math.floor(hash2(x, z, seed ^ 0x7a11) * 3) };
}

/** Generates one CHUNK x H x CHUNK slice of terrain in world coordinates
 *  (cx, cz are chunk indices, so world x/z run from cx*CHUNK for CHUNK
 *  blocks). Deterministic from (cx, cz, seed) alone — regenerating the same
 *  chunk always reproduces the same terrain, which is what lets an infinite
 *  world be saved as "just the edits" instead of the whole thing. */
function generateChunk(cx, cz, seed, cal) {
  const data = new Uint8Array(CHUNK * H * CHUNK);
  const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;
  const ox = cx * CHUNK;
  const oz = cz * CHUNK;

  const heights = new Int16Array(CHUNK * CHUNK);
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const h = heightAt(ox + lx, oz + lz, seed, cal);
      heights[lz * CHUNK + lx] = h;
      const beach = h <= SEA + 1;

      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = AIR;
        if (y <= h) {
          if (y === h) id = beach ? 4 : 1;
          else if (y > h - 4) id = beach ? 4 : 2;
          else id = 3;
        } else if (y <= SEA) {
          id = WATER;
        }
        if (id !== AIR) data[idx(lx, y, lz)] = id;
      }

      // Snow caps
      if (h > 26) data[idx(lx, h, lz)] = 13;
    }
  }

  // Caves. Carved from 3D noise, but never within three blocks of the surface:
  // that crust is what stops the sea draining into them and the hills going hollow.
  for (let y = 2; y < H - 6; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const i = idx(lx, y, lz);
        const id = data[i];
        if (id !== 3 && id !== 2) continue;
        if (y > heights[lz * CHUNK + lx] - 3) continue;
        if (noise3((ox + lx) * 0.085, y * 0.13, (oz + lz) * 0.085, seed + 313) > 0.655) data[i] = AIR;
      }
    }
  }

  // Ore veins: coal near the surface, iron below it, gold only in the deep.
  const VEINS = [
    { id: 15, top: 26, freq: 0.34, cut: 0.845 },
    { id: 16, top: 17, freq: 0.4, cut: 0.86 },
    { id: 12, top: 10, freq: 0.46, cut: 0.885 },
  ];
  for (let y = 1; y < 27; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const i = idx(lx, y, lz);
        if (data[i] !== 3) continue;
        const wx = ox + lx;
        const wz = oz + lz;
        for (const v of VEINS) {
          if (y > v.top) continue;
          if (noise3(wx * v.freq, y * v.freq, wz * v.freq, seed + v.id * 77) > v.cut) {
            data[i] = v.id;
            break;
          }
        }
      }
    }
  }

  // Trees on grass, away from the shoreline. Scanned over a margin beyond
  // this chunk's own footprint so a tree rooted in a neighbouring chunk can
  // still paint canopy in here — and this chunk's own trees paint into the
  // neighbour the same way when it's that one's turn to generate.
  const MARGIN = 3;
  for (let wz = oz - MARGIN; wz < oz + CHUNK + MARGIN; wz++) {
    for (let wx = ox - MARGIN; wx < ox + CHUNK + MARGIN; wx++) {
      const tree = treeAt(wx, wz, seed, cal);
      if (!tree) continue;
      const { y, trunk } = tree;
      for (let i = 1; i <= trunk; i++) {
        const lx = wx - ox;
        const lz = wz - oz;
        const yy = y + i;
        if (lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && yy < H) data[idx(lx, yy, lz)] = 5;
      }
      const top = y + trunk;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy >= 1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const leafX = wx + dx;
            const leafZ = wz + dz;
            if (Math.abs(dx) === r && Math.abs(dz) === r
              && hash3(leafX, top + dy, leafZ, seed ^ 0x9a1e) < 0.6) continue;
            const lx = leafX - ox;
            const lz = leafZ - oz;
            const yy = top + dy;
            if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || yy >= H) continue;
            const i = idx(lx, yy, lz);
            if (data[i] === AIR) data[i] = 6;
          }
        }
      }
    }
  }

  return data;
}

function hash2(x, z, seed) {
  // Math.imul throughout: this hash relies on 32-bit wraparound, and plain `*`
  // silently loses the low bits once the product passes 2^53.
  let n = (Math.imul(x | 0, 1619) + Math.imul(z | 0, 31337) + Math.imul(seed | 0, 1013)) | 0;
  n = (n << 13) ^ n;
  const m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
  n = (Math.imul(n, m) + 1376312589) | 0;
  return (n & 0x7fffffff) / 0x7fffffff;
}

function hash3(x, y, z, seed) {
  let n = (Math.imul(x | 0, 1619) + Math.imul(y | 0, 6971)
    + Math.imul(z | 0, 31337) + Math.imul(seed | 0, 1013)) | 0;
  n = (n << 13) ^ n;
  const m = (Math.imul(Math.imul(n, n), 15731) + 789221) | 0;
  n = (Math.imul(n, m) + 1376312589) | 0;
  return (n & 0x7fffffff) / 0x7fffffff;
}

/** Trilinear value noise — the cave and vein shapes come out of this. */
function noise3(x, y, z, seed) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

function noise2(x, z, seed) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(
    lerp(hash2(xi, zi, seed), hash2(xi + 1, zi, seed), u),
    lerp(hash2(xi, zi + 1, seed), hash2(xi + 1, zi + 1, seed), u),
    v,
  );
}

/* ------------------------------------------------------------------- save */

const randomSeed = () => (Math.random() * 0x7fffffff) | 0;

/** Lets a player type any word as a seed, not just digits. */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Run-length encodes one chunk's voxel data: real terrain is mostly long
 *  runs of the same block, so an edited chunk still saves small. */
function rleEncode(voxels) {
  const out = [];
  const n = voxels.length;
  let i = 0;
  while (i < n) {
    const v = voxels[i];
    let run = 1;
    while (i + run < n && voxels[i + run] === v && run < 0xffff) run++;
    out.push(v, run);
    i += run;
  }
  return out;
}

function rleDecode(pairs, total) {
  const out = new Uint8Array(total);
  let i = 0;
  for (let p = 0; p < pairs.length; p += 2) {
    out.fill(pairs[p], i, i + pairs[p + 1]);
    i += pairs[p + 1];
  }
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Every localStorage touch below is try/catched: private-mode/full-storage
// browsers can throw on read or write, and the Node test harness has no
// `localStorage` global at all, which throws a ReferenceError just as easily.

function loadViewDist() {
  try {
    const v = Number(localStorage.getItem(VIEW_DIST_KEY));
    return VIEW_DISTANCES.some((d) => d.chunks === v) ? v : DEFAULT_VIEW_DIST;
  } catch {
    return DEFAULT_VIEW_DIST;
  }
}

function saveViewDist(chunks) {
  try { localStorage.setItem(VIEW_DIST_KEY, String(chunks)); } catch { /* ignore */ }
}

function loadPlayerName() {
  try { return localStorage.getItem(MP_NAME_KEY) || `Player${((Math.random() * 9000) | 0) + 1000}`; }
  catch { return 'Player'; }
}

function savePlayerName(name) {
  try { localStorage.setItem(MP_NAME_KEY, name); } catch { /* ignore */ }
}

function loadSkin() {
  try {
    const s = localStorage.getItem(MP_SKIN_KEY);
    return isValidSkinData(s) ? s : null;
  } catch { return null; }
}

function saveSkin(data) {
  try {
    if (data) localStorage.setItem(MP_SKIN_KEY, data);
    else localStorage.removeItem(MP_SKIN_KEY);
  } catch { /* ignore */ }
}

function loadListPublic() {
  try { return localStorage.getItem(MP_LIST_KEY) === '1'; } catch { return false; }
}

function saveListPublic(on) {
  try { localStorage.setItem(MP_LIST_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

function loadLastServer() {
  try { return localStorage.getItem(MP_SERVER_KEY) || ''; } catch { return ''; }
}

function saveLastServer(url) {
  try { localStorage.setItem(MP_SERVER_KEY, url); } catch { /* ignore */ }
}

/** The world index: name/seed/last-saved-at for every world, newest first.
 *  Small and cheap to read/write on its own — the (potentially large) per-
 *  chunk edit data lives separately, one key per world. */
function loadWorldList() {
  try {
    const raw = localStorage.getItem(WORLDS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeWorldList(list) {
  try { localStorage.setItem(WORLDS_KEY, JSON.stringify(list)); } catch { /* full, or private mode */ }
}

function loadWorldData(id) {
  try {
    const raw = localStorage.getItem(worldDataKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.edits !== 'object' || !data.pos) return null;
    return data;
  } catch {
    return null;
  }
}

function writeWorldData(id, data) {
  try { localStorage.setItem(worldDataKey(id), JSON.stringify(data)); } catch { /* full, or private mode */ }
}

function deleteWorld(id) {
  try {
    localStorage.removeItem(worldDataKey(id));
    writeWorldList(loadWorldList().filter((w) => w.id !== id));
  } catch { /* ignore */ }
}

function getActiveWorldId() {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

function setActiveWorldId(id) {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
}

/**
 * There's no backend here, so "backup across devices" means a file the
 * player moves themselves: export bundles every saved world (metadata +
 * its edits) into one JSON blob; import merges one back in.
 */
function exportAllWorlds() {
  const worlds = loadWorldList()
    .map((meta) => ({ meta, data: loadWorldData(meta.id) }))
    .filter((w) => w.data);
  return JSON.stringify({ version: 1, exportedAt: Date.now(), worlds });
}

/** Merges an exported bundle into local storage. A world already present
 *  keeps whichever copy was saved more recently, so exporting from one
 *  device and importing on another is safe to do in either direction —
 *  it can't clobber newer progress with an older backup. Returns how many
 *  worlds were actually added or updated. */
function importWorldsBundle(json) {
  const bundle = JSON.parse(json);
  if (!bundle || !Array.isArray(bundle.worlds)) throw new Error('not a worlds backup file');
  const byId = new Map(loadWorldList().map((w) => [w.id, w]));
  let changed = 0;
  for (const entry of bundle.worlds) {
    const { meta, data } = entry ?? {};
    if (!meta?.id || !data) continue;
    const existing = byId.get(meta.id);
    if (existing && (existing.savedAt || 0) >= (meta.savedAt || 0)) continue;
    byId.set(meta.id, meta);
    writeWorldData(meta.id, data);
    changed++;
  }
  writeWorldList([...byId.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
  return changed;
}

/* ------------------------------------------------------------------ atlas */

const ATLAS_N = 5;      // 5 x 5 tiles
const TILE = 16;        // pixels per tile

function tileUV(tile, u, v) {
  const col = tile % ATLAS_N;
  const row = Math.floor(tile / ATLAS_N);
  return [(col + u) / ATLAS_N, ((ATLAS_N - 1 - row) + v) / ATLAS_N];
}

/** Paints the block texture atlas procedurally — no image files anywhere. */
function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = ATLAS_N * TILE;
  c.height = ATLAS_N * TILE;
  const g = c.getContext('2d');
  const rng = seeded(7);

  const px = (t, x, y, colour) => {
    g.fillStyle = colour;
    g.fillRect((t % ATLAS_N) * TILE + x, Math.floor(t / ATLAS_N) * TILE + y, 1, 1);
  };
  const fill = (t, colour) => {
    g.fillStyle = colour;
    g.fillRect((t % ATLAS_N) * TILE, Math.floor(t / ATLAS_N) * TILE, TILE, TILE);
  };
  const speckle = (t, base, shades) => {
    fill(t, base);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (rng() < 0.42) px(t, x, y, shades[(rng() * shades.length) | 0]);
      }
    }
  };

  // A punchier, more saturated palette — closer to Minecraft's own vivid,
  // high-contrast block textures than a naturalistic one would be.
  speckle(0, '#6bbf3a', ['#7fd94a', '#59a52c', '#8ee35c']);                 // grass top
  speckle(2, '#8b6239', ['#7a5029', '#a1774a', '#6e4a29']);                 // dirt
  speckle(1, '#8b6239', ['#7a5029', '#a1774a']);                            // grass side (dirt base)
  for (let x = 0; x < TILE; x++) {
    const lip = 3 + ((rng() * 2) | 0);
    for (let y = 0; y < lip; y++) px(1, x, y, rng() < 0.5 ? '#6bbf3a' : '#7fd94a');
  }
  speckle(3, '#8c8c96', ['#a0a0aa', '#787882', '#6c6c76']);                 // stone
  speckle(4, '#ecdfab', ['#f6ecc1', '#ddca92', '#f0e2b8']);                 // sand
  speckle(5, '#6e4a2a', ['#4f3319', '#835730']);                           // log side
  for (let y = 0; y < TILE; y++) {
    for (const x of [2, 3, 8, 9, 13]) px(5, x, y, rng() < 0.7 ? '#4f3319' : '#6e4a2a');
  }
  speckle(6, '#c9a869', ['#b7935a', '#dab97a']);                           // log end
  for (let r = 2; r < 8; r += 2) {
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      px(6, (8 + Math.cos(t) * r) | 0, (8 + Math.sin(t) * r) | 0, '#8f6d3f');
    }
  }
  speckle(7, '#3f9a2a', ['#4fb436', '#2f7a1e', '#63cc48']);                 // leaves
  fill(8, '#bd8f56');                                                       // planks
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (y % 4 === 3) px(8, x, y, '#8f6a3a');
      else if (rng() < 0.25) px(8, x, y, '#d5a86b');
    }
  }
  fill(9, '#a94a3a');                                                       // brick
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const row = Math.floor(y / 4);
      if (y % 4 === 0 || (x + (row % 2) * 4) % 8 === 0) px(9, x, y, '#ded4c6');
      else if (rng() < 0.18) px(9, x, y, '#c65e4c');
    }
  }
  speckle(10, '#87878f', ['#68686f', '#a3a3ab', '#57575e']);               // cobble
  fill(11, '#cdeaf5');                                                      // glass
  for (let i = 0; i < TILE; i++) {
    px(11, i, 0, '#ffffff'); px(11, i, TILE - 1, '#ffffff');
    px(11, 0, i, '#ffffff'); px(11, TILE - 1, i, '#ffffff');
  }
  fill(12, '#2e72e6');                                                      // water
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if ((x + y * 2 + ((rng() * 2) | 0)) % 7 === 0) px(12, x, y, '#5ea3f7');
    }
  }
  speckle(13, '#8c8c96', ['#a0a0aa', '#787882']);                          // gold ore
  for (let i = 0; i < 16; i++) px(13, (rng() * TILE) | 0, (rng() * TILE) | 0, '#ffd83f');
  speckle(14, '#f6faff', ['#ffffff', '#e6effc']);                          // snow
  speckle(15, '#1a1526', ['#251d3a', '#0e0c18']);                          // obsidian
  speckle(16, '#8c8c96', ['#a0a0aa', '#787882']);                          // coal ore
  for (let i = 0; i < 22; i++) {
    const x = (rng() * (TILE - 2)) | 0;
    const y = (rng() * (TILE - 2)) | 0;
    px(16, x, y, '#1c1c20'); px(16, x + 1, y, '#101013'); px(16, x, y + 1, '#28282e');
  }
  speckle(17, '#8c8c96', ['#a0a0aa', '#787882']);                          // iron ore
  for (let i = 0; i < 20; i++) {
    const x = (rng() * (TILE - 2)) | 0;
    const y = (rng() * (TILE - 2)) | 0;
    px(17, x, y, '#e3c19a'); px(17, x + 1, y, '#d0a87e'); px(17, x, y + 1, '#f2d6b2');
  }

  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* -------------------------------------------------------------- hotbar UI */

const SWORD_ICON = `<svg class="bc-sword-icon" viewBox="0 0 32 32" width="30" height="30" aria-label="Sword">
  <path d="M27 3 L29 5 L14 20 L12 18 Z" fill="#dfe8f5" stroke="#8ea0b8" stroke-width="1"/>
  <path d="M8 16 L16 24 L14 26 L6 18 Z" fill="#d4a72c" stroke="#8a6a12" stroke-width="1"/>
  <path d="M9 19 L13 23 L5 29 L3 27 Z" fill="#6b4423" stroke="#3d2610" stroke-width="1"/>
</svg>`;

function hotbarHtml() {
  const slots = HOTBAR.map((id, i) => `
    <div class="bc-slot${i === 1 ? ' on' : ''}">
      <span class="bc-key">${(i + 1) % 10}</span>
      ${id === SWORD ? SWORD_ICON : `<span class="bc-swatch" style="background:${SWATCH[id]}"></span>`}
    </div>`).join('');
  return `
    <style>
      .bc-cross { position:absolute; left:50%; top:50%; width:18px; height:18px;
        margin:-9px 0 0 -9px; }
      .bc-cross:before, .bc-cross:after { content:''; position:absolute; background:rgba(255,255,255,.75);
        box-shadow:0 0 2px rgba(0,0,0,.8); }
      .bc-cross:before { left:8px; top:0; width:2px; height:18px; }
      .bc-cross:after { top:8px; left:0; height:2px; width:18px; }
      .bc-hotbar { position:absolute; left:50%; bottom:56px; transform:translateX(-50%);
        display:flex; gap:4px; padding:4px; background:rgba(10,14,24,.55);
        border:1px solid rgba(255,255,255,.15); border-radius:8px; }
      .bc-slot { position:relative; width:44px; height:44px; border-radius:5px;
        border:2px solid rgba(255,255,255,.12); display:grid; place-items:center;
        pointer-events:auto; cursor:pointer; }
      .bc-slot.on { border-color:#fff; background:rgba(255,255,255,.12); }
      .bc-key { position:absolute; top:1px; left:4px; font:700 9px system-ui; color:rgba(255,255,255,.6); }
      .bc-swatch { width:26px; height:26px; border-radius:3px; box-shadow:inset 0 -8px 10px rgba(0,0,0,.35); }
      .bc-name { position:absolute; left:50%; bottom:108px; transform:translateX(-50%);
        font:700 13px system-ui; color:#fff; text-shadow:0 2px 6px rgba(0,0,0,.8); }
    </style>
    <div class="bc-cross"></div>
    <div class="bc-name">Grass</div>
    <div class="bc-hotbar">${slots}</div>`;
}

/** Joystick, look pad and action buttons — hidden by default, shown only when
 *  the device's primary pointer is touch (a mouse-and-touchscreen laptop
 *  keeps the desktop controls). bindTouch() wires the elements this returns. */
function touchHtml() {
  return `
    <style>
      .bc-touch { display:none; }
      @media (pointer: coarse) {
        .bc-touch { display:block; }
      }
      .bc-look { position:absolute; right:0; top:0; bottom:0; width:58%;
        pointer-events:auto; touch-action:none; }
      .bc-stick-base { position:absolute; z-index:2; left:22px;
        bottom:calc(22px + env(safe-area-inset-bottom,0px)); width:108px; height:108px;
        border-radius:50%; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.25);
        pointer-events:auto; touch-action:none; }
      .bc-stick-knob { position:absolute; left:50%; top:50%; width:48px; height:48px;
        margin:-24px 0 0 -24px; border-radius:50%;
        background:rgba(255,255,255,.28); border:1px solid rgba(255,255,255,.5); }
      .bc-btn { position:absolute; z-index:2; width:62px; height:62px; border-radius:50%;
        display:grid; place-items:center; font:800 11px system-ui; color:#fff;
        background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.3);
        pointer-events:auto; touch-action:none; user-select:none; }
      .bc-btn:active { background:rgba(255,255,255,.3); }
      .bc-btn-mine { right:22px; bottom:calc(96px + env(safe-area-inset-bottom,0px));
        background:rgba(255,90,80,.25); }
      .bc-btn-place { right:92px; bottom:calc(150px + env(safe-area-inset-bottom,0px)); }
      .bc-btn-jump { right:22px; bottom:calc(174px + env(safe-area-inset-bottom,0px)); }
      .bc-btn-fly { right:92px; bottom:calc(228px + env(safe-area-inset-bottom,0px));
        width:50px; height:50px; font-size:9px; }
    </style>
    <div class="bc-touch">
      <div class="bc-look"></div>
      <div class="bc-stick-base"><div class="bc-stick-knob"></div></div>
      <div class="bc-btn bc-btn-mine">MINE</div>
      <div class="bc-btn bc-btn-place">PLACE</div>
      <div class="bc-btn bc-btn-jump">UP</div>
      <div class="bc-btn bc-btn-fly">FLY</div>
    </div>`;
}

/** A small floating panel — top-left, clear of the stats bar and the touch
 *  controls — for the seed, the live view-distance setting, and the list of
 *  saved worlds. bindWorldPanel() wires it up. */
function worldHtml() {
  const views = VIEW_DISTANCES.map(({ chunks, label }) => `
    <button class="bc-view" data-chunks="${chunks}">${label}</button>`).join('');
  return `
    <style>
      .bc-world { position:absolute; left:16px; top:64px; pointer-events:auto;
        background:rgba(10,14,24,.6); border:1px solid rgba(255,255,255,.15);
        border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;
        font:600 12px system-ui; color:#fff; width:180px; }
      .bc-world .bc-label { color:rgba(255,255,255,.6); font-size:10px;
        text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
      .bc-world .bc-label:first-child { margin-top:0; }
      .bc-world input { width:100%; box-sizing:border-box; background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.2); border-radius:5px; color:#fff;
        padding:4px 6px; font:inherit; }
      .bc-world .bc-views { display:flex; gap:4px; }
      .bc-world .bc-view { flex:1; padding:4px 0; border-radius:5px; border:1px solid rgba(255,255,255,.2);
        background:rgba(255,255,255,.06); color:#fff; cursor:pointer; font:inherit; }
      .bc-world .bc-view.on { border-color:#fff; background:rgba(255,255,255,.22); }
      .bc-world .bc-new { padding:5px 0; border-radius:5px; border:1px solid rgba(255,255,255,.25);
        background:rgba(255,90,80,.25); color:#fff; cursor:pointer; font:700 12px inherit; }
      .bc-world .bc-worlds-list { display:flex; flex-direction:column; gap:3px;
        max-height:150px; overflow-y:auto; }
      .bc-world .bc-world-row { display:flex; align-items:center; gap:4px;
        border-radius:5px; padding:3px 5px; background:rgba(255,255,255,.05); font-size:11px; }
      .bc-world .bc-world-row.on { background:rgba(110,231,255,.16); }
      .bc-world .bc-world-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bc-world .bc-load, .bc-world .bc-del { border:none; border-radius:4px; cursor:pointer;
        font:700 10px inherit; padding:2px 6px; color:#fff; background:rgba(255,255,255,.14); }
      .bc-world .bc-del { padding:2px 7px; background:rgba(255,90,80,.3); }
      .bc-world .bc-world-empty { color:rgba(255,255,255,.45); font-size:11px; }
      .bc-world .bc-backup { display:flex; gap:4px; }
      .bc-world .bc-backup button { flex:1; padding:4px 0; border-radius:5px;
        border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06);
        color:#fff; cursor:pointer; font:inherit; }
    </style>
    <div class="bc-world">
      <div class="bc-label">New world seed</div>
      <input class="bc-seed-input" type="text" placeholder="random" maxlength="24" />
      <button class="bc-new">New World</button>
      <div class="bc-label">View distance</div>
      <div class="bc-views">${views}</div>
      <div class="bc-label">Your worlds</div>
      <div class="bc-worlds-list"></div>
      <div class="bc-backup">
        <button class="bc-export">Export</button>
        <button class="bc-import">Import</button>
      </div>
      <input class="bc-import-file" type="file" accept="application/json" hidden />
    </div>`;
}

/** A small panel — top-right, clear of everything else — for playing with
 *  other people: a display name, a server address (from someone running
 *  server/blockcraft-server.mjs), a Connect/Disconnect toggle, and the list
 *  of who else is currently on. bindMultiplayerPanel() wires it up. */
function multiplayerHtml() {
  return `
    <style>
      .bc-mp { position:absolute; right:16px; top:64px; pointer-events:auto; max-height:calc(100vh - 80px); overflow-y:auto;
        background:rgba(10,14,24,.6); border:1px solid rgba(255,255,255,.15);
        border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;
        font:600 12px system-ui; color:#fff; width:180px; }
      .bc-mp .bc-label { color:rgba(255,255,255,.6); font-size:10px;
        text-transform:uppercase; letter-spacing:.5px; margin-top:2px; }
      .bc-mp .bc-label:first-child { margin-top:0; }
      .bc-mp input { width:100%; box-sizing:border-box; background:rgba(255,255,255,.08);
        border:1px solid rgba(255,255,255,.2); border-radius:5px; color:#fff;
        padding:4px 6px; font:inherit; }
      .bc-mp .bc-skin-row { display:flex; gap:8px; align-items:flex-start; }
      .bc-mp .bc-skin-preview { width:32px; height:64px; flex:none; image-rendering:pixelated;
        background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.15); border-radius:4px; }
      .bc-mp .bc-skin-btns { display:flex; flex-direction:column; gap:4px; flex:1; min-width:0; }
      .bc-mp .bc-skin-btns button { padding:4px 0; border-radius:5px; border:1px solid rgba(255,255,255,.25);
        background:rgba(255,255,255,.1); color:#fff; cursor:pointer; font:700 11px inherit; }
      .bc-mp .bc-skin-hint { font-size:10px; line-height:1.3; color:rgba(255,255,255,.5); }
      .bc-mp .bc-pvp-join { padding:6px 0; border-radius:5px; border:1px solid rgba(255,120,110,.6);
        background:rgba(255,90,80,.28); color:#fff; cursor:pointer; font:800 12px inherit; }
      .bc-mp .bc-net-row { display:flex; gap:4px; }
      .bc-mp .bc-list-row { display:flex; align-items:center; gap:6px; font-size:11px; color:rgba(255,255,255,.8); cursor:pointer; }
      .bc-mp .bc-list-row input { width:auto; margin:0; }
      .bc-mp .bc-srv-head { display:flex; align-items:center; justify-content:space-between; }
      .bc-mp .bc-srv-refresh { border:none; background:rgba(255,255,255,.14); color:#fff; border-radius:4px;
        cursor:pointer; font:700 12px inherit; padding:0 6px; }
      .bc-mp .bc-srv-list { display:flex; flex-direction:column; gap:3px; max-height:104px; overflow-y:auto; }
      .bc-mp .bc-srv { display:flex; align-items:center; gap:6px; font-size:11px; padding:3px 4px;
        background:rgba(255,255,255,.06); border-radius:5px; }
      .bc-mp .bc-srv-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bc-mp .bc-srv-count { color:rgba(255,255,255,.6); font-size:10px; }
      .bc-mp .bc-srv button { border:1px solid rgba(255,255,255,.25); background:rgba(110,231,255,.22); color:#fff;
        border-radius:4px; cursor:pointer; font:700 10px inherit; padding:2px 7px; }
      .bc-mp .bc-srv-note { font-size:10px; color:rgba(255,255,255,.5); }
      .bc-mp .bc-net-row button { flex:1; padding:5px 0; border-radius:5px; border:1px solid rgba(255,255,255,.25);
        background:rgba(110,231,255,.22); color:#fff; cursor:pointer; font:700 12px inherit; }
      .bc-mp .bc-connect.on, .bc-mp .bc-host.on { background:rgba(255,90,80,.25); }
      .bc-mp button:disabled { opacity:.35; cursor:default; }
      .bc-mp .bc-host-code { display:flex; align-items:center; gap:6px; font-size:11px;
        background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.15); border-radius:5px; padding:5px 7px; }
      .bc-mp .bc-host-code code { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#6ee7ff; }
      .bc-mp .bc-copy-code { border:none; border-radius:4px; padding:2px 7px; font:700 10px inherit;
        color:#fff; background:rgba(255,255,255,.14); cursor:pointer; }
      .bc-mp .bc-mp-status { font-size:11px; color:rgba(255,255,255,.7); }
      .bc-mp .bc-mp-players { display:flex; flex-direction:column; gap:3px; max-height:110px; overflow-y:auto; }
      .bc-mp-player { display:flex; align-items:center; gap:5px; font-size:11px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .bc-mp-dot { width:8px; height:8px; border-radius:50%; flex:none; }
      .bc-mp-score { margin-left:auto; color:rgba(255,255,255,.65); font-size:10px; }
      .bc-mp .bc-mp-chat { display:flex; flex-direction:column; gap:2px; max-height:96px;
        overflow-y:auto; font-size:11px; line-height:1.35; }
      .bc-mp-msg { overflow-wrap:anywhere; }
      .bc-mp-msg b { color:rgba(255,255,255,.85); }
      .bc-mp-msg.self b { color:#6ee7ff; }
      .bc-mp .bc-chat-row { display:flex; gap:4px; }
      .bc-mp .bc-chat-row input { flex:1; min-width:0; }
      .bc-mp .bc-chat-send { padding:4px 10px; border-radius:5px; border:1px solid rgba(255,255,255,.2);
        background:rgba(255,255,255,.08); color:#fff; cursor:pointer; font:inherit; }
    </style>
    <div class="bc-mp">
      <div class="bc-label">Your name</div>
      <input class="bc-name-input" type="text" placeholder="Player" maxlength="16" />
      <div class="bc-label">Skin</div>
      <div class="bc-skin-row">
        <canvas class="bc-skin-preview" width="48" height="96"></canvas>
        <div class="bc-skin-btns">
          <button class="bc-skin-import">Import skin…</button>
          <button class="bc-skin-reset">Reset</button>
          <span class="bc-skin-hint">A 64×64 Minecraft skin PNG. Drop one here too.</span>
        </div>
      </div>
      <input class="bc-skin-file" type="file" accept="image/png" hidden />
      <div class="bc-label">Server address or host code</div>
      <input class="bc-server-input" type="text" placeholder="ws://host:7443 or a code" maxlength="80" />
      ${PVP_SERVER_URL ? '<button class="bc-pvp-join">⚔ Join PvP Arena</button>' : ''}
      <div class="bc-net-row">
        <button class="bc-connect">Connect</button>
        <button class="bc-host">Host</button>
      </div>
      ${REGISTRY_URL ? '<label class="bc-list-row"><input type="checkbox" class="bc-list-public" /> List my hosted game publicly</label>' : ''}
      <div class="bc-host-code" hidden><code></code><button class="bc-copy-code">Copy</button></div>
      ${REGISTRY_URL ? '<div class="bc-label bc-srv-head">Public servers <button class="bc-srv-refresh" title="Refresh">↻</button></div><div class="bc-srv-list"></div>' : ''}
      <div class="bc-mp-status">Offline — playing solo</div>
      <div class="bc-mp-players"></div>
      <div class="bc-label">Chat</div>
      <div class="bc-mp-chat"></div>
      <div class="bc-chat-row">
        <input class="bc-chat-input" type="text" placeholder="Say something…" maxlength="140" />
        <button class="bc-chat-send">Send</button>
      </div>
    </div>`;
}

/** The centre prompt shown before the player has actually committed to a
 *  world or a server — sits between the World panel (left) and Multiplayer
 *  panel (right) without covering either, so picking a world/server and
 *  hitting Play all happen on the one screen. Removed by beginPlay(). */
function landingHtml() {
  return `
    <style>
      .bc-landing { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
        pointer-events:auto; background:rgba(10,14,24,.74); border:1px solid rgba(255,255,255,.18);
        border-radius:14px; padding:22px 28px; text-align:center; width:min(320px, 80vw);
        box-shadow:0 20px 60px rgba(0,0,0,.5); }
      .bc-landing h2 { margin:0 0 6px; font:800 22px system-ui; color:#fff; letter-spacing:-.5px; }
      .bc-landing p { margin:0 0 16px; font:600 13px system-ui; color:rgba(255,255,255,.7); line-height:1.5; }
      .bc-landing .bc-play-solo { padding:11px 30px; border-radius:9px; border:1px solid rgba(255,255,255,.3);
        background:#6ee7ff; color:#04121a; cursor:pointer; font:800 14px system-ui; }
      .bc-landing .bc-play-solo:hover { filter:brightness(1.08); }
    </style>
    <div class="bc-landing">
      <h2>Blockcraft</h2>
      <p>Pick or start a world on the left, or connect to a server on the right — or just hit Play to jump straight into your last world.</p>
      <button class="bc-play-solo">&#9654; Play</button>
    </div>`;
}

/** A drag-to-move virtual joystick: the knob follows the finger, clamped to
 *  a fixed radius, reporting -1..1 on each axis (+y is "forward", matching
 *  Input's axisY convention) via `onChange`. */
function bindStick(base, knob, onChange) {
  let id = null;
  const R = 34;
  const move = (e) => {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onChange(dx / R, -dy / R);
  };
  const end = () => { id = null; knob.style.transform = ''; onChange(0, 0); };
  base.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (id !== null) return;   // a second finger landing here while one is tracked is ignored, not passed through
    id = e.pointerId;
    base.setPointerCapture(id);
    move(e);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.stopPropagation();
    move(e);
  });
  base.addEventListener('pointerup', (e) => { if (e.pointerId === id) { e.stopPropagation(); end(); } });
  base.addEventListener('pointercancel', (e) => { if (e.pointerId === id) { e.stopPropagation(); end(); } });
}

/** A drag-anywhere look pad: accumulates the finger's frame-to-frame movement
 *  into `look.x`/`look.y`, the same shape as a locked mouse's delta — the
 *  game consumes and zeroes it each frame in look(). */
function bindLook(zone, look) {
  let id = null;
  let lx = 0;
  let ly = 0;
  zone.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (id !== null) return;   // a second finger landing here while one is tracked is ignored, not passed through
    id = e.pointerId;
    lx = e.clientX; ly = e.clientY;
    zone.setPointerCapture(id);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    look.x += e.clientX - lx;
    look.y += e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    e.stopPropagation();
  });
  const end = (e) => { if (e.pointerId === id) { id = null; e.stopPropagation(); } };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

const SWATCH = {
  1: '#6bbf3a', 3: '#8c8c96', 4: '#ecdfab', 5: '#6e4a2a', 6: '#3f9a2a',
  8: '#bd8f56', 9: '#a94a3a', 10: '#87878f', 11: '#cdeaf5',
};
