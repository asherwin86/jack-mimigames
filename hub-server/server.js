/*
 * 100 Mimi Games — account / cloud-worlds / multiplayer server.
 *
 * This is the "51 Mimi Games" hub server (profiles with sign-in, the /mp
 * multiplayer relay Kart Circuit uses, Upstash persistence, rate limiting),
 * adopted as this project's backend. Changes made for the arcade, all marked
 * "(arcade)":
 *   - API-only mode (default): serves only /api/profiles, /api/worlds, /health
 *     and the /mp WebSocket. The hub website, the private page viewer, feedback,
 *     cakes, videos, friends and messages endpoints are switched off.
 *     HUB_API_ONLY=0 restores the original everything-on behaviour.
 *   - CORS: the arcade website and desktop app are other origins. There are no
 *     cookies; every call carries its own credentials in the body.
 *   - HASH_PEPPER: an optional server secret mixed into every stored password
 *     hash, so a leaked database alone can't be replayed as logins.
 *   - /api/worlds/*: Blockcraft worlds saved to a signed-in profile.
 *   - Dev accounts can't be created unless HUB_ALLOW_DEV=1.
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns");
const net = require("net");
const { WebSocketServer } = require("ws");
// This Node version's built-in `globalThis.crypto` is (oddly) the classic
// Node `crypto` module itself, not a WebCrypto-compliant object — it has no
// getRandomValues(), which @simplewebauthn/server requires. Point it at the
// real WebCrypto implementation Node already ships (crypto.webcrypto)
// instead of the wrong thing that was already sitting there.
globalThis.crypto = crypto.webcrypto;
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const PORT = process.env.PORT || 1764;
// (arcade) deployment settings — see the header comment.
const API_ONLY = process.env.HUB_API_ONLY !== "0";
const PEPPER = process.env.HASH_PEPPER || "";
const ALLOW_DEV = process.env.HUB_ALLOW_DEV === "1";
const MAX_PROFILES = Number(process.env.MAX_PROFILES) || 2000;                  // accounts this server will hold
const MAX_WORLD_STORE_BYTES = (Number(process.env.MAX_WORLD_STORE_MB) || 400) * 1024 * 1024;   // all cloud worlds together
const MP_MAX_PAYLOAD = 512 * 1024;                                             // biggest single /mp message (avatars and chat are far smaller)
/** Mixes the server-side pepper into a client-supplied password hash (a no-op when no pepper is set). */
function pepperHash(value) {
  if (!PEPPER || typeof value !== "string" || !value) return value;
  return crypto.createHmac("sha256", PEPPER).update(value).digest("hex");
}
function pepperBody(body) {
  if (body && typeof body === "object") {
    if (typeof body.passwordHash === "string") body.passwordHash = pepperHash(body.passwordHash);
    if (typeof body.newPasswordHash === "string") body.newPasswordHash = pepperHash(body.newPasswordHash);
  }
  return body;
}
const ROOT = __dirname;
const ROOM_MAX_PLAYERS = 20; // Gun Game Arena supports team sizes up to 10v10
// Public matchmaking (Kart Circuit's Play Online). Distinct from ROOM_MAX_PLAYERS
// because a matchmade race fills itself — 12 is a grid people actually want to
// race on, where 20 strangers would mean a permanently crowded track.
const MATCH_MAX_PLAYERS = 12;
const MATCH_MIN_PLAYERS = 2;      // below this nobody is waiting for a countdown
const MATCH_COUNTDOWN_SECONDS = 25; // from reaching MIN, so late joiners still get in
const ROOM_TTL_MS = 4 * 60 * 60 * 1000;

// Voice chat (getUserMedia) only works in "secure contexts" — HTTPS, or plain
// http://localhost. Since this server is reached over the LAN by IP, that means
// a real TLS listener (with a self-signed cert) rather than plain HTTP.
const CERT_PATH = path.join(ROOT, "certs", "cert.pem");
const KEY_PATH = path.join(ROOT, "certs", "key.pem");
const hasCert = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);
// If you want to run this server on a LAN with voice chat, generate a self-signed cert and key with:
//   openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
// Then accept the self-signed cert in your browser when you first connect to it.
// (The cert is only used for the WebRTC voice chat; the rest of the game works fine over plain HTTP.)
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".zip": "application/zip",
};
/* Readable URLs.
 *
 * Three kinds of tidying:
 *   - named pages     /kart-circuit  -> games/mario-kart/index.html
 *   - a game link     /snake         -> index.html, opened on Snake
 *   - a bare folder   /games         -> the hub's game shelf
 *
 * The game link is what makes a game shareable at all: the hub is a single
 * page, so all 85 games used to sit at the same URL and "come play Snake" could
 * only ever link to the front door. Serving index.html for /<id> and letting
 * js/app.js read the path on load turns that into a real link.
 *
 * Deliberately ONE path segment, not /play/<id>. A page served at a deeper path
 * than the file it came from resolves all its relative URLs against that deeper
 * path — so under /play/snake every <script src="js/..."> in index.html is
 * requested from /play/js/... and 404s. (Confirmed by loading it: the whole hub
 * came back empty.) A single segment resolves against the root, which is where
 * index.html actually lives, so nothing needs a <base> and nothing can drift
 * out of sync with it later.
 *
 * Nothing here can reach a file the plain path couldn't: the named routes are
 * an exact-match table, and the game link only ever resolves to index.html.
 */
const PRETTY_ROUTES = {
  "/kart-circuit": "/games/mario-kart/index.html",
  "/kart": "/games/mario-kart/index.html",
  "/games/mario-kart": "/games/mario-kart/index.html",
  "/home": "/index.html",
  "/games": "/index.html",
};

/* Real top-level names, read once at boot, so a game id can never shadow an
 * actual file or folder (/css, /js, /icons, /sw.js...). Derived from the
 * directory rather than hard-coded, so adding a folder to the project can't
 * quietly turn into a routing bug months later. The extras are paths the
 * server itself owns that aren't files on disk. */
const RESERVED_TOP_LEVEL = new Set([
  ...fs.readdirSync(ROOT),
  "api", "mp", "play", "data", "well-known",
]);

// Built once from js/games/*.js's own register({id: "..."}) calls, the same
// source of truth EXPECTED_GAMES in js/app.js is a tripwire against — so a
// new game is automatically discoverable the moment its file exists, with no
// third place to remember to update (index.html's script tag and
// EXPECTED_GAMES are already two). Cached after the first request rather than
// rebuilt every time; nothing here changes while the process is running.
let sitemapXmlCache = null;
function gameIdsForSitemap() {
  const dir = path.join(ROOT, "js", "games");
  const ids = [];
  fs.readdirSync(dir).forEach((file) => {
    if (!file.endsWith(".js")) return;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const match = /MimiGames\.register\(\s*\{\s*id:\s*"([a-z0-9-]+)"/.exec(src);
    if (match) ids.push(match[1]);
  });
  return ids.sort();
}
function buildSitemapXml(origin) {
  if (sitemapXmlCache && sitemapXmlCache.origin === origin) return sitemapXmlCache.xml;
  const urls = [
    { loc: `${origin}/`, priority: "1.0" },
    { loc: `${origin}/kart-circuit`, priority: "0.8" },
    ...gameIdsForSitemap().map((id) => ({ loc: `${origin}/${id}`, priority: "0.6" })),
  ];
  const body = urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  sitemapXmlCache = { origin, xml };
  return xml;
}

// --- Download App links: resolved from GitHub's real releases feed at
// request time, same "build it dynamically so it can't go stale" fix
// already applied to the sitemap above — this replaces a version number
// that was hand-baked into index.html's <a href> tags, which is exactly the
// bug the 2026-09-01 changelog entry already fixed once (it just hardcoded
// whatever was current *then*, and was six releases stale again by v1.0.58).
// Desktop and mobile are rebuilt on different cadences (mobile TWAs don't
// need a rebuild for a web-only change, so their APK can legitimately sit
// on an older tag while still being fully current) — so this resolves each
// platform's own most recent release independently, not one release for
// all six links.
const LATEST_RELEASE_CACHE_MS = 15 * 60 * 1000;
const RELEASE_PLATFORM_FILES = {
  "win-installer": "51-mimi-games-windows-setup.exe",
  win: "51-mimi-games-windows.exe",
  mac: "51-mimi-games-mac.zip",
  linux: "51-mimi-games-linux.AppImage",
  android: "51-mimi-games-android-phone.apk",
  androidtv: "51-mimi-games-android-tv.apk",
  vr: "51-mimi-games-vr.apk",
};
let latestReleaseCache = { at: 0, data: null };
async function fetchLatestReleaseAssets() {
  const now = Date.now();
  if (latestReleaseCache.data && now - latestReleaseCache.at < LATEST_RELEASE_CACHE_MS) return latestReleaseCache.data;
  const res = await fetch("https://api.github.com/repos/asherwin86/owen-minigames/releases?per_page=10", {
    headers: { "User-Agent": "51-mimi-games-hub", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const releases = await res.json(); // newest-created first, GitHub's own default order
  const assets = {};
  for (const [platform, filename] of Object.entries(RELEASE_PLATFORM_FILES)) {
    for (const release of releases) {
      const found = release.assets.find((a) => a.name === filename);
      if (found) { assets[platform] = found.browser_download_url; break; }
    }
  }
  const data = { ok: true, assets };
  latestReleaseCache = { at: now, data };
  return data;
}
async function handleLatestReleaseApi(req, res) {
  if (req.method !== "GET") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  try {
    sendJson(res, 200, await fetchLatestReleaseAssets());
  } catch (e) {
    sendJson(res, 200, { ok: false, msg: e.message || "Couldn't reach GitHub." });
  }
}

function resolvePrettyPath(urlPath) {
  const trimmed = urlPath.length > 1 && urlPath.endsWith("/") ? urlPath.slice(0, -1) : urlPath;
  const named = PRETTY_ROUTES[trimmed.toLowerCase()];
  if (named) return named;
  // /<game-id>: handled entirely client-side, so the server's only job is to
  // hand back the hub instead of a 404 — a single-page app's history fallback.
  const single = /^\/([a-z0-9][a-z0-9-]{0,39})$/i.exec(trimmed);
  if (single && !RESERVED_TOP_LEVEL.has(single[1])) return "/index.html";
  return null;
}

// --- Static file serving for the client-side app (HTML, JS, CSS, images, etc.) 
/* Exactly what may be served, by first path segment. An allowlist, not a
 * denylist, because a denylist only blocks what somebody remembered to write
 * down — and the previous one didn't hold.
 *
 * What it used to be: a check for the literal prefix "/data/", applied to the
 * raw URL *before* path.join normalised it. Verified against a running server:
 * "/data/profiles.json" was correctly refused, but "//data/profiles.json" and
 * "/./data/profiles.json" both returned 200 and the entire profiles file —
 * names, emails, avatars, recovery-code hashes, and passwordHash for every
 * account. The server compares a client-supplied passwordHash directly, so that
 * file is not a hash leak, it is a working credential for every account. The
 * same hole served /server.js (including DEV_SIGNUP_PASSWORD_HASH) and
 * /certs/key.pem, and /server.js was confirmed readable on the deployed site.
 *
 * The fix is both halves together: resolve the path *first* so normalisation
 * can't smuggle anything past the check, then require the result to be inside
 * one of these roots. Adding a folder to the project no longer silently
 * publishes it. */
const SERVABLE = new Set(["css", "js", "games", "icons", "downloads", ".well-known"]);
const SERVABLE_FILES = new Set(["index.html", "sw.js", "manifest.webmanifest", "favicon.ico", "robots.txt"]);

function isServable(filePath) {
  // Containment first: startsWith(ROOT) alone would accept a sibling directory
  // that merely shares the prefix (…/mini_games_backup).
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return false;
  const rel = path.relative(ROOT, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const segments = rel.split(path.sep);
  return segments.length === 1 ? SERVABLE_FILES.has(segments[0]) : SERVABLE.has(segments[0]);
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const urlPath = resolvePrettyPath(rawPath) || rawPath;
  const filePath = path.resolve(ROOT, "." + (urlPath === "/" ? "/index.html" : urlPath));
  if (!isServable(filePath)) {
    // 404 rather than 403: a "forbidden" tells an attacker the path exists.
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    };
    // /downloads holds the packaged desktop app builds — force a real
    // Save-to-Downloads instead of the browser trying to navigate to/open
    // a multi-hundred-MB binary inline
    if (urlPath.startsWith("/downloads/")) {
      headers["Content-Disposition"] = `attachment; filename="${path.basename(filePath)}"`;
      headers["Content-Length"] = stat.size;
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

// --- Optional durable store (Upstash Redis over its REST API) ---
// Render's free-tier disk is ephemeral: data/*.json resets on every redeploy
// and whenever the service wakes from sleep (confirmed live 2026-08-24 — an
// account created earlier the same day was simply gone). When these two env
// vars are set, profiles/leaderboards/cakes/feedback/videos are mirrored to a
// free Upstash Redis database instead of relying on that disk; local disk is
// still written too (see saveProfilesToDisk etc.) purely as a fast local
// cache/fallback for plain LAN hosting, where there's no ephemeral-disk
// problem and no Upstash env vars will be set at all. Video Board only ever
// stores a YouTube video id and a title here — no video file is ever
// uploaded to or stored by this server, so it carries none of the storage
// risk actual file hosting would.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const UPSTASH_ENABLED = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
if (UPSTASH_ENABLED) console.log("Upstash Redis configured — profiles/leaderboards/cakes/feedback/videos/messages will persist across redeploys.");

// --- Optional email notifications (Resend's REST API — no SDK, same plain-
// fetch shape as upstashCmd above) ---
// Messages and Feedback already push a real-time notice over the presence
// WebSocket (pushPresenceMessage/pushToDevs, below) whenever someone's tab is
// open — but that's a no-op the moment nobody's actually connected. This is
// the fallback for exactly that gap: a DM or a feedback item lands while the
// recipient isn't online, and they'd otherwise never know until they happen
// to check back. Entirely optional (unset RESEND_API_KEY = no email code
// path ever runs, same "off by default until configured" shape as Upstash),
// and only ever sent to an address the profile owner typed into their own
// Settings panel themselves (see set-email below) — never anything scraped
// or inferred.
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
// Resend's own shared testing address — works for any account with zero
// setup (no domain to verify), which matters here since this hub has no
// domain of its own to send *from*. Low daily volume and lands in spam more
// often than a verified domain would, but it's a real working default
// rather than a placeholder that silently fails; set EMAIL_FROM once a real
// domain is verified with Resend to improve deliverability.
const EMAIL_FROM = process.env.EMAIL_FROM || "51 Mimi Games <onboarding@resend.dev>";
const EMAIL_ENABLED = Boolean(RESEND_API_KEY);
if (EMAIL_ENABLED) console.log(`Resend configured — email notifications enabled (from ${EMAIL_FROM}).`);

// A single global budget, not per-IP — unlike everything else rate-limited
// in this file, an email costs real money per send regardless of who
// triggered it, so the thing worth capping is total volume the server sends,
// not requests from any one caller. Deliberately silent when over budget:
// the sender's own request (a message send, a feedback submit) already
// succeeded and shouldn't see an error over a best-effort side channel they
// don't know exists.
const EMAIL_RATE_WINDOW_MS = 60_000;
const EMAIL_RATE_MAX = 20;
let emailBucket = { count: 0, resetAt: 0 };
function emailRateOk() {
  const now = Date.now();
  if (now > emailBucket.resetAt) emailBucket = { count: 0, resetAt: now + EMAIL_RATE_WINDOW_MS };
  if (emailBucket.count >= EMAIL_RATE_MAX) return false;
  emailBucket.count++;
  return true;
}

// Every email body below embeds player-submitted text (a message, a
// feedback item) into HTML — this is that text's one and only escaping
// step, the email equivalent of feedback.js's client-side rule to always
// use textContent, never innerHTML, for the exact same kind of string.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sendEmail(to, subject, html) {
  if (!EMAIL_ENABLED || !to || !emailRateOk()) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });
    if (!res.ok) console.error(`Email send failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  } catch (e) {
    console.error("Email send failed:", e.message);
  }
}

// Same idea both call sites below share: email is a fallback for when the
// presence push has nobody to actually reach, not a second copy of every
// notification — so both only fire this once the recipient's own presence
// socket set is empty (they're not currently connected at all).
function isOffline(key) {
  return !presenceByKey.get(key)?.size;
}

async function upstashCmd(cmd) {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
async function upstashGetJson(key, fallback) {
  const raw = await upstashCmd(["GET", key]);
  return raw === null || raw === undefined ? fallback : JSON.parse(raw);
}
async function upstashSetJson(key, value) {
  await upstashCmd(["SET", key, JSON.stringify(value)]);
}

// --- Profiles API: name+password accounts so settings can be signed into
// from any device on the LAN, not just the browser that created them. Stored
// as a JSON file on disk (this is a small local hub, not a real database).
// Passwords never arrive here in plaintext — the client hashes them first —
// but this is still "stop a sibling from messing with your settings" level
// security, not a real auth system (no rate limiting, no password recovery).
// packaged desktop builds pass MIMI_DATA_DIR (a writable per-OS app-data
// directory) since the install directory itself is typically read-only;
// unset in normal dev/LAN-hosting use, where writing next to server.js
// itself has always been fine
const PROFILES_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "profiles.json");

async function loadProfilesFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:profiles", {});
    } catch (e) {
      console.error(`Upstash profiles load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      // File exists but couldn't be read/parsed — starting empty here would
      // otherwise silently discard it the moment anything calls
      // saveProfilesToDisk(). Refuse to boot instead: losing profiles once
      // (see incident 2026-08-15) taught us a silent {} fallback is how a
      // real file goes missing without anyone noticing until it's too late.
      console.error(`profiles.json exists but failed to load (${e.message}) — refusing to start with an empty profile set. Fix or move aside ${PROFILES_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No profiles.json found at ${PROFILES_PATH} — starting with an empty profile set.`);
    return {};
  }
}
async function saveProfilesToDisk() {
  try {
    fs.mkdirSync(path.dirname(PROFILES_PATH), { recursive: true });
    // Keep one prior copy before every overwrite, so an in-memory `profiles`
    // that's wrong for any reason can't permanently erase the last-known-good
    // file on disk the moment anything triggers a save.
    if (fs.existsSync(PROFILES_PATH)) {
      fs.copyFileSync(PROFILES_PATH, `${PROFILES_PATH}.bak`);
    }
    fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
  } catch (e) {
    console.error("Failed to persist profiles.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:profiles", profiles);
    } catch (e) {
      console.error("Failed to persist profiles to Upstash:", e.message);
    }
  }
}
// Populated by bootstrapData() before the server starts listening — see the
// bottom of this file. `let`, not `const`, since loading is async (may hit
// Upstash over the network) but everything below closes over this same
// binding and only ever runs after that load has finished.
let profiles = {}; // { [key]: { name, passwordHash, dev, settings, updatedAt, createdAt, email, recoveryCodeHash, passkeys, avatar, kartColor, following, achievements, keys, rivalSkins } }
// Signup used to trust body.dev outright — any client could POST
// {dev: true} (not even through the UI checkbox, a bare API call was
// enough) and get dev-only capabilities (the Admin panel, and now the
// Kart Circuit fly cheat) with nothing checking it server-side, the only
// place that check can actually mean anything. Hashed the same way as a
// profile's own password (see hashPassword in js/profiles.js) with a fixed
// "dev-gate" key in place of a per-profile one, so the real password is
// never sent or stored in the clear.
const DEV_SIGNUP_PASSWORD_HASH = "dd2a0d8da7d9cc17405586af3658ec7e3196ae67e93c1974f8674c574ab0c303";
// avatar is a small data: URI (client resizes/compresses to ~96px before
// upload) — capped well under the request body limit below so one oversized
// image can't bloat data/profiles.json or the request itself.
const MAX_AVATAR_LEN = 60000;

// Keys are earned 10 at a time (js/keys.js's daily quest), so this is already
// a couple of centuries of grinding — generous enough to never legitimately
// bump into it, but a hard ceiling so a bad or bogus client value (a stray
// Infinity from a broken JSON round-trip, say) can never wedge itself into a
// saved profile and corrupt every future read of it.
const MAX_KEYS_BALANCE = 1000000;

// Any profile created before this field existed has no createdAt at all —
// backfill from updatedAt (its oldest known timestamp) once, in memory, so
// age-based achievements work without a separate migration script. Persists
// naturally the next time saveProfilesToDisk() runs for any reason. Called
// from bootstrapData() once profiles has actually been loaded.
function backfillProfileDefaults() {
  Object.values(profiles).forEach((entry) => {
    if (!entry.createdAt) entry.createdAt = entry.updatedAt || Date.now();
    if (!entry.following) entry.following = [];
    if (!entry.achievements) entry.achievements = { unlocked: {} };
    if (entry.kartColor === undefined) entry.kartColor = null;
    if (typeof entry.keys !== "number") entry.keys = 0;
    if (!entry.rivalSkins || !Array.isArray(entry.rivalSkins.owned)) entry.rivalSkins = { owned: ["standard"], equipped: {} };
  });
}

// Kept in sync by hand with racerPalette in games/mario-kart/game.js — no
// shared module between client and server today (same as every other
// profile-field validation here, e.g. MAX_AVATAR_LEN), so this is a literal
// duplicate, not an import.
const KART_COLOR_SWATCHES = [
  "#ffd166", "#53e0ff", "#ff6b6b", "#9bff8f", "#c792ff", "#5dd6ff", "#ff9f6e",
  "#63f0b1", "#ffd36f", "#8ec5ff", "#ff88ad", "#9cf77e", "#f4a7ff",
];

// Kept in sync by hand with SKINS in js/games/rival-arena.js — validates
// anything a "sync-rival-skins" call claims is owned/equipped, so a bogus
// client payload can't wedge an unrecognized id into a saved profile.
const RIVAL_SKIN_IDS = new Set([
  "standard", "sand", "forest", "carbon", "arctic", "crimson", "ocean",
  "toxic", "violet", "inferno", "gold", "prism",
]);

// --- Leaderboards: a separate top-level store, same load/save shape as
// profiles.json (rotating .bak before every overwrite, refuse to boot on a
// parse failure rather than silently reset) — see loadProfilesFromDisk's own
// comment for why that matters. ---
const LEADERBOARDS_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "leaderboards.json");

async function loadLeaderboardsFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:leaderboards", {});
    } catch (e) {
      console.error(`Upstash leaderboards load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(LEADERBOARDS_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`leaderboards.json exists but failed to load (${e.message}) — refusing to start with an empty leaderboard set. Fix or move aside ${LEADERBOARDS_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No leaderboards.json found at ${LEADERBOARDS_PATH} — starting with empty leaderboards.`);
    return {};
  }
}
async function saveLeaderboardsToDisk() {
  try {
    fs.mkdirSync(path.dirname(LEADERBOARDS_PATH), { recursive: true });
    if (fs.existsSync(LEADERBOARDS_PATH)) {
      fs.copyFileSync(LEADERBOARDS_PATH, `${LEADERBOARDS_PATH}.bak`);
    }
    fs.writeFileSync(LEADERBOARDS_PATH, JSON.stringify(leaderboards, null, 2));
  } catch (e) {
    console.error("Failed to persist leaderboards.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:leaderboards", leaderboards);
    } catch (e) {
      console.error("Failed to persist leaderboards to Upstash:", e.message);
    }
  }
}
// { [gameId]: { [profileKey]: { name, avatar, value, updatedAt } } }
let leaderboards = {}; // populated by bootstrapData() — see profiles' own `let` comment above

// --- Cake Bakery's shared feed: a single ever-growing-until-capped list of
// published cakes, same load/save shape (and same "refuse to boot on a
// parse failure" reasoning) as leaderboards.json above. ---
const CAKES_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "cakes.json");
const MAX_STORED_CAKES = 200;

async function loadCakesFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:cakes", []);
    } catch (e) {
      console.error(`Upstash cakes load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(CAKES_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`cakes.json exists but failed to load (${e.message}) — refusing to start with an empty cake feed. Fix or move aside ${CAKES_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No cakes.json found at ${CAKES_PATH} — starting with an empty cake feed.`);
    return [];
  }
}
async function saveCakesToDisk() {
  try {
    fs.mkdirSync(path.dirname(CAKES_PATH), { recursive: true });
    if (fs.existsSync(CAKES_PATH)) {
      fs.copyFileSync(CAKES_PATH, `${CAKES_PATH}.bak`);
    }
    fs.writeFileSync(CAKES_PATH, JSON.stringify(cakes, null, 2));
  } catch (e) {
    console.error("Failed to persist cakes.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:cakes", cakes);
    } catch (e) {
      console.error("Failed to persist cakes to Upstash:", e.message);
    }
  }
}
// [{ id, name, base, toppings: [...], createdAt }], newest last on disk —
// handleCakesApi's own "list" action is what reverses to newest-first
let cakes = []; // populated by bootstrapData() — see profiles' own `let` comment above

// --- Feedback: a private inbox, not a public feed. Anyone can submit
// (signed in or not — a bug report shouldn't require an account), but only a
// verified dev account can read what's been sent, same gate as the keys
// dev tools and Kart Circuit's cheats. ---
const FEEDBACK_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "feedback.json");
const MAX_STORED_FEEDBACK = 500;
const FEEDBACK_CATEGORIES = new Set(["bug", "suggestion", "other"]);

async function loadFeedbackFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:feedback", []);
    } catch (e) {
      console.error(`Upstash feedback load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`feedback.json exists but failed to load (${e.message}) — refusing to start with an empty inbox. Fix or move aside ${FEEDBACK_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No feedback.json found at ${FEEDBACK_PATH} — starting with an empty inbox.`);
    return [];
  }
}
async function saveFeedbackToDisk() {
  try {
    fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
    if (fs.existsSync(FEEDBACK_PATH)) fs.copyFileSync(FEEDBACK_PATH, `${FEEDBACK_PATH}.bak`);
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(feedback, null, 2));
  } catch (e) {
    console.error("Failed to persist feedback.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:feedback", feedback);
    } catch (e) {
      console.error("Failed to persist feedback to Upstash:", e.message);
    }
  }
}
let feedback = []; // populated by bootstrapData()

// --- Video Board: a shared feed of YouTube links this hub's own players
// post for each other — not a video host. Only the video id is ever stored;
// playback is the real YouTube's own embed player, so there's no media,
// storage or moderation surface here beyond a short link and a title. ---
const VIDEOS_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "videos.json");
const MAX_STORED_VIDEOS = 300;
// Matches an 11-char YouTube video id out of any common URL shape
// (watch?v=, youtu.be/, embed/, shorts/) or a bare id typed directly.
const YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/;
function extractYoutubeId(input) {
  const trimmed = typeof input === "string" ? input.trim() : "";
  const match = YOUTUBE_ID_RE.exec(trimmed);
  return match ? (match[1] || match[2]) : null;
}

// Matches the three real channel URL shapes YouTube hands out (@handle,
// /channel/UC…, and the older /c/Name and /user/Name forms) and normalizes
// to a real, clickable URL — the starting point for the recent-uploads
// import below, and also what tells "publish" a link is a channel rather
// than an unrecognized video link, for a clearer error message.
const YOUTUBE_CHANNEL_RE = /youtube\.com\/(@[\w.-]{2,100}|channel\/UC[\w-]{20,}|c\/[\w.-]{2,100}|user\/[\w.-]{2,100})/i;
function extractYoutubeChannel(input) {
  const trimmed = typeof input === "string" ? input.trim() : "";
  const match = YOUTUBE_CHANNEL_RE.exec(trimmed);
  return match ? `https://www.youtube.com/${match[1]}` : null;
}

// A /channel/UC… link already carries the real id; any other shape (@handle,
// /c/Name, /user/Name) needs the channel's own page fetched once to read it
// back out — every channel page embeds its real id in its own init data,
// which is the same "read a public page, extract one field" shape the
// page-fetch proxy already uses elsewhere in this file (fetchPagePrivately),
// just without any of that feature's browser-display handling since nothing
// fetched here is ever shown as a page, only two fields ever get pulled out
// of it. fetchPagePrivately already carries this file's SSRF/DNS-rebinding
// protections and redirect handling, so youtube.com's own legacy-URL
// redirects (a /user/Name link, say) resolve transparently.
async function resolveYoutubeChannelId(channelUrl) {
  const direct = /\/channel\/(UC[\w-]{20,})/.exec(channelUrl);
  if (direct) return direct[1];
  const page = await fetchPagePrivately(channelUrl);
  const match = /"channelId":"(UC[\w-]{20,})"/.exec(page.body) || /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/.exec(page.body);
  if (!match) throw new Error("Couldn't find that channel.");
  return match[1];
}

// Every channel has a real, public Atom feed of its own recent uploads —
// YouTube's own feature (used by feed readers/podcast apps for years), not a
// scraping workaround, and the only free/keyless way to list a channel's
// videos at all (the alternative is the Data API and its own key). Caps at
// the ~15 most recent uploads — YouTube's own limit on this feed, not one
// imposed here. Parsed by hand rather than pulling in an XML library for one
// simple, very regularly-shaped feed.
const MAX_CHANNEL_IMPORT = 15;
function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}
async function fetchChannelRecentVideos(channelId) {
  const feed = await fetchPagePrivately(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(feed.body))) {
    const idMatch = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(m[1]);
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(m[1]);
    if (idMatch) entries.push({ videoId: idMatch[1], title: titleMatch ? decodeXmlEntities(titleMatch[1]) : "Untitled" });
  }
  return entries.slice(0, MAX_CHANNEL_IMPORT);
}

async function loadVideosFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:videos", []);
    } catch (e) {
      console.error(`Upstash videos load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(VIDEOS_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`videos.json exists but failed to load (${e.message}) — refusing to start with an empty board. Fix or move aside ${VIDEOS_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No videos.json found at ${VIDEOS_PATH} — starting with an empty video board.`);
    return [];
  }
}
async function saveVideosToDisk() {
  try {
    fs.mkdirSync(path.dirname(VIDEOS_PATH), { recursive: true });
    if (fs.existsSync(VIDEOS_PATH)) fs.copyFileSync(VIDEOS_PATH, `${VIDEOS_PATH}.bak`);
    fs.writeFileSync(VIDEOS_PATH, JSON.stringify(videos, null, 2));
  } catch (e) {
    console.error("Failed to persist videos.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:videos", videos);
    } catch (e) {
      console.error("Failed to persist videos to Upstash:", e.message);
    }
  }
}
let videos = []; // populated by bootstrapData()

// --- Messages: direct messages between mutual friends only — same "follow
// each other" gate handleFriendsApi already enforces for presence/room-code,
// reused here so there isn't a second, different notion of "friend" to keep
// in sync. Keyed by the pair's own two profile keys sorted together, so
// there's exactly one thread per pair regardless of who sent the first
// message — not per-sender, and not indexed by conversation id. ---
const MESSAGES_PATH = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "messages.json");
const MAX_MESSAGES_PER_THREAD = 300; // per pair, not global — a global cap would let one busy pair crowd out everyone else's history
const MAX_MESSAGE_LEN = 1000;
function threadKeyOf(keyA, keyB) {
  return [keyA, keyB].sort().join("|");
}
function isMutualFriend(key, otherKey) {
  const entry = profiles[key];
  const other = profiles[otherKey];
  if (!entry || !other) return false;
  return (entry.following || []).includes(otherKey) && (other.following || []).includes(key);
}

async function loadMessagesFromDisk() {
  if (UPSTASH_ENABLED) {
    try {
      return await upstashGetJson("mimi:messages", {});
    } catch (e) {
      console.error(`Upstash messages load failed (${e.message}) — falling back to local disk this boot.`);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_PATH, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`messages.json exists but failed to load (${e.message}) — refusing to start with empty inboxes. Fix or move aside ${MESSAGES_PATH} and restart.`);
      process.exit(1);
    }
    console.log(`No messages.json found at ${MESSAGES_PATH} — starting with no message history.`);
    return {};
  }
}
async function saveMessagesToDisk() {
  try {
    fs.mkdirSync(path.dirname(MESSAGES_PATH), { recursive: true });
    if (fs.existsSync(MESSAGES_PATH)) fs.copyFileSync(MESSAGES_PATH, `${MESSAGES_PATH}.bak`);
    fs.writeFileSync(MESSAGES_PATH, JSON.stringify(messages, null, 2));
  } catch (e) {
    console.error("Failed to persist messages.json:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try {
      await upstashSetJson("mimi:messages", messages);
    } catch (e) {
      console.error("Failed to persist messages to Upstash:", e.message);
    }
  }
}
let messages = {}; // populated by bootstrapData() — { "<keyA>|<keyB>": [{ id, from, text, ts }] }

// The server owns sortDir per game — never trusts a client's claimed
// direction, or a malicious client could submit a terrible score claiming
// "lower is better" and rank #1 with it.
const LEADERBOARD_GAMES = {
  snake: { label: "Snake", sortDir: "desc" },
  "2048": { label: "2048", sortDir: "desc" },
  "reaction-test": { label: "Reaction Test", sortDir: "asc" }, // lower ms is better
  bowling: { label: "Bowling", sortDir: "desc" },
  darts: { label: "Darts", sortDir: "desc" },
  "field-tag": { label: "Field Tag", sortDir: "desc" },
  "cake-bakery": { label: "Cake Streak", sortDir: "desc" },
};

// --- Achievements ---
// Client-attested ids (unlock-achievement): self-reported by the browser,
// e.g. "played 10 distinct games" derived from locally-synced play history.
// Explicitly spoofable by anyone calling the API directly — same trust model
// as everything else here (client-hashed passwords, no server-side
// anti-cheat anywhere in this hub). Judged acceptable for a friend-group hub.
const CLIENT_ATTESTED_ACHIEVEMENTS = new Set([
  "first-boot", "ten-games", "forty-games", "all-80", "party-started",
]);
// Server-verified ids: checked against ground truth the server already owns
// (checkServerAchievements below) — these can't be unlocked via
// unlock-achievement directly, only via check-achievements.
function checkServerAchievements(key, entry) {
  const unlocked = [];
  const ageDays = (Date.now() - (entry.createdAt || Date.now())) / (24 * 60 * 60 * 1000);
  if (ageDays >= 7) unlocked.push("regular");
  if (ageDays >= 90) unlocked.push("old-timer");

  const mutualCount = mutualFriendCount(key, entry);
  if (mutualCount >= 1) unlocked.push("made-a-friend");
  if (mutualCount >= 5) unlocked.push("popular");

  const onAnyBoard = Object.values(leaderboards).some((board) => board[key]);
  if (onAnyBoard) unlocked.push("on-the-board");

  if (entry.kartColor) unlocked.push("kitted-out");

  return unlocked;
}

// Shared by checkServerAchievements and handleFriendsApi's "list" action —
// O(n) reverse scan over all profiles to find who follows `key` back. Fine
// at this hub's scale (same trust/scale assumption as the existing dev-only
// "list" action).
function mutualFriendCount(key, entry) {
  const followingSet = new Set(entry.following || []);
  let count = 0;
  Object.entries(profiles).forEach(([otherKey, other]) => {
    if (followingSet.has(otherKey) && (other.following || []).includes(key)) count += 1;
  });
  return count;
}

function isNonEmptyString(v, maxLen) {
  return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

// --- Extra ways to secure/recover an account, on top of name+password ---
//
// 1. Passkeys (WebAuthn): the actual fingerprint/Face ID/Windows Hello check
//    happens entirely on the user's own device via their OS/browser — this
//    server never sees, receives, or stores anything biometric. All it ever
//    handles is a public key and a signature-verification ceremony, exactly
//    like every other WebAuthn Relying Party. See MDN's WebAuthn docs for the
//    ceremony shape if any of this looks unfamiliar.
// 2. An optional email — NOT used for password recovery (see 3. below for
//    that). When the optional Resend integration is configured (see
//    EMAIL_ENABLED near the top of this file), it's where a Messages DM or
//    a dev's Feedback item gets sent if the recipient isn't currently
//    online to receive the real-time push — a fallback channel, not a
//    login/reset credential. Without RESEND_API_KEY set (e.g. plain LAN
//    hosting with no outbound email at all), this field is genuinely inert,
//    same as it always was.
// 3. A one-time recovery code, generated on request and shown exactly once —
//    this is what actually solves "I forgot my password." Deliberately
//    still independent of the email above (no reset-link flow): single-use,
//    using it to set a new password immediately invalidates it, same as any
//    backup-code scheme.
const PENDING_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const pendingChallenges = new Map(); // key -> { challenge, expiresAt, kind: "register" | "authenticate" }

function setPendingChallenge(key, challenge, kind) {
  pendingChallenges.set(key, { challenge, expiresAt: Date.now() + PENDING_CHALLENGE_TTL_MS, kind });
}
function takePendingChallenge(key, kind) {
  const entry = pendingChallenges.get(key);
  pendingChallenges.delete(key);
  if (!entry || entry.kind !== kind || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

// WebAuthn's rpID must be a real hostname, never an IP address or a
// scheme+port — derive it from whatever host the browser actually used
// (localhost for the same machine, a LAN hostname if this hub is reached
// that way). A raw LAN IP will make the browser itself reject the
// ceremony; that's the browser enforcing the spec, not something this
// server can work around, so registering a passkey only works from a
// device that reaches this hub by hostname rather than by IP.
function rpInfoFromRequest(req) {
  const hostHeader = req.headers.host || "localhost";
  const hostname = hostHeader.split(":")[0];
  const proto = hasCert ? "https" : "http";
  return { rpID: hostname, rpName: "51 Mimi Games", origin: `${proto}://${hostHeader}` };
}

function generateRecoveryCode() {
  // grouped like XXXX-XXXX-XXXX for readability when someone has to copy it
  // down by hand; excludes visually-ambiguous characters (0/O, 1/I/L)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(""));
  return groups.join("-");
}
function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update("mimiRecovery:" + code.toUpperCase()).digest("hex");
}
// never send publicKey/counter to the client — it doesn't need either, and
// keeping them server-only is just good hygiene even though a public key
// isn't secret by definition
function publicPasskeys(entry) {
  return (entry.passkeys || []).map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt }));
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(pepperBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });   // (arcade) CORS: callers are other origins, and no cookies are involved
  res.end(JSON.stringify(obj));
}

// Per-IP request limiter for the API — this hub was originally "stop a
// sibling from messing with your settings" on a LAN, with nothing standing
// between it and unlimited profile-creation spam or password brute-forcing
// (see the comment above PROFILES_PATH). Fine on a LAN where every device
// belongs to someone in the room; not fine once this is reachable from the
// open internet. Deliberately simple — an in-memory sliding window, no
// dependency — proportionate to what this app actually is, not a
// general-purpose API gateway. Two tiers: a loose one covering every API
// call (catches raw flooding) and a much tighter one for the specific
// actions worth slowing down on purpose (account creation and login are
// the ones brute-forcing/spam actually targets).
const RATE_LIMIT_GENERAL = { windowMs: 60_000, max: 120 };
const RATE_LIMIT_STRICT = { windowMs: 60_000, max: 15 };
const rateLimitBuckets = new Map(); // `${tier}:${ip}` -> { count, resetAt }
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitBuckets) {
    if (entry.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 5 * 60_000).unref();

// Render (and most real hosts) put the app behind a reverse proxy, so the
// socket's own remoteAddress is the proxy's internal IP, not the client's —
// x-forwarded-for is the standard way that's actually communicated. Trusted
// here because this app has no other reason to expose itself directly
// (dev/LAN use terminates locally, hosted use is expected to sit behind
// exactly one trusted proxy) — a header any client could otherwise spoof to
// dodge its own limit.
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// Returns true and records the hit if this IP is still under `tier`'s
// limit; returns false (and sends 429 itself) once it isn't. Call sites
// just need to `if (!checkRateLimit(...)) return;` right after routing.
function checkRateLimit(req, res, tierName, tier) {
  const ip = clientIp(req);
  const key = `${tierName}:${ip}`;
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + tier.windowMs });
    return true;
  }
  if (entry.count >= tier.max) {
    sendJson(res, 429, { ok: false, msg: "Too many requests — try again in a minute." });
    return false;
  }
  entry.count += 1;
  return true;
}

// The actions where guessing matters: creating an account (spam) and
// anything that checks a password/credential (brute-forcing). The general
// per-IP limit above already catches raw flooding across all of /api/;
// this one is deliberately much tighter, and only on these specific
// actions, since 120/min is a reasonable ceiling for normal play but a
// very generous budget for guessing passwords.
const SENSITIVE_PROFILE_ACTIONS = new Set([
  "create", "login", "changepassword", "recover",
  "passkey-login-verify", "passkey-register-verify",
]);

async function handleProfilesApi(req, res, action) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, msg: "Method not allowed." });
    return;
  }
  if (SENSITIVE_PROFILE_ACTIONS.has(action) && !checkRateLimit(req, res, "profile-auth", RATE_LIMIT_STRICT)) return;
  let body;
  try {
    body = await readJsonBody(req, 96 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }

  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  if (!isNonEmptyString(key, 40)) {
    sendJson(res, 400, { ok: false, msg: "Missing name." });
    return;
  }
  // passwordHash is required by most actions but not all (passkey sign-in
  // proves identity with a signature instead; recovery proves it with a
  // one-time code) — validated per-action below instead of universally here.
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  function wrongPassword() {
    return !entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash;
  }

  if (action === "create") {
    if (profiles[key]) {
      sendJson(res, 200, { ok: false, msg: "That name is already taken — try Sign In instead." });
      return;
    }
    if (!isNonEmptyString(passwordHash, 200)) {
      sendJson(res, 400, { ok: false, msg: "Missing password." });
      return;
    }
    if (Object.keys(profiles).length >= MAX_PROFILES) { sendJson(res, 200, { ok: false, msg: "Sign-ups are full right now." }); return; }   // (arcade)
    const wantsDev = Boolean(body.dev);
    if (wantsDev && !ALLOW_DEV) { sendJson(res, 200, { ok: false, msg: "Dev accounts are not available here." }); return; }   // (arcade)
    const devPasswordHash = typeof body.devPasswordHash === "string" ? body.devPasswordHash : "";
    if (wantsDev && devPasswordHash !== DEV_SIGNUP_PASSWORD_HASH) {
      sendJson(res, 200, { ok: false, msg: "Wrong dev password." });
      return;
    }
    const now = Date.now();
    profiles[key] = {
      name: isNonEmptyString(body.name, 24) ? body.name : key,
      passwordHash,
      dev: wantsDev,
      settings: body.settings && typeof body.settings === "object" ? body.settings : {},
      updatedAt: now,
      createdAt: now,
      email: null,
      recoveryCodeHash: null,
      passkeys: [],
      avatar: null,
      kartColor: null,
      following: [],
      achievements: { unlocked: {} },
      keys: 0,
      rivalSkins: { owned: ["standard"], equipped: {} },
    };
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true });
    return;
  }
  if (action === "login") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    if (entry.passwordHash !== passwordHash) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    sendJson(res, 200, { ok: true, name: entry.name, dev: entry.dev, settings: entry.settings, email: entry.email || null, passkeys: publicPasskeys(entry), avatar: entry.avatar || null, kartColor: entry.kartColor || null, keys: typeof entry.keys === "number" ? entry.keys : 0, rivalSkins: entry.rivalSkins || { owned: ["standard"], equipped: {} } });
    return;
  }

  if (action === "save") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    if (entry.passwordHash !== passwordHash) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    entry.settings = body.settings && typeof body.settings === "object" ? body.settings : {};
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === "delete") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    if (entry.passwordHash !== passwordHash) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    delete profiles[key];
    saveProfilesToDisk();
    deleteAllWorlds(key).catch(() => {});   // (arcade) don't leave a deleted account's worlds for the next person to take the name
    sendJson(res, 200, { ok: true });
    return;
  }

  // self-service: any signed-in profile can change its OWN password by
  // proving it knows the current one (same passwordHash check as save/delete)
  if (action === "changepassword") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    if (entry.passwordHash !== passwordHash) { sendJson(res, 200, { ok: false, msg: "Current password is wrong." }); return; }
    const newPasswordHash = typeof body.newPasswordHash === "string" ? body.newPasswordHash : "";
    if (!isNonEmptyString(newPasswordHash, 200)) { sendJson(res, 400, { ok: false, msg: "Missing new password." }); return; }
    entry.passwordHash = newPasswordHash;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, msg: "Password changed." });
    return;
  }

  // "list" and "reset" are dev-only: the requester (key/passwordHash) must be
  // an existing profile with dev:true. Passwords are never sent back — list
  // only ever returns names/flags, and reset only ever lets a dev SET a new
  // password on another profile, never see the old one.
  if (action === "list" || action === "reset") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    if (entry.passwordHash !== passwordHash) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    if (!entry.dev) { sendJson(res, 403, { ok: false, msg: "Dev profiles only." }); return; }

    if (action === "list") {
      const list = Object.keys(profiles).map((k) => ({
        key: k,
        name: profiles[k].name,
        dev: Boolean(profiles[k].dev),
        updatedAt: profiles[k].updatedAt,
      }));
      sendJson(res, 200, { ok: true, profiles: list });
      return;
    }

    // reset
    const targetKey = typeof body.targetKey === "string" ? body.targetKey.trim().toLowerCase() : "";
    const newPasswordHash = typeof body.newPasswordHash === "string" ? body.newPasswordHash : "";
    if (!isNonEmptyString(targetKey, 40) || !isNonEmptyString(newPasswordHash, 200)) {
      sendJson(res, 400, { ok: false, msg: "Missing target or new password." });
      return;
    }
    const target = profiles[targetKey];
    if (!target) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    target.passwordHash = newPasswordHash;
    target.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, msg: `Password reset for "${target.name}".` });
    return;
  }

  // --- Passkeys (WebAuthn) ---

  // adding a passkey requires proving you already know the password — a
  // passkey is an *additional* way in, not a way to bypass the first one
  if (action === "passkey-register-options") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const { rpID, rpName } = rpInfoFromRequest(req);
    try {
      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: entry.name,
        userDisplayName: entry.name,
        attestationType: "none",
        excludeCredentials: (entry.passkeys || []).map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      setPendingChallenge(key, options.challenge, "register");
      sendJson(res, 200, { ok: true, options });
    } catch (e) {
      sendJson(res, 200, { ok: false, msg: "Couldn't start passkey setup: " + e.message });
    }
    return;
  }

  if (action === "passkey-register-verify") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const { rpID, origin } = rpInfoFromRequest(req);
    const expectedChallenge = takePendingChallenge(key, "register");
    if (!expectedChallenge) { sendJson(res, 200, { ok: false, msg: "That took too long — try adding the passkey again." }); return; }
    try {
      const verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        sendJson(res, 200, { ok: false, msg: "That passkey couldn't be verified." });
        return;
      }
      const { credential } = verification.registrationInfo;
      entry.passkeys = entry.passkeys || [];
      entry.passkeys.push({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
        label: isNonEmptyString(body.label, 40) ? body.label : "Passkey",
        createdAt: Date.now(),
      });
      entry.updatedAt = Date.now();
      saveProfilesToDisk();
      sendJson(res, 200, { ok: true, msg: "Passkey added.", passkeys: publicPasskeys(entry) });
    } catch (e) {
      sendJson(res, 200, { ok: false, msg: "That passkey couldn't be verified: " + e.message });
    }
    return;
  }

  if (action === "passkey-remove") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const credentialId = typeof body.credentialId === "string" ? body.credentialId : "";
    entry.passkeys = (entry.passkeys || []).filter((p) => p.id !== credentialId);
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, passkeys: publicPasskeys(entry) });
    return;
  }

  // signing in WITH a passkey — no password involved at all, the signature
  // IS the proof of identity
  if (action === "passkey-login-options") {
    if (!entry || !(entry.passkeys || []).length) {
      sendJson(res, 200, { ok: false, msg: "No passkey set up for that name." });
      return;
    }
    const { rpID } = rpInfoFromRequest(req);
    try {
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: entry.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
        userVerification: "preferred",
      });
      setPendingChallenge(key, options.challenge, "authenticate");
      sendJson(res, 200, { ok: true, options });
    } catch (e) {
      sendJson(res, 200, { ok: false, msg: "Couldn't start passkey sign-in: " + e.message });
    }
    return;
  }

  if (action === "passkey-login-verify") {
    if (!entry) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    const { rpID, origin } = rpInfoFromRequest(req);
    const expectedChallenge = takePendingChallenge(key, "authenticate");
    if (!expectedChallenge) { sendJson(res, 200, { ok: false, msg: "That took too long — try again." }); return; }
    const credentialId = body.credential && body.credential.id;
    const stored = (entry.passkeys || []).find((p) => p.id === credentialId);
    if (!stored) { sendJson(res, 200, { ok: false, msg: "That passkey isn't registered here." }); return; }
    try {
      const verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored.id,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: stored.transports,
        },
      });
      if (!verification.verified) {
        sendJson(res, 200, { ok: false, msg: "Passkey sign-in couldn't be verified." });
        return;
      }
      // the counter should only ever go up — an authenticator that reports a
      // counter equal to or lower than last time suggests a cloned
      // authenticator (a real, if rare, thing this check exists to catch)
      stored.counter = verification.authenticationInfo.newCounter;
      saveProfilesToDisk();
      sendJson(res, 200, { ok: true, name: entry.name, dev: entry.dev, settings: entry.settings, email: entry.email || null, passkeys: publicPasskeys(entry), avatar: entry.avatar || null, kartColor: entry.kartColor || null });
    } catch (e) {
      sendJson(res, 200, { ok: false, msg: "Passkey sign-in couldn't be verified: " + e.message });
    }
    return;
  }

  // --- Email (see the numbered comment above this block's definitions —
  // this is the notification-fallback address, not a password-reset one) ---
  if (action === "set-email") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
    entry.email = email || null;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, email: entry.email });
    return;
  }

  // --- Profile picture: a small data: URI, resized/compressed to ~96px by
  // the browser before it ever gets here (see setProfileAvatar in
  // js/profiles.js) — shown next to your name in the profile panel, and
  // sent along when hosting/joining a Kart Circuit wireless race so other
  // racers see your photo in their camera strip. ---
  if (action === "set-avatar") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const avatar = typeof body.avatar === "string" ? body.avatar : "";
    if (avatar && (!avatar.startsWith("data:image/") || avatar.length > MAX_AVATAR_LEN)) {
      sendJson(res, 400, { ok: false, msg: "Picture is invalid or too large." });
      return;
    }
    entry.avatar = avatar || null;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, avatar: entry.avatar });
    return;
  }

  // --- Kart Circuit color: a chosen entry from the fixed swatch list (kept
  // in sync with racerPalette in games/mario-kart/game.js), synced to the
  // profile so it follows you across devices the same way avatar does. ---
  if (action === "set-kart-color") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const kartColor = typeof body.kartColor === "string" ? body.kartColor : "";
    if (kartColor && !KART_COLOR_SWATCHES.includes(kartColor)) {
      sendJson(res, 400, { ok: false, msg: "Not a valid kart color." });
      return;
    }
    entry.kartColor = kartColor || null;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, kartColor: entry.kartColor });
    return;
  }

  // --- Achievements ---
  // Client-attested: self-reported by the browser (e.g. "played 10 distinct
  // games", derived from locally-synced play history the server has no
  // direct view into). See CLIENT_ATTESTED_ACHIEVEMENTS's own comment for
  // the trust-model tradeoff this accepts.
  if (action === "unlock-achievement") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const id = typeof body.achievementId === "string" ? body.achievementId : "";
    if (!CLIENT_ATTESTED_ACHIEVEMENTS.has(id)) {
      sendJson(res, 400, { ok: false, msg: "Not a client-attestable achievement." });
      return;
    }
    entry.achievements = entry.achievements || { unlocked: {} };
    if (!entry.achievements.unlocked[id]) {
      entry.achievements.unlocked[id] = Date.now();
      saveProfilesToDisk();
    }
    sendJson(res, 200, { ok: true, unlocked: entry.achievements.unlocked });
    return;
  }

  // Re-evaluates every server-verifiable achievement (profile age, mutual
  // friends, leaderboard participation, kart color) against ground truth the
  // server already owns, unlocking anything newly satisfied. Cheap enough to
  // call on every achievements-panel-open — no separate tracking/event
  // system needed for these.
  if (action === "check-achievements") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    entry.achievements = entry.achievements || { unlocked: {} };
    let changed = false;
    checkServerAchievements(key, entry).forEach((id) => {
      if (!entry.achievements.unlocked[id]) {
        entry.achievements.unlocked[id] = Date.now();
        changed = true;
      }
    });
    if (changed) saveProfilesToDisk();
    sendJson(res, 200, { ok: true, unlocked: entry.achievements.unlocked });
    return;
  }

  // --- Keys backup ---
  // js/keys.js's wallet is deliberately localStorage-first (see that file's
  // header comment) — this exists only so it also follows you between
  // devices, the same way avatar/kartColor already do. One round trip does
  // both directions at once: send your local balance, take the higher of it
  // and whatever's already saved (never silently move a balance backwards,
  // e.g. a second device that hasn't caught up yet), save that, hand it
  // back. A brand-new device sends 0 and gets its real balance back; a
  // balance you've been spending down keeps whichever side is highest, which
  // is the safe direction to err on for a cosmetics-only currency.
  if (action === "sync-keys") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const clientBalance = Number.isFinite(body.balance) ? Math.max(0, Math.min(MAX_KEYS_BALANCE, Math.floor(body.balance))) : null;
    if (clientBalance === null) { sendJson(res, 400, { ok: false, msg: "Invalid balance." }); return; }
    const serverBalance = typeof entry.keys === "number" ? entry.keys : 0;
    const merged = Math.max(serverBalance, clientBalance);
    if (merged !== serverBalance) {
      entry.keys = merged;
      entry.updatedAt = Date.now();
      saveProfilesToDisk();
    }
    sendJson(res, 200, { ok: true, balance: merged });
    return;
  }

  // Dev-only direct set (js/keys.js's devSet), mirrored to the server so it
  // sticks past the next sync-keys merge instead of losing to whatever
  // higher balance the device already had saved.
  if (action === "dev-set-keys") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    if (!entry.dev) { sendJson(res, 200, { ok: false, msg: "Dev accounts only." }); return; }
    const amount = Number.isFinite(body.balance) ? Math.max(0, Math.min(MAX_KEYS_BALANCE, Math.floor(body.balance))) : 0;
    entry.keys = amount;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, balance: entry.keys });
    return;
  }

  // --- Rival Arena weapon skins backup ---
  // Same shape as sync-keys just above, for the crate-unlocked cosmetics:
  // owned skins only ever grow (a union, never a removal — you can't lose
  // something you unlocked by syncing from a device that doesn't have it
  // yet), while which skin is equipped on which weapon is just a preference,
  // so the newest write wins for that part. Every id is checked against
  // RIVAL_SKIN_IDS so a malformed payload can't save something the game
  // doesn't actually know how to render.
  if (action === "sync-rival-skins") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const clientOwned = Array.isArray(body.owned) ? body.owned.filter((id) => typeof id === "string" && RIVAL_SKIN_IDS.has(id)) : [];
    const clientEquipped = {};
    if (body.equipped && typeof body.equipped === "object") {
      Object.entries(body.equipped).forEach(([weaponId, skinId]) => {
        if (isNonEmptyString(weaponId, 40) && typeof skinId === "string" && RIVAL_SKIN_IDS.has(skinId)) clientEquipped[weaponId] = skinId;
      });
    }
    const current = entry.rivalSkins || { owned: ["standard"], equipped: {} };
    const merged = Array.from(new Set([...current.owned, ...clientOwned, "standard"]));
    const changed = merged.length !== current.owned.length || JSON.stringify(clientEquipped) !== JSON.stringify(current.equipped);
    entry.rivalSkins = { owned: merged, equipped: clientEquipped };
    if (changed) { entry.updatedAt = Date.now(); saveProfilesToDisk(); }
    sendJson(res, 200, { ok: true, owned: merged, equipped: clientEquipped });
    return;
  }

  // --- One-time recovery code: the actual answer to "I forgot my password" —
  // deliberately independent of the optional notification email above, so
  // recovery works identically whether or not Resend is configured ---
  if (action === "generate-recovery-code") {
    if (wrongPassword()) { sendJson(res, 200, { ok: false, msg: "Wrong password." }); return; }
    const code = generateRecoveryCode();
    entry.recoveryCodeHash = hashRecoveryCode(code);
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    // the only time the plaintext code ever exists outside the user's own
    // head/notes — shown once, never stored, never retrievable again
    sendJson(res, 200, { ok: true, code });
    return;
  }

  if (action === "recover") {
    if (!entry || !entry.recoveryCodeHash) { sendJson(res, 200, { ok: false, msg: "No recovery code set up for that name." }); return; }
    const code = typeof body.recoveryCode === "string" ? body.recoveryCode.trim() : "";
    const newPasswordHash = typeof body.newPasswordHash === "string" ? body.newPasswordHash : "";
    if (!isNonEmptyString(code, 20) || !isNonEmptyString(newPasswordHash, 200)) {
      sendJson(res, 400, { ok: false, msg: "Missing recovery code or new password." });
      return;
    }
    if (hashRecoveryCode(code) !== entry.recoveryCodeHash) {
      sendJson(res, 200, { ok: false, msg: "That recovery code is wrong." });
      return;
    }
    entry.passwordHash = newPasswordHash;
    // single-use, like any backup code — a fresh one has to be generated
    // (while signed in normally) after this
    entry.recoveryCodeHash = null;
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, msg: "Password reset. Your recovery code has been used up — generate a new one from Settings once you're signed in." });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

// ---------- Leaderboards ----------
async function handleLeaderboardsApi(req, res, action) {
  if (action === "top") {
    // read-only, no auth needed — same LAN-trust level as the rest of this
    // app (nothing here requires a login to browse)
    const url = new URL(req.url, "http://localhost");
    const gameId = url.searchParams.get("gameId") || "";
    if (!LEADERBOARD_GAMES[gameId]) { sendJson(res, 400, { ok: false, msg: "Unknown game." }); return; }
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit"), 10) || 50));
    const sortDir = LEADERBOARD_GAMES[gameId].sortDir;
    const board = leaderboards[gameId] || {};
    const entries = Object.entries(board)
      .map(([key, row]) => ({ key, ...row }))
      .sort((a, b) => (sortDir === "asc" ? a.value - b.value : b.value - a.value))
      .slice(0, limit);
    sendJson(res, 200, { ok: true, gameId, sortDir, entries });
    return;
  }

  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 8 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Wrong password." });
    return;
  }

  if (action === "submit") {
    const gameId = typeof body.gameId === "string" ? body.gameId : "";
    const config = LEADERBOARD_GAMES[gameId];
    if (!config) { sendJson(res, 400, { ok: false, msg: "Unknown game." }); return; }
    const value = Number(body.value);
    if (!Number.isFinite(value) || Math.abs(value) >= 1e9) {
      sendJson(res, 400, { ok: false, msg: "Invalid score." });
      return;
    }
    leaderboards[gameId] = leaderboards[gameId] || {};
    const board = leaderboards[gameId];
    const existing = board[key];
    // Only overwrite if this is a genuine improvement (or the first entry) —
    // catches an accidental regression (e.g. a later, worse run) from
    // clobbering a real best. Doesn't stop a deliberately spoofed value; see
    // the achievements/leaderboards out-of-scope note for that trust
    // boundary.
    const isBetter = !existing || (config.sortDir === "asc" ? value < existing.value : value > existing.value);
    if (isBetter) {
      board[key] = { name: entry.name, avatar: entry.avatar || null, value, updatedAt: Date.now() };
      saveLeaderboardsToDisk();
      // rank #1 achievement, awarded right here rather than waiting for the
      // player to separately open the Achievements panel
      const sorted = Object.entries(board).sort((a, b) =>
        config.sortDir === "asc" ? a[1].value - b[1].value : b[1].value - a[1].value);
      if (sorted[0] && sorted[0][0] === key) {
        entry.achievements = entry.achievements || { unlocked: {} };
        if (!entry.achievements.unlocked["top-of-the-charts"]) {
          entry.achievements.unlocked["top-of-the-charts"] = Date.now();
          saveProfilesToDisk();
        }
      }
    }
    sendJson(res, 200, { ok: true, saved: isBetter, best: board[key].value });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

// Mirrors the id lists js/games/cake-bakery.js draws its palette from —
// kept in sync by hand (both lists are short and rarely change) rather than
// sharing a module, since client and server code aren't otherwise bundled
// together anywhere in this app.
const CAKE_BASE_IDS = new Set(["vanilla", "chocolate", "strawberry", "mint"]);
const CAKE_TOPPING_IDS = new Set(["none", "cherry", "sprinkles", "chocolate-drizzle", "strawberry-slice", "candle", "cookie", "flower"]);
const CAKE_SLOT_COUNT = 5;

function isValidCakeRecipe(base, toppings) {
  if (!CAKE_BASE_IDS.has(base)) return false;
  if (!Array.isArray(toppings) || toppings.length !== CAKE_SLOT_COUNT) return false;
  return toppings.every((t) => CAKE_TOPPING_IDS.has(t));
}

async function handleCakesApi(req, res, action) {
  if (action === "list") {
    // read-only, no auth needed — same LAN-trust level as leaderboards' "top"
    const url = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit"), 10) || 30));
    sendJson(res, 200, { ok: true, cakes: cakes.slice(-limit).reverse() });
    return;
  }

  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Wrong password." });
    return;
  }

  if (action === "publish") {
    if (!isValidCakeRecipe(body.base, body.toppings)) {
      sendJson(res, 400, { ok: false, msg: "That cake recipe doesn't look right." });
      return;
    }
    cakes.push({
      id: crypto.randomUUID(),
      name: entry.name,
      base: body.base,
      toppings: body.toppings,
      createdAt: Date.now(),
    });
    // trim from the front (oldest) — cakes.slice(-limit) above already reads
    // newest-first from the tail, so this keeps that same "recent" meaning
    if (cakes.length > MAX_STORED_CAKES) cakes.splice(0, cakes.length - MAX_STORED_CAKES);
    saveCakesToDisk();
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

async function handleFeedbackApi(req, res, action) {
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 8 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }

  if (action === "submit") {
    // Signing in is optional — attach a name if the caller proves one,
    // otherwise it's just from "Guest". Never trust a claimed name without
    // the matching password, or anyone could submit as someone else.
    const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
    const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
    const entry = profiles[key];
    const verified = entry && isNonEmptyString(passwordHash, 200) && entry.passwordHash === passwordHash;
    const category = typeof body.category === "string" ? body.category : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!FEEDBACK_CATEGORIES.has(category)) {
      sendJson(res, 400, { ok: false, msg: "Pick a category." });
      return;
    }
    if (!isNonEmptyString(message, 2000)) {
      sendJson(res, 400, { ok: false, msg: message.length > 2000 ? "That's a bit long — 2000 characters max." : "Write something first." });
      return;
    }
    feedback.push({
      id: crypto.randomUUID(),
      name: verified ? entry.name : "Guest",
      category,
      message,
      createdAt: Date.now(),
    });
    if (feedback.length > MAX_STORED_FEEDBACK) feedback.splice(0, feedback.length - MAX_STORED_FEEDBACK);
    saveFeedbackToDisk();
    const feedbackFromName = verified ? entry.name : "Guest";
    pushToDevs({ type: "new-feedback", category, name: feedbackFromName, message });
    // Email fallback for devs who aren't currently connected — see isOffline's
    // own comment for why this only fires when the push above had nobody to
    // actually reach.
    Object.entries(profiles).forEach(([devKey, devEntry]) => {
      if (devEntry.dev && devEntry.email && isOffline(devKey)) {
        sendEmail(devEntry.email, `New feedback from ${feedbackFromName}`,
          `<p><strong>${escapeHtml(category)}</strong> from ${escapeHtml(feedbackFromName)}:</p><p>${escapeHtml(message)}</p>`);
      }
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === "list") {
    const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
    const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
    const entry = profiles[key];
    if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash || !entry.dev) {
      sendJson(res, 200, { ok: false, msg: "Dev accounts only." });
      return;
    }
    sendJson(res, 200, { ok: true, feedback: feedback.slice().reverse() });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

async function handleVideosApi(req, res, action) {
  if (action === "list") {
    // read-only, no auth needed — same trust level as leaderboards' "top"
    const url = new URL(req.url, "http://localhost");
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit"), 10) || 30));
    sendJson(res, 200, { ok: true, videos: videos.slice(-limit).reverse() });
    return;
  }

  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Wrong password." });
    return;
  }

  if (action === "publish") {
    const videoId = extractYoutubeId(body.url);
    if (!videoId) {
      sendJson(res, 400, { ok: false, msg: extractYoutubeChannel(body.url) ? "That's a channel link — use “Post a Channel” instead." : "That doesn't look like a YouTube link." });
      return;
    }
    const title = isNonEmptyString(body.title, 120) ? body.title.trim() : "Untitled";
    videos.push({ id: crypto.randomUUID(), name: entry.name, videoId, title, createdAt: Date.now() });
    if (videos.length > MAX_STORED_VIDEOS) videos.splice(0, videos.length - MAX_STORED_VIDEOS);
    saveVideosToDisk();
    sendJson(res, 200, { ok: true });
    return;
  }

  // Posts a whole channel's recent uploads at once, rather than one link at
  // a time. There's no free/keyless API to list a channel's videos, but
  // every channel has a real, public RSS feed of its own recent uploads
  // (YouTube's own feature, not a workaround) — this resolves the channel id
  // (fetching the channel's own page to read it out, if a handle/vanity URL
  // was posted rather than a direct /channel/UC… link) and imports whatever
  // that feed returns. The feed itself caps at the ~15 most recent uploads —
  // YouTube's own limit, not one imposed here — so this is "recent", not
  // "entire channel history"; said plainly in the response message.
  if (action === "publish-channel") {
    const channelUrl = extractYoutubeChannel(body.url);
    if (!channelUrl) {
      sendJson(res, 400, { ok: false, msg: "That doesn't look like a YouTube channel link." });
      return;
    }
    try {
      const channelId = await resolveYoutubeChannelId(channelUrl);
      const found = await fetchChannelRecentVideos(channelId);
      if (!found.length) {
        sendJson(res, 200, { ok: false, msg: "Couldn't find any videos on that channel." });
        return;
      }
      const now = Date.now();
      // Pushed oldest-of-the-batch first so the channel's actual newest
      // upload ends up last — list's own newest-first reversal (see
      // handleCakesApi's comment on the same convention) then puts that
      // newest upload at the top of the board, matching what posting them
      // one at a time, oldest to newest, would have produced.
      found.slice().reverse().forEach((v) => {
        videos.push({ id: crypto.randomUUID(), name: entry.name, videoId: v.videoId, title: v.title, createdAt: now });
      });
      if (videos.length > MAX_STORED_VIDEOS) videos.splice(0, videos.length - MAX_STORED_VIDEOS);
      saveVideosToDisk();
      sendJson(res, 200, { ok: true, count: found.length });
    } catch (e) {
      sendJson(res, 200, { ok: false, msg: e.message || "Couldn't reach that channel." });
    }
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

// ---------- Friends (follow-based, mutual = friends) ----------
async function handleFriendsApi(req, res, action) {
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 8 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Wrong password." });
    return;
  }

  if (action === "follow") {
    const targetName = typeof body.targetName === "string" ? body.targetName.trim() : "";
    const targetKey = targetName.toLowerCase();
    if (!targetKey || targetKey === key) { sendJson(res, 200, { ok: false, msg: "Enter a valid name." }); return; }
    if (!profiles[targetKey]) { sendJson(res, 200, { ok: false, msg: "No profile with that name." }); return; }
    entry.following = entry.following || [];
    if (!entry.following.includes(targetKey)) {
      entry.following.push(targetKey);
      entry.updatedAt = Date.now();
      saveProfilesToDisk();
    }
    sendJson(res, 200, { ok: true, following: entry.following });
    return;
  }

  if (action === "unfollow") {
    const targetKey = typeof body.targetKey === "string" ? body.targetKey.trim().toLowerCase() : "";
    entry.following = (entry.following || []).filter((k) => k !== targetKey);
    entry.updatedAt = Date.now();
    saveProfilesToDisk();
    sendJson(res, 200, { ok: true, following: entry.following });
    return;
  }

  if (action === "list") {
    const followingKeys = entry.following || [];
    const followerKeys = Object.entries(profiles)
      .filter(([otherKey, other]) => otherKey !== key && (other.following || []).includes(key))
      .map(([otherKey]) => otherKey);
    const unionKeys = Array.from(new Set([...followingKeys, ...followerKeys]));
    const rows = unionKeys.map((otherKey) => {
      const other = profiles[otherKey];
      if (!other) return null;
      const isFollowing = followingKeys.includes(otherKey);
      const isFollower = followerKeys.includes(otherKey);
      const mutual = isFollowing && isFollower;
      // presence/room-code only ever shown to mutual friends — a one-way
      // follow sees nothing beyond "you follow them", by design (following
      // is unilateral/no-consent, so surfacing live location to someone who
      // was never followed back would be a real privacy leak)
      const online = mutual ? presenceByKey.has(otherKey) : false;
      const roomCode = mutual ? findRoomForProfileKey(otherKey) : null;
      return { key: otherKey, name: other.name, avatar: other.avatar || null, isFollowing, isFollower, online, roomCode };
    }).filter(Boolean);
    sendJson(res, 200, { ok: true, friends: rows });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

// ---------- Messages (mutual-friends-only DMs) ----------
async function handleMessagesApi(req, res, action) {
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = profiles[key];
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Wrong password." });
    return;
  }

  if (action === "inbox") {
    const followingKeys = entry.following || [];
    const mutualKeys = followingKeys.filter((otherKey) => (profiles[otherKey]?.following || []).includes(key));
    const rows = mutualKeys.map((otherKey) => {
      const other = profiles[otherKey];
      const thread = messages[threadKeyOf(key, otherKey)] || [];
      const last = thread.length ? thread[thread.length - 1] : null;
      return { key: otherKey, name: other.name, avatar: other.avatar || null, lastMessage: last };
    });
    rows.sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
    sendJson(res, 200, { ok: true, friends: rows });
    return;
  }

  if (action === "thread") {
    const withKey = typeof body.withKey === "string" ? body.withKey.trim().toLowerCase() : "";
    if (!isMutualFriend(key, withKey)) { sendJson(res, 200, { ok: false, msg: "You can only message mutual friends." }); return; }
    const thread = messages[threadKeyOf(key, withKey)] || [];
    sendJson(res, 200, { ok: true, name: profiles[withKey].name, messages: thread });
    return;
  }

  if (action === "send") {
    const toKey = typeof body.toKey === "string" ? body.toKey.trim().toLowerCase() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (toKey === key || !profiles[toKey]) { sendJson(res, 200, { ok: false, msg: "Invalid recipient." }); return; }
    if (!isMutualFriend(key, toKey)) { sendJson(res, 200, { ok: false, msg: "You can only message mutual friends." }); return; }
    if (!isNonEmptyString(text, MAX_MESSAGE_LEN)) { sendJson(res, 200, { ok: false, msg: `Message must be 1-${MAX_MESSAGE_LEN} characters.` }); return; }
    const tk = threadKeyOf(key, toKey);
    const message = { id: crypto.randomUUID(), from: key, text, ts: Date.now() };
    messages[tk] = messages[tk] || [];
    messages[tk].push(message);
    if (messages[tk].length > MAX_MESSAGES_PER_THREAD) messages[tk].splice(0, messages[tk].length - MAX_MESSAGES_PER_THREAD);
    saveMessagesToDisk();
    pushPresenceMessage(toKey, { type: "new-message", from: key, fromName: entry.name, text, ts: message.ts });
    // Email fallback if the recipient isn't currently connected — see
    // isOffline's own comment for why this only fires when the push above
    // had nobody to actually reach.
    if (profiles[toKey].email && isOffline(toKey)) {
      sendEmail(profiles[toKey].email, `${entry.name} messaged you on 51 Mimi Games`,
        `<p><strong>${escapeHtml(entry.name)}</strong>:</p><p>${escapeHtml(text)}</p>`);
    }
    sendJson(res, 200, { ok: true, message });
    return;
  }

  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

// ---------- Private page viewer: the search home's search box fetches a
// page server-side and shows it, rather than the visitor's own browser
// contacting the site directly (no referrer/analytics JS reaches the target
// site, and it never lands in the browser's own history). This is NOT a
// general-purpose proxy — it's deliberately narrow: text/HTML pages only, a
// handful of well-known IP ranges are refused up front, and every hop of
// every redirect gets the same check, not just the first request. ----------
const FETCH_TIMEOUT_MS = 10000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024; // 5MB — plenty for an HTML page, not for someone using this as a free file host
const FETCH_MAX_REDIRECTS = 5;
// A real, current browser UA — not a made-up one identifying this as a
// "viewer" tool. Sites like Google sniff the User-Agent to decide which
// build to serve; an unrecognized UA gets their legacy/degraded fallback
// (confirmed live: this is exactly why Google looked like an old-OS-era
// page and Maps rendered without its sidebar — both are Google's real
// fallback UI for a browser it doesn't recognize, not a rendering bug here).
const FETCH_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

// Refuses loopback/private/link-local/reserved ranges — the link-local block
// (169.254.0.0/16) matters as much as the private ones: it's where cloud
// providers serve instance-metadata endpoints (credentials, etc.) from, and
// it's also where this box's OWN server could be reached from if someone
// pointed the viewer at itself.
function isPrivateOrReservedIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique local
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice(7);
      if (net.isIPv4(v4)) return isPrivateOrReservedIP(v4);
    }
    return false;
  }
  return true; // couldn't even parse it as an IP — refuse rather than guess
}

// Resolves the hostname and checks EVERY address it comes back with (a
// hostname can round-robin across several) — and critically, hands the
// already-validated address straight to the request itself (via `lookup`
// below) instead of letting Node re-resolve DNS a second time when it
// connects. Re-resolving would reopen exactly the gap this exists to close:
// a hostname that resolves somewhere safe at check-time and somewhere
// internal a moment later (DNS rebinding).
function resolveSafeAddress(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) { reject(new Error("Could not resolve that host.")); return; }
      if (!addresses.length) { reject(new Error("Could not resolve that host.")); return; }
      const unsafe = addresses.find((a) => isPrivateOrReservedIP(a.address));
      if (unsafe) { reject(new Error("That address isn't allowed.")); return; }
      resolve(addresses[0]);
    });
  });
}

async function fetchPageOnce(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// links can be viewed.");
  }
  const safeAddress = await resolveSafeAddress(parsed.hostname);
  const client = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: { "User-Agent": FETCH_USER_AGENT, Accept: "text/html,*/*;q=0.8" },
        timeout: FETCH_TIMEOUT_MS,
        // pin the connection to the address already checked above, so Node
        // never performs its own separate (unchecked) DNS lookup
        lookup: (_hostname, _options, callback) => callback(null, safeAddress.address, safeAddress.family),
        // Node's newer Happy-Eyeballs dual-stack connect path
        // (lookupAndConnectMultiple) doesn't correctly handle a custom
        // `lookup` using the classic 3-arg (err, address, family) callback
        // above — it throws "Invalid IP address: undefined" from deep inside
        // net.js even though the address/family passed in are both valid
        // (confirmed directly: reproduced in isolation, fixed by this flag
        // alone). Force the legacy single-address connect path instead,
        // which that callback shape is actually designed for.
        autoSelectFamily: false,
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, targetUrl).toString() });
          return;
        }
        const contentType = res.headers["content-type"] || "";
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > FETCH_MAX_BYTES) {
            req.destroy(new Error("That page is too large to view here."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8"), finalUrl: targetUrl });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out reaching that page.")));
    req.on("error", (e) => reject(e));
    req.end();
  });
}

async function fetchPagePrivately(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop += 1) {
    const result = await fetchPageOnce(current);
    if (result.redirect) {
      if (hop === FETCH_MAX_REDIRECTS) throw new Error("Too many redirects.");
      current = result.redirect;
      continue;
    }
    return result;
  }
  throw new Error("Too many redirects.");
}

// Scripts now run (sandbox="allow-scripts", see index.html's #pageViewFrame)
// — most real sites (Google, YouTube, DuckDuckGo, ...) render blank without
// them, since their content is JS-rendered rather than present in the raw
// HTML. Deliberately NOT combined with allow-same-origin: a script-enabled
// frame that also shared the hub's own origin could reach into the hub's
// own localStorage/DOM (a well-known sandbox-escape combination) — without
// allow-same-origin, fetched-page scripts run in a fully isolated, opaque
// origin that can't touch anything of ours, only make their own direct
// requests (same as any other real webpage's scripts do). One narrow thing
// still worth stripping: a meta-refresh tag would otherwise auto-navigate
// the frame the instant it loads, before the URL bar or anything else here
// even has a chance to reflect it.
function stripActiveContent(html) {
  return html.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "");
}

// Opaque-origin frames (no allow-same-origin) don't just leave document.cookie/
// localStorage/sessionStorage empty the way a real "cookies blocked" browser
// setting would — they THROW on every access. Plenty of real sites' own boot
// scripts read one of these unconditionally, with no try/catch, expecting at
// worst an empty value — so instead of degrading gracefully, the uncaught
// exception kills their whole script before it ever renders anything
// (confirmed live: this is exactly why DuckDuckGo stayed blank while Google
// didn't — DDG's boot script hits document.cookie first thing, uncaught).
// Shimmed to behave like the "blocked" case sites actually expect: cookie
// reads/writes silently no-op, storage is a real (if page-lifetime-only,
// unshared) Storage-like object instead of a hole where one should be.
//
// This script also keeps every navigation private, not just the first page:
// once the visitor clicks a link or submits a GET form, that navigation
// would otherwise happen directly (no allow-same-origin means the hub can't
// reach in from outside to intercept it) — going straight to the real site,
// unshimmed and unproxied, and hitting this exact same cookie-exception
// blank-page problem all over again with nothing here to fix it. But THIS
// script runs INSIDE the fetched page's own document, so it can safely
// catch those events same-document (no special permission needed for that)
// and hand the resolved URL back to the hub via postMessage — which works
// across the sandbox boundary by design, unlike reaching in from outside —
// so the hub can re-fetch it through the same private proxy and this same
// shim/base treatment applies wherever the visitor clicks next too.
function buildCompatShim(hubOrigin) {
  return `<script>(function(){
  try {
    Object.defineProperty(document, "cookie", { get: function () { return ""; }, set: function () {}, configurable: true });
  } catch (e) {}
  function memoryStorage() {
    var data = Object.create(null);
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { return Object.keys(data)[i] ?? null; },
      get length() { return Object.keys(data).length; },
    };
  }
  try { Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true }); } catch (e) {}

  var HUB_ORIGIN = ${JSON.stringify(hubOrigin)};
  function relay(url) {
    try { window.parent.postMessage({ source: "mimi-private-browser", type: "navigate", url: url }, HUB_ORIGIN); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var link = e.target && e.target.closest && e.target.closest("a[href]");
    if (!link) return;
    var raw = link.getAttribute("href");
    if (!raw || raw.indexOf("#") === 0 || raw.indexOf("javascript:") === 0 || raw.indexOf("mailto:") === 0 || raw.indexOf("tel:") === 0) return;
    var target;
    try { target = new URL(raw, document.baseURI).toString(); } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    relay(target);
  }, true);
  // Google's own search box navigates via JS (window.open) rather than a
  // plain form submit or link click — confirmed live: this is exactly why
  // searching opened Google's real results in a genuine new browser tab
  // (allowed since the frame is sandboxed with allow-popups) instead of
  // staying inside this private viewer. Route it through the same relay
  // as clicks/forms instead of ever letting a real tab open.
  try {
    window.open = function (url) {
      if (url) {
        try { relay(new URL(url, document.baseURI).toString()); } catch (e) {}
      }
      // A real window.open() always returns a Window reference (or null only
      // on failure) — plenty of sites' own scripts assume success and call
      // something on it right after (.focus(), .document, ...) with no null
      // check. Returning bare null there throws, and since this runs during
      // the page's own boot script, that uncaught exception can kill the
      // rest of that script block — including whatever renders the page
      // itself — which is exactly why navigation looked like it silently
      // stopped working entirely rather than just not opening a real tab.
      // A harmless dummy object absorbs those calls instead of throwing.
      var dummy = {};
      try {
        return new Proxy(dummy, { get: function () { return function () {}; }, set: function () { return true; } });
      } catch (e) {
        return dummy;
      }
    };
  } catch (e) {}
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.tagName || form.tagName !== "FORM") return;
    var method = (form.getAttribute("method") || "get").toLowerCase();
    if (method !== "get") return; // no way to relay a POST body through a simple GET-based proxy — let it submit directly instead
    var target;
    try { target = new URL(form.getAttribute("action") || "", document.baseURI); } catch (err) { return; }
    try {
      new FormData(form).forEach(function (value, key) {
        if (typeof value === "string") target.searchParams.set(key, value);
      });
    } catch (err) {}
    e.preventDefault();
    e.stopPropagation();
    relay(target.toString());
  }, true);
})();</script>`;
}

// A relative URL inside srcdoc content resolves against the HUB's own
// origin, not the real site's — there's no other base for it to use.
// Confirmed live: this is exactly why Google's own search form 404'd
// against this server instead of reaching Google at all (its action="/search"
// resolved to https://localhost:1764/search), and why fonts/images/stylesheets
// referenced by relative path were all missing. A <base> tag fixes both, and
// is also what the shim's own link/form resolution (document.baseURI) relies
// on to compute the real absolute URL to relay back to the hub.
function injectCompatShim(html, baseUrl, hubOrigin) {
  const baseTag = baseUrl ? `<base href="${baseUrl.replace(/"/g, "&quot;")}">` : "";
  const inject = baseTag + buildCompatShim(hubOrigin);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (tag) => tag + inject);
  }
  return inject + html;
}

async function handleFetchPageApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, msg: "Method not allowed." });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req, 4 * 1024);
  } catch (e) {
    sendJson(res, 400, { ok: false, msg: "Bad request." });
    return;
  }
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!isNonEmptyString(rawUrl, 2000)) {
    sendJson(res, 400, { ok: false, msg: "Enter a URL." });
    return;
  }
  // a bare "example.com" (no scheme) is the common case typed into a search
  // box — assume https rather than making that a dead end
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const result = await fetchPagePrivately(withScheme);
    const hostHeader = req.headers.host || "localhost";
    const hubOrigin = `${hasCert ? "https" : "http"}://${hostHeader}`;
    sendJson(res, 200, {
      ok: true,
      url: result.finalUrl,
      contentType: result.contentType,
      html: injectCompatShim(stripActiveContent(result.body), result.finalUrl, hubOrigin),
    });
  } catch (e) {
    sendJson(res, 200, { ok: false, msg: e.message || "Couldn't load that page." });
  }
}

// ---------- Cloud worlds (arcade) ----------
// Blockcraft worlds saved to a signed-in profile. A world is a small JSON
// document the client builds (only the chunks the player edited, run-length
// encoded, plus where they were standing) — this server never looks inside it
// beyond size and shape checks. Stored per profile: an index (name, seed,
// PvP flag, timestamps) that lists cheaply, and one data blob per world that's
// only read when that world is loaded. Both live on disk and, when Upstash is
// configured, mirrored there so they survive redeploys.
const WORLDS_DIR = path.join(process.env.MIMI_DATA_DIR || ROOT, "data", "worlds");
const MAX_WORLDS_PER_PROFILE = 8;
const MAX_WORLD_DATA_LEN = 900_000;            // characters of one world's JSON
const WORLD_ID_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const worldIndexCache = new Map();             // profile key -> { [worldId]: meta }

function worldDirFor(key) {
  return path.join(WORLDS_DIR, crypto.createHash("sha256").update("mimiWorlds:" + key).digest("hex").slice(0, 32));
}

async function loadWorldIndex(key) {
  if (worldIndexCache.has(key)) return worldIndexCache.get(key);
  let index = null;
  if (UPSTASH_ENABLED) {
    try { index = await upstashGetJson(`mimi:widx:${key}`, null); } catch (e) { console.error("Upstash world index load failed:", e.message); }
  }
  if (!index) {
    try { index = JSON.parse(fs.readFileSync(path.join(worldDirFor(key), "index.json"), "utf8")); } catch (e) { index = {}; }
  }
  worldIndexCache.set(key, index);
  return index;
}

async function saveWorldIndex(key, index) {
  worldIndexCache.set(key, index);
  try {
    const dir = worldDirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  } catch (e) {
    console.error("Failed to persist world index:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try { await upstashSetJson(`mimi:widx:${key}`, index); } catch (e) { console.error("Failed to persist world index to Upstash:", e.message); }
  }
}

async function readWorldData(key, id) {
  if (UPSTASH_ENABLED) {
    try {
      const raw = await upstashCmd(["GET", `mimi:w:${key}:${id}`]);
      if (typeof raw === "string") return raw;
    } catch (e) { console.error("Upstash world load failed:", e.message); }
  }
  try { return fs.readFileSync(path.join(worldDirFor(key), `w-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 24)}.json`), "utf8"); } catch (e) { return null; }
}

async function writeWorldData(key, id, dataString) {
  try {
    const dir = worldDirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `w-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 24)}.json`), dataString);
  } catch (e) {
    console.error("Failed to persist world:", e.message);
  }
  if (UPSTASH_ENABLED) {
    try { await upstashCmd(["SET", `mimi:w:${key}:${id}`, dataString]); } catch (e) { console.error("Failed to persist world to Upstash:", e.message); }
  }
}

async function removeWorldData(key, id) {
  try { fs.unlinkSync(path.join(worldDirFor(key), `w-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 24)}.json`)); } catch (e) { /* already gone */ }
  if (UPSTASH_ENABLED) { try { await upstashCmd(["DEL", `mimi:w:${key}:${id}`]); } catch (e) { /* best effort */ } }
}

async function deleteAllWorlds(key) {
  const index = await loadWorldIndex(key);
  for (const id of Object.keys(index)) await removeWorldData(key, id);
  worldIndexCache.delete(key);
  try { fs.rmSync(worldDirFor(key), { recursive: true, force: true }); } catch (e) { /* nothing there */ }
  if (UPSTASH_ENABLED) { try { await upstashCmd(["DEL", `mimi:widx:${key}`]); } catch (e) { /* best effort */ } }
}

// Total size of every stored world, recomputed at most once a minute — a cheap guard so the
// server's disk can't be filled by accounts saving worlds.
let worldStoreSizeCache = { at: 0, bytes: 0 };
function worldStoreBytes() {
  if (Date.now() - worldStoreSizeCache.at < 60_000) return worldStoreSizeCache.bytes;
  let total = 0;
  const walk = (dir) => {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of names) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else { try { total += fs.statSync(full).size; } catch (e) { /* vanished */ } }
    }
  };
  walk(WORLDS_DIR);
  worldStoreSizeCache = { at: Date.now(), bytes: total };
  return total;
}

async function handleWorldsApi(req, res, action) {
  if (req.method !== "POST") { sendJson(res, 405, { ok: false, msg: "Method not allowed." }); return; }
  let body;
  try { body = await readJsonBody(req, 1_100_000); } catch (e) { sendJson(res, 400, { ok: false, msg: "Bad request." }); return; }
  const key = typeof body.key === "string" ? body.key.trim().toLowerCase() : "";
  const passwordHash = typeof body.passwordHash === "string" ? body.passwordHash : "";
  const entry = isNonEmptyString(key, 40) ? profiles[key] : null;
  if (!entry || !isNonEmptyString(passwordHash, 200) || entry.passwordHash !== passwordHash) {
    sendJson(res, 200, { ok: false, msg: "Sign in first." });
    return;
  }
  const index = await loadWorldIndex(key);
  const id = typeof body.id === "string" ? body.id : "";

  if (action === "list") {
    sendJson(res, 200, { ok: true, worlds: Object.values(index).sort((a, b) => b.savedAt - a.savedAt), max: MAX_WORLDS_PER_PROFILE });
    return;
  }
  if (!WORLD_ID_RE.test(id)) { sendJson(res, 400, { ok: false, msg: "Bad world id." }); return; }

  if (action === "get") {
    if (!index[id]) { sendJson(res, 200, { ok: false, msg: "No such world." }); return; }
    const data = await readWorldData(key, id);
    if (data === null) { sendJson(res, 200, { ok: false, msg: "That world's data is missing." }); return; }
    sendJson(res, 200, { ok: true, meta: index[id], data });
    return;
  }

  if (action === "put") {
    const data = typeof body.data === "string" ? body.data : "";
    if (!data || data.length > MAX_WORLD_DATA_LEN) {
      sendJson(res, 200, { ok: false, tooBig: data.length > MAX_WORLD_DATA_LEN, msg: data ? "That world is too big to save to your account." : "Nothing to save." });
      return;
    }
    try { JSON.parse(data); } catch (e) { sendJson(res, 400, { ok: false, msg: "World data is not valid." }); return; }
    if (worldStoreBytes() + data.length > MAX_WORLD_STORE_BYTES) {
      sendJson(res, 200, { ok: false, msg: "The server's world storage is full right now — your world is still saved on this device." });
      return;
    }
    const existing = index[id];
    if (!existing && Object.keys(index).length >= MAX_WORLDS_PER_PROFILE) {
      sendJson(res, 200, { ok: false, full: true, msg: `You can keep ${MAX_WORLDS_PER_PROFILE} worlds on your account — delete one first.` });
      return;
    }
    // Optimistic concurrency: the client says which save it last saw, so an old
    // copy on another device can't silently overwrite newer progress.
    const expect = Number(body.expect) || 0;
    if (existing && expect !== existing.savedAt && body.force !== true) {
      sendJson(res, 200, { ok: false, conflict: true, savedAt: existing.savedAt, msg: "This world was saved from another device since you loaded it." });
      return;
    }
    const seed = Number.isFinite(Number(body.seed)) ? Math.floor(Number(body.seed)) : 0;
    const meta = {
      id,
      name: isNonEmptyString(body.name, 40) ? body.name : `World ${seed}`,
      seed,
      pvp: body.pvp === true,
      savedAt: Date.now(),
      bytes: data.length,
    };
    await writeWorldData(key, id, data);
    worldStoreSizeCache.at = 0;   // re-measure next time
    index[id] = meta;
    await saveWorldIndex(key, index);
    sendJson(res, 200, { ok: true, meta });
    return;
  }

  if (action === "delete") {
    if (index[id]) {
      delete index[id];
      await removeWorldData(key, id);
      await saveWorldIndex(key, index);
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { ok: false, msg: "Unknown action." });
}

function requestHandler(req, res) {
  const urlPath = req.url.split("?")[0];
  // (arcade) CORS preflight — the arcade's website and desktop app are other origins.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }
  if (API_ONLY) {
    // (arcade) only accounts, cloud worlds, a health check and the /mp WebSocket are served.
    if (urlPath === "/" || urlPath === "/health") {
      sendJson(res, 200, { ok: true, service: "mimi-arcade-hub", profiles: Object.keys(profiles).length, rooms: rooms.size, uptime: Math.round(process.uptime()) });
      return;
    }
    if (!urlPath.startsWith("/api/profiles/") && !urlPath.startsWith("/api/worlds/")) {
      sendJson(res, 404, { ok: false, msg: "Not found." });
      return;
    }
  }
  const worldsMatch = urlPath.match(/^\/api\/worlds\/([a-z-]+)$/);
  if (worldsMatch) {
    if (!checkRateLimit(req, res, "general", RATE_LIMIT_GENERAL)) return;
    handleWorldsApi(req, res, worldsMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  // Static files (the page itself, scripts, images) are deliberately not
  // gated — a real visitor's normal page load makes a couple dozen of
  // those in a second and none of them touch profiles.json or leaderboards
  // in a way worth throttling. Only /api/ ever reaches this check.
  if (urlPath.startsWith("/api/") && !checkRateLimit(req, res, "general", RATE_LIMIT_GENERAL)) return;
  const apiMatch = urlPath.match(/^\/api\/profiles\/([a-z-]+)$/);
  if (apiMatch) {
    handleProfilesApi(req, res, apiMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const leaderboardsMatch = urlPath.match(/^\/api\/leaderboards\/([a-z-]+)$/);
  if (leaderboardsMatch) {
    handleLeaderboardsApi(req, res, leaderboardsMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const friendsMatch = urlPath.match(/^\/api\/friends\/([a-z-]+)$/);
  if (friendsMatch) {
    handleFriendsApi(req, res, friendsMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const cakesMatch = urlPath.match(/^\/api\/cakes\/([a-z-]+)$/);
  if (cakesMatch) {
    handleCakesApi(req, res, cakesMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const feedbackMatch = urlPath.match(/^\/api\/feedback\/([a-z-]+)$/);
  if (feedbackMatch) {
    handleFeedbackApi(req, res, feedbackMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const videosMatch = urlPath.match(/^\/api\/videos\/([a-z-]+)$/);
  if (videosMatch) {
    handleVideosApi(req, res, videosMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  const messagesMatch = urlPath.match(/^\/api\/messages\/([a-z-]+)$/);
  if (messagesMatch) {
    handleMessagesApi(req, res, messagesMatch[1]).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  if (urlPath === "/api/latest-release") {
    handleLatestReleaseApi(req, res).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  if (urlPath === "/api/fetch-page") {
    handleFetchPageApi(req, res).catch(() => {
      sendJson(res, 500, { ok: false, msg: "Server error." });
    });
    return;
  }
  if (urlPath === "/sitemap.xml") {
    const origin = `${hasCert ? "https" : "http"}://${req.headers.host || "localhost"}`;
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(buildSitemapXml(origin));
    return;
  }
  serveStatic(req, res);
}

const server = hasCert
  ? https.createServer({ cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) }, requestHandler)
  : http.createServer(requestHandler);
const wss = new WebSocketServer({ server, path: "/mp", maxPayload: MP_MAX_PAYLOAD });
// ws's own constructor (given an external `server`) attaches its own
// 'error' listener to that server and re-emits it here on `wss` — so a
// listen failure (e.g. EADDRINUSE) fires ws's forwarding listener first
// (registered here, before the app's own handler further below), which
// synchronously re-throws as unhandled on THIS emitter since nothing
// listens for 'error' on it specifically. That throw aborts the event
// entirely before the server's own listener (down by server.listen) ever
// runs, no matter what order those two are written in below — confirmed
// live: this exact interaction was masking the app's own graceful
// port-in-use handling and crashing with Node's raw default trace instead.
wss.on("error", () => {});

// rooms: Map<roomCode, Map<clientId, { ws, name, color, avatar, profileKey }>>
const rooms = new Map();

// Friends "who's online" presence — reuses this same /mp WebSocket path
// rather than adding a second one, since it's already this app's one
// always-available real-time channel and a second WebSocketServer instance
// would just duplicate the connection-lifecycle scaffolding below for no
// real benefit. A Set (not a single ws) per key, so multiple tabs/devices
// signed into the same profile all count as "online" until the last one
// disconnects. Populated by profiles.js opening a lightweight connection on
// page load — distinct from the per-room sockets Kart Circuit/play-together
// only open while actively hosting/joining a race.
const presenceByKey = new Map();

// Pushes an unsolicited payload straight to every open tab/device a profile
// key is currently connected from — same idiom the room relay already uses
// for targeted sends (rtc-offer/rtc-answer/hostPromoted below), just against
// presenceByKey's Set instead of a room's Map. A no-op if the recipient
// isn't currently connected — same "honest degradation" as presence itself
// (they'll just see it next time they open Messages, no queue/retry).
function pushPresenceMessage(targetKey, payload) {
  const sockets = presenceByKey.get(targetKey);
  if (!sockets || !sockets.size) return;
  const json = JSON.stringify(payload);
  sockets.forEach((sock) => {
    if (sock.readyState === sock.OPEN) sock.send(json);
  });
}

// Same idea as pushPresenceMessage, but fanned out to every currently
// connected dev account rather than one specific key — feedback has no
// single "recipient", any dev might be the one who wants to see it land.
function pushToDevs(payload) {
  const json = JSON.stringify(payload);
  presenceByKey.forEach((sockets, key) => {
    if (!profiles[key]?.dev) return;
    sockets.forEach((sock) => {
      if (sock.readyState === sock.OPEN) sock.send(json);
    });
  });
}

// Used by the Friends "list" action to show a mutual friend's current room
// code, if they're hosting/in one — reuses the existing room system rather
// than any new invite/notification plumbing.
function findRoomForProfileKey(key) {
  for (const [code, room] of rooms) {
    for (const player of room.values()) {
      if (player.profileKey === key) return code;
    }
  }
  return null;
}

// same cap as the profile picture upload itself (MAX_AVATAR_LEN above) —
// host/join messages carry a racer's avatar straight from their signed-in
// profile, so it's already been through that size check once, but a
// malformed/spoofed client shouldn't be able to hand every other racer in
// the room an oversized payload either
function sanitizeAvatar(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/") || value.length > MAX_AVATAR_LEN) return null;
  return value;
}

/* Public matchmaking for Kart Circuit's Play Online.
 *
 * Deliberately built on top of the existing room system rather than beside it:
 * a matchmade race *is* an ordinary room, so every client path that already
 * works — the `joined` reply, playerJoined/playerLeft, state relay, raceStart,
 * WebRTC signalling — is reused untouched. All matchmaking adds is (a) a way to
 * be put into a suitable room without knowing its code, and (b) the metadata
 * needed to decide which room is suitable.
 *
 * Kept out of the `rooms` Map's value shape on purpose: that value is a plain
 * Map of players, and several places iterate it expecting exactly that
 * (findRoomForProfileKey, roomPlayerList, broadcast). Metadata lives alongside,
 * keyed by the same room code.
 */
const roomMeta = new Map(); // roomCode -> { scope, region, open, countdown, hostId }

// "Regional" needs some notion of where a player is, and the one thing every
// browser reports without a permission prompt or a geo-IP service is its IANA
// time zone. The continent prefix of that ("Australia/Sydney" -> "Australia")
// is a coarse but honest region: close enough that a regional match really does
// mean lower latency, and it costs nothing to obtain.
const MATCH_REGIONS = new Set(["Africa", "America", "Antarctica", "Arctic", "Asia", "Atlantic", "Australia", "Europe", "Indian", "Pacific"]);
function sanitizeRegion(value) {
  const region = typeof value === "string" ? value.trim() : "";
  return MATCH_REGIONS.has(region) ? region : "Global";
}

// A room is joinable by matchmaking only while it's in the same bucket, still
// filling, and hasn't started — once a race begins, `open` goes false so nobody
// is dropped onto a track mid-lap.
function findOpenMatchRoom(scope, region) {
  for (const [code, meta] of roomMeta) {
    if (!meta.open || meta.scope !== scope) continue;
    if (scope === "regional" && meta.region !== region) continue;
    const room = rooms.get(code);
    if (!room || room.size === 0 || room.size >= MATCH_MAX_PLAYERS) continue;
    return { code, room, meta };
  }
  return null;
}

function matchStatusPayload(code) {
  const room = rooms.get(code);
  const meta = roomMeta.get(code);
  if (!room || !meta) return null;
  return {
    type: "matchStatus",
    room: code,
    scope: meta.scope,
    region: meta.region,
    players: room.size,
    max: MATCH_MAX_PLAYERS,
    min: MATCH_MIN_PLAYERS,
    startsIn: meta.countdown,
  };
}

function broadcastMatchStatus(code) {
  const payload = matchStatusPayload(code);
  const room = rooms.get(code);
  if (payload && room) broadcast(room, payload);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function roomPlayerList(room) {
  return Array.from(room.entries()).map(([id, p]) => ({ id, name: p.name, color: p.color, avatar: p.avatar || null }));
}

function broadcast(room, payload, exceptId) {
  const data = JSON.stringify(payload);
  room.forEach((peer, id) => {
    if (id === exceptId) return;
    if (peer.ws.readyState === peer.ws.OPEN) peer.ws.send(data);
  });
}

let nextClientId = 1;

wss.on("connection", (ws) => {
  const clientId = String(nextClientId++);
  let joinedRoom = null;
  let roomCode = null;
  let presenceKey = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    if (msg.type === "presence-hello") {
      const pKey = typeof msg.key === "string" ? msg.key.trim().toLowerCase() : "";
      const pHash = typeof msg.passwordHash === "string" ? pepperHash(msg.passwordHash) : "";
      const pEntry = profiles[pKey];
      if (!pEntry || pEntry.passwordHash !== pHash) return; // silently ignore — not a real error the caller needs to see
      presenceKey = pKey;
      if (!presenceByKey.has(pKey)) presenceByKey.set(pKey, new Set());
      presenceByKey.get(pKey).add(ws);
      return;
    }

    if (msg.type === "host") {
      roomCode = makeRoomCode();
      joinedRoom = new Map();
      rooms.set(roomCode, joinedRoom);
      joinedRoom.set(clientId, { ws, name: msg.name || "Player", color: msg.color || "#ffd166", avatar: sanitizeAvatar(msg.avatar), profileKey: typeof msg.profileKey === "string" ? msg.profileKey : null });
      ws.send(JSON.stringify({ type: "joined", id: clientId, room: roomCode, isHost: true, players: roomPlayerList(joinedRoom) }));
      return;
    }

    if (msg.type === "matchmake") {
      // Put the caller into a suitable public room, creating one if there
      // isn't a suitable one yet. Either branch replies with exactly the same
      // `joined` message host/join send, so the client needs no separate
      // "I matchmade" code path — it's in a room, same as always.
      const scope = msg.scope === "regional" ? "regional" : "global";
      const region = sanitizeRegion(msg.region);
      const existing = findOpenMatchRoom(scope, region);
      const player = {
        ws,
        name: msg.name || "Racer",
        color: msg.color || "#53e0ff",
        avatar: sanitizeAvatar(msg.avatar),
        profileKey: typeof msg.profileKey === "string" ? msg.profileKey : null,
      };

      if (existing) {
        joinedRoom = existing.room;
        roomCode = existing.code;
        joinedRoom.set(clientId, player);
        // isHost stays with whoever opened the room: one client has to own the
        // track choice and the actual raceStart, and that's already how every
        // other room here works.
        ws.send(JSON.stringify({ type: "joined", id: clientId, room: roomCode, isHost: false, matchmade: true, players: roomPlayerList(joinedRoom) }));
        broadcast(joinedRoom, { type: "playerJoined", id: clientId, name: player.name, color: player.color, avatar: player.avatar }, clientId);
      } else {
        roomCode = makeRoomCode();
        joinedRoom = new Map();
        rooms.set(roomCode, joinedRoom);
        roomMeta.set(roomCode, { scope, region, open: true, countdown: null, hostId: clientId });
        joinedRoom.set(clientId, player);
        ws.send(JSON.stringify({ type: "joined", id: clientId, room: roomCode, isHost: true, matchmade: true, players: roomPlayerList(joinedRoom) }));
      }

      // Reaching the minimum arms the countdown; it is never re-armed or
      // extended by later arrivals, so a room that keeps filling still starts
      // on schedule instead of being held open indefinitely.
      const meta = roomMeta.get(roomCode);
      if (meta && meta.countdown === null && joinedRoom.size >= MATCH_MIN_PLAYERS) {
        meta.countdown = MATCH_COUNTDOWN_SECONDS;
      }
      broadcastMatchStatus(roomCode);
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.room || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: "joinError", reason: "Room not found." }));
        return;
      }
      if (room.size >= ROOM_MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: "joinError", reason: "Room is full." }));
        return;
      }
      joinedRoom = room;
      roomCode = code;
      const avatar = sanitizeAvatar(msg.avatar);
      room.set(clientId, { ws, name: msg.name || "Player", color: msg.color || "#53e0ff", avatar, profileKey: typeof msg.profileKey === "string" ? msg.profileKey : null });
      ws.send(JSON.stringify({ type: "joined", id: clientId, room: roomCode, isHost: false, players: roomPlayerList(room) }));
      broadcast(room, { type: "playerJoined", id: clientId, name: msg.name || "Player", color: msg.color || "#53e0ff", avatar }, clientId);
      return;
    }

    if (!joinedRoom) return;

    if (msg.type === "state") {
      msg.id = clientId;
      broadcast(joinedRoom, msg, clientId);
      return;
    }

    if (msg.type === "raceStart") {
      // Close the room to matchmaking the moment its race begins — otherwise
      // the next player to search would be dropped onto a track mid-lap.
      const meta = roomMeta.get(roomCode);
      if (meta) {
        meta.open = false;
        meta.countdown = null;
      }
      msg.id = clientId;
      broadcast(joinedRoom, msg, clientId);
      return;
    }

    if (msg.type === "chat") {
      msg.id = clientId;
      broadcast(joinedRoom, msg, clientId);
      return;
    }

    if (msg.type === "rtc-offer" || msg.type === "rtc-answer" || msg.type === "rtc-ice") {
      const target = joinedRoom.get(msg.to);
      if (target && target.ws.readyState === target.ws.OPEN) {
        msg.from = clientId;
        target.ws.send(JSON.stringify(msg));
      }
      return;
    }
  });

  ws.on("close", () => {
    if (presenceKey && presenceByKey.has(presenceKey)) {
      const set = presenceByKey.get(presenceKey);
      set.delete(ws);
      if (set.size === 0) presenceByKey.delete(presenceKey);
    }
    if (!joinedRoom || !roomCode) return;
    joinedRoom.delete(clientId);
    broadcast(joinedRoom, { type: "playerLeft", id: clientId }, clientId);
    if (joinedRoom.size === 0) {
      rooms.delete(roomCode);
      roomMeta.delete(roomCode);
      return;
    }
    const meta = roomMeta.get(roomCode);
    if (!meta) return;
    // A matchmade room is full of strangers, so it can't be left leaderless the
    // way a room shared by code can — somebody has to own the track choice and
    // send the raceStart. The longest-present remaining racer takes over.
    if (meta.hostId === clientId) {
      const nextHostId = Array.from(joinedRoom.keys()).sort((a, b) => Number(a) - Number(b))[0];
      meta.hostId = nextHostId;
      const nextHost = joinedRoom.get(nextHostId);
      if (nextHost && nextHost.ws.readyState === nextHost.ws.OPEN) {
        nextHost.ws.send(JSON.stringify({ type: "hostPromoted", room: roomCode }));
      }
    }
    broadcastMatchStatus(roomCode);
  });
});

/* Drives the pre-race countdown for public matchmaking rooms. The server owns
 * the clock (not the host client) so every racer in the room sees the same
 * number, and so a host who alt-tabs can't stall the lobby. At zero it only
 * *signals* — the host client still picks the track and sends the real
 * raceStart, which is what every other client already listens for. */
setInterval(() => {
  roomMeta.forEach((meta, code) => {
    if (!meta.open || meta.countdown === null) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.size < MATCH_MIN_PLAYERS) {
      // dropped back below the minimum (someone left) — disarm and wait again
      meta.countdown = null;
      broadcastMatchStatus(code);
      return;
    }
    meta.countdown -= 1;
    if (meta.countdown > 0) {
      broadcastMatchStatus(code);
      return;
    }
    meta.countdown = null;
    meta.open = false;
    broadcast(room, { type: "matchGo", room: code });
  });
}, 1000);

// periodic sweep for abandoned empty rooms (defensive; close handler already covers the normal path)
setInterval(() => {
  rooms.forEach((room, code) => {
    if (room.size === 0) {
      rooms.delete(code);
      roomMeta.delete(code);
    }
  });
}, ROOM_TTL_MS);

// Without this, a taken port crashes with Node's default "Unhandled 'error'
// event" dump — fine for a dev server started by hand in a terminal (the
// stack trace is right there), but fatal for the packaged desktop app: it
// runs this same file as a background child process with no visible
// console, so that crash was previously just a silent, instant, unexplained
// close (confirmed live: this exact EADDRINUSE was the real cause behind a
// "flash then closes" report — a leftover dev server instance had the port
// held). A distinct, deliberately-chosen exit code (not a default 1) lets
// electron/main.js recognize this specific case and show an actual message
// instead of quitting with nothing shown at all.
const PORT_IN_USE_EXIT_CODE = 98;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — is another copy of this already running?`);
    process.exit(PORT_IN_USE_EXIT_CODE);
  }
  console.error("Server failed to start:", err.message);
  process.exit(1);
});

// Profiles/leaderboards/cakes are loaded here (not at module-load time)
// since the Upstash path above is a real network call — the server only
// starts accepting connections once this has actually finished, so nothing
// downstream ever sees the empty {}/[] a `let` starts life as.
async function bootstrapData() {
  profiles = await loadProfilesFromDisk();
  backfillProfileDefaults();
  leaderboards = await loadLeaderboardsFromDisk();
  cakes = await loadCakesFromDisk();
  feedback = await loadFeedbackFromDisk();
  videos = await loadVideosFromDisk();
  messages = await loadMessagesFromDisk();
}

bootstrapData().then(() => {
  server.listen(PORT, () => {
    const scheme = hasCert ? "https" : "http";
    const wsScheme = hasCert ? "wss" : "ws";
    console.log(`Mini Games server running at ${scheme}://localhost:${PORT}`);
    console.log(`Multiplayer relay at ${wsScheme}://localhost:${PORT}/mp`);
    if (!hasCert) {
      console.log("No TLS cert found in certs/ — voice chat (getUserMedia) will only work on http://localhost, not over the LAN.");
    }
  });

  // The desktop app's update feed (see package.json's build.publish) needs a
  // plain-HTTP way to reach this same content even when the main listener
  // above is HTTPS. Two separate downloaders hit this feed and neither goes
  // through Chromium (whose secure-context rules are why the main listener
  // uses TLS at all in the first place): the NSIS "web installer" bootstrapper
  // downloads its payload via Windows' own WinINet, which refuses the
  // self-signed dev cert outright (confirmed live — its real error for a
  // failed TLS handshake is a misleading "internet connection unavailable"
  // dialog); and electron-updater's own background download runs in the main
  // process after the one-shot NODE_TLS_REJECT_UNAUTHORIZED bypass around
  // checkForUpdates() (see electron/main.js) has already been restored, so it
  // would hit the same wall. Serving it over plain HTTP on a second port
  // sidesteps cert trust entirely without weakening TLS anywhere else.
  //
  // This same port also turns out to be the one worth pointing a plain-HTTP
  // tunnel (ngrok, localhost.run, etc.) at, since those terminate TLS
  // themselves and expect a plain-HTTP origin behind them — the self-signed
  // main listener above doesn't fit that. Multiplayer needs the /mp relay to
  // come along for that to actually work, so it gets its own WebSocketServer
  // here rather than only living on the main listener; every connection is
  // handed off into the exact same handler/rooms Map as the main one below,
  // so there's no separate relay logic to keep in sync.
  if (hasCert) {
    const UPDATE_FEED_HTTP_PORT = Number(PORT) + 1;
    const updateFeedServer = http.createServer(requestHandler);
    const updateFeedWss = new WebSocketServer({ server: updateFeedServer, path: "/mp", maxPayload: MP_MAX_PAYLOAD });
    updateFeedWss.on("error", () => {});
    updateFeedWss.on("connection", (ws, req) => wss.emit("connection", ws, req));
    updateFeedServer.listen(UPDATE_FEED_HTTP_PORT, () => {
      console.log(`Update feed also served over plain HTTP at http://localhost:${UPDATE_FEED_HTTP_PORT}/downloads/updates/`);
    });
  }
}).catch((e) => {
  console.error("Failed to load persisted data — refusing to start:", e.message);
  process.exit(1);
});
