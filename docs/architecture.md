# Architecture

QueueMe has one authoritative process:

```text
Guest/Admin browsers
        │ REST commands + Socket.IO snapshots
        ▼
Fastify server ── QueueManager ── SQLite
        │                │
        │                └─ FIFO / round-robin / pinned overrides
        ▼
SpotifyGateway ── Spotify Web API ── librespot Spotify Connect device
```

The application queue is the only queue source of truth. QueueMe plays one Spotify URI at a time; it does not copy the pending list into Spotify's native queue.

`@queueme/core` owns provider-neutral track, resolver, ordering, and player interfaces. `@queueme/contracts` owns Zod request schemas and browser/server DTOs. The Fastify implementation adapts Spotify and SQLite to those interfaces, and the Vite application consumes only shared DTOs.

Queue and playback state have separate monotonic revisions. REST performs commands and returns authoritative snapshots. Socket.IO broadcasts snapshots so missing an individual packet is harmless; reconnecting clients fetch a full snapshot.

Secrets are encrypted with the generated `data/master.key`. Admin and setup browser cookies contain opaque values whose hashes are stored or retained server-side. Guests receive a random UUID cookie and no Spotify credentials.

See [../PLAN.md](../PLAN.md) for the complete behavioral specification.

