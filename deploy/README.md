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
3. **Use a paid plan** (the blueprint asks for `starter`). Render's free web
   services go to sleep when idle, which is the opposite of always running. The
   persistent disk that keeps the world across restarts needs a paid plan too.

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

## Showing a one-click "Join PvP Arena" button on the website

Build the site with the server's address in `VITE_PVP_SERVER`:

```bash
VITE_PVP_SERVER=wss://blockcraft-pvp.onrender.com npm run build
```

(On Render's static site, add it as an environment variable and redeploy.)
Leave it unset and the button simply doesn't appear; anyone can still paste the
address into the Multiplayer panel.

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `7443` | Port to listen on (hosting platforms set this for you) |
| `PVP` | off | `1` turns on hearts, hitting, death and scoring (same as `--pvp`) |
| `DATA_FILE` | none | JSON file the world (seed + block edits) is saved to every 30s and on shutdown |
| `MAX_PLAYERS` | `32` | Connections beyond this are refused |
