# Running the Blockcraft PvP server all the time

The server is one Node process (`server/blockcraft-server.mjs --pvp`). It's built
to be left alone: it answers `GET /health` for uptime monitors, drops dead
connections, survives stray errors, shuts down cleanly on SIGTERM, and (with
`DATA_FILE` set) saves the world so a restart keeps every block edit.

"Always running" is really two things: something that **restarts it if it dies or
the machine reboots**, and a **machine that is always on**. Pick one recipe.

| Recipe | Always on? | Restarts itself? | Notes |
| --- | --- | --- | --- |
| [Render](#render) | yes (paid plan) | yes | wss:// (TLS) included — easiest for the live site |
| [Docker / a VPS](#docker-on-a-vps) | as long as the box is | yes (`restart: unless-stopped`) | put Caddy in front for wss:// |
| [systemd](#systemd-linux-box) | as long as the box is | yes (`Restart=always`, starts at boot) | same TLS note |

> **wss:// matters.** The live site is served over https, and browsers refuse to
> open a plain `ws://` connection from an https page. So a server the website
> should reach must be behind TLS (`wss://…`). Render does that for you; on your
> own box use a reverse proxy such as Caddy. A `ws://` server is fine when you
> open the game from `http://localhost`.

## Render

1. In Render: **New → Blueprint**, pick this repo, and set the blueprint path to
   `deploy/render.yaml`.
2. Note the service URL it gets (e.g. `https://blockcraft-pvp.onrender.com`).
   Your server address is the same with `wss://`.
3. **The paid plan (`starter`, a few dollars a month) is what makes it truly always on.** Render's free web
   services go to sleep when idle, which is the opposite of always running. The
   persistent disk that keeps the world across restarts needs a paid plan too.

**No card? Use the free variant:** blueprint path `deploy/render-free.yaml`. It runs
on Render's free plan, with two catches: it sleeps after ~15 minutes idle (point a
free uptime monitor such as UptimeRobot at `https://<your-service>/health` every
5 minutes to keep it awake), and it has no disk, so block edits reset whenever the
service restarts.

## Docker on a VPS

```bash
cd deploy
docker compose up -d --build     # restarts on crash and on reboot
```

Then terminate TLS in front of it. With Caddy, a whole `Caddyfile` is:

```
pvp.example.com {
    reverse_proxy localhost:7443
}
```

and the server address is `wss://pvp.example.com`.

## systemd (Linux box)

Edit the paths/user in `blockcraft-pvp.service`, then:

```bash
sudo cp deploy/blockcraft-pvp.service /etc/systemd/system/
sudo systemctl enable --now blockcraft-pvp
journalctl -u blockcraft-pvp -f          # logs
```

## The account server (sign-in, cloud worlds, Kart Circuit online)

A second service, separate from the PvP arena: `hub-server/server.js`, adapted from the
51 Mimi Games hub server. It provides

- **accounts** (name + password, `/api/profiles/*`) — the **Sign in** button in the menu,
- **devices** — signing in registers the device and gives it a random token (the device keeps that, not the password hash), so the account can list where it's signed in and sign any device out (`/api/profiles/devices`, `revoke-device`, `revoke-others`, `logout`); up to 10 devices per account, idle for 90 days = signed out,
- **cloud Blockcraft worlds** (`/api/worlds/*`) — while signed in, every world is also saved to your
  account (up to 8 per account, 900 KB each) and shows up on any device you sign in on,
- the **`/mp` relay** Kart Circuit uses for *Play with Friends* and *Play Online*,
- `/health` for uptime monitors.

Everything else the original hub server does (its website, page viewer, feedback, friends, messages…) is
switched off (`HUB_API_ONLY=1`).

**To run it on Render:** New → Blueprint → blueprint path `deploy/render-hub.yaml`. The service name
`mimi-arcade-hub` matches the address the game already points at. To keep accounts and worlds across
restarts (the free plan's disk is wiped), add a free [Upstash](https://upstash.com) Redis database and
paste its REST URL and token into the `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` environment
variables. Point an uptime monitor at `/health` to stop it sleeping. Locally: `npm run server:hub`
(port 1764, or `PORT`).

| Variable | Default | What it does |
| --- | --- | --- |
| `HASH_PEPPER` | none (set by the blueprint) | Secret mixed into stored password hashes. **Never change it after launch** — every password would stop working. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | none | Persist accounts and worlds in Upstash (also written to `MIMI_DATA_DIR`) |
| `MIMI_DATA_DIR` | the server folder | Where the JSON files (profiles, worlds) are kept |
| `MAX_PROFILES` | `2000` | Sign-ups stop at this many accounts |
| `MAX_WORLD_STORE_MB` | `400` | Cloud worlds stop being accepted at this total size |
| `HUB_API_ONLY` | on | `0` restores the original everything-on hub behaviour |
| `HUB_ALLOW_DEV` | off | `1` allows creating dev accounts (needs the dev password) |

To use a different address than `https://mimi-arcade-hub.onrender.com`, build the site with
`VITE_HUB_URL=https://your-server npm run build`.

## The one-click "Join PvP Arena" button

The game already points at `wss://blockcraft-pvp.onrender.com` (set in
`src/games/blockcraft.js`). To use a different server, build with
`VITE_PVP_SERVER=wss://your-server npm run build`; set it to an empty value to
hide the button. Anyone can also paste any address into the Multiplayer panel.

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `7443` | Port to listen on (hosting platforms set this for you) |
| `PVP` | off | `1` turns on hearts, hitting, death and scoring (same as `--pvp`) |
| `DATA_FILE` | none | JSON file the world (seed + block edits) is saved to every 30s and on shutdown |
| `MAX_PLAYERS` | `32` | Connections beyond this are refused |
| `BOTS` | `3` (once bots are on) | Default number of AI bots each player fights. Every player chooses their own, 0–50, in the Multiplayer panel; their bots chase only them and leave with them (also `--bots=N`, which also turns bots on) |
| `MAX_BOTS` | `0` — **bots are off** | Ceiling on bots across the whole server; set it above 0 (or pass `--bots=N`) to turn bots on. The public PvP arena leaves them off: to fight bots, make a PvP world in the game and use its Multiplayer panel |
| `LOOT_FORCE` | off | Testing only: makes every bot kill drop the given kind(s) — `armor`, `golden`, `enchanted`, or a comma list to cycle. Normally drops are random (35% armour, 30% golden apple, 6% enchanted) |
| `BOT_LEVEL` | `medium` | Default AI level for players who haven't picked one (`supereasy`, `easy`, `medium`, `hard`, `extreme`) — players choose their own in the Multiplayer panel |
