# Raspberry Pi deployment notes

Target a 64-bit Raspberry Pi OS or another ARM64 Linux distribution on a Pi 4. Use Node.js 24 LTS and pnpm 10. QueueMe itself needs only one Node process and SQLite; librespot remains a separate service.

## OAuth over a loopback tunnel

Spotify permits an HTTP callback on `127.0.0.1`, but not on a private LAN IP. From a desktop on the same network, forward the Pi's QueueMe port:

```bash
ssh -L 3000:127.0.0.1:3000 USER@PI_HOST
```

Keep the SSH session open, browse to `http://127.0.0.1:3000`, and complete setup or Spotify reconnection. Guests can subsequently use the Pi's LAN URL.

## Data and backup

Stop QueueMe before a simple filesystem backup, then copy the entire data directory including `master.key`. The encrypted Spotify credentials cannot be recovered from the database without that key.

For a service installation, set `QUEUE_ME_DATA_DIR` to a persistent directory owned by the QueueMe service account. Do not place it in the Git checkout if the checkout will be replaced during upgrades.

## Native SQLite dependency

`better-sqlite3` may use a prebuilt ARM64 binary. If one is unavailable, pnpm will compile it and needs Python, Make, GCC/G++, and normal Node native-addon headers/tooling.

