# QueueMe

QueueMe is a local-first party jukebox. Guests on the same network can search Spotify or paste track links, while one owner account controls playback through a separately running librespot Spotify Connect device.

The current milestone includes the setup wizard, anonymous guests, the shared application queue, FIFO and round-robin ordering, pinned admin overrides, live browser updates, Spotify device selection, sequential playback, and restart/interference recovery.

## Requirements

- Node.js 24 or newer
- pnpm 10
- A Spotify Premium owner account and Spotify Developer application
- librespot running separately and visible as a Spotify Connect device
- A compiler toolchain if `better-sqlite3` does not have a prebuilt binary for the target

This checkout currently has librespot and the native compiler toolchain available. Install pnpm globally or use the pinned version through `npx pnpm@10.13.1`.

## Development

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. The API listens on port 3000 and Vite proxies API and Socket.IO traffic to it. The server prints a six-digit first-run setup code.

## Production-style local run

```bash
pnpm build
pnpm start
```

Open `http://127.0.0.1:3000` on the host. Guests may use `http://HOST_LAN_IP:3000` after setup.

Runtime data is stored under `data/` by default:

- `queueme.sqlite` — application database
- `queueme.sqlite-wal` / `queueme.sqlite-shm` — SQLite WAL files while running
- `master.key` — local encryption key; keep this with database backups and never commit it

QueueMe does not use `.env` files or require credentials in the shell. The browser setup stores the jukebox name, admin PIN hash, encrypted Spotify application credentials and OAuth tokens, selected device, and queue settings in SQLite. Host, port, callback URL, and data-directory environment overrides remain available only for unusual service/deployment layouts because those values are needed before the database can be opened; the defaults require no configuration.

## Spotify setup

The first-run wizard walks through the process and links directly to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Use the same Spotify Premium account to create the developer app, authorize QueueMe, and run librespot.

1. In Spotify's dashboard, choose **Create app**.
2. Give it a name and description, select **Web API**, and accept the developer terms.
3. Paste the exact redirect URI shown by QueueMe into **Redirect URIs**. With the default port it is:

```text
http://127.0.0.1:3000/api/v1/oauth/spotify/callback
```

4. Save the Spotify app, copy its **Client ID**, choose **View client secret**, and copy the **Client Secret** into QueueMe.
5. Save the QueueMe form, then choose **Connect Spotify owner** and approve access.

The redirect URI must match exactly. Spotify permits HTTP only for an explicit loopback IP address, so do not replace `127.0.0.1` with `localhost` or a private LAN address. Complete OAuth on the host itself, or use the SSH tunnel described in [docs/raspberry-pi.md](docs/raspberry-pi.md).

QueueMe requests only `user-read-playback-state` and `user-modify-playback-state`. Spotify secrets and owner tokens are encrypted locally and never sent to guest browsers.

See [docs/spotify.md](docs/spotify.md) for the complete walkthrough and troubleshooting notes.

## Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm db:generate
```

See [PLAN.md](PLAN.md) for the architecture and [docs/librespot.md](docs/librespot.md) for the player boundary.

## Important use restriction

QueueMe targets private, non-commercial home use. Review Spotify's Developer Terms and playback policies before using it in any venue or public setting.
