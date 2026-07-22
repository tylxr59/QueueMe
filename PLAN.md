# QueueMe: Local-First Party Jukebox — Milestone 1

## Summary

Build a single-host, LAN-accessible party jukebox with a guest React UI, a locally owned persistent queue, anonymous guest nicknames, a PIN-protected admin UI, real Spotify Connect playback through separately managed librespot, Socket.IO updates, and a first-run web setup flow.

The first milestone supports Spotify track links and text search only. Simulated playback and non-Spotify link resolution are excluded, while resolver, queue-policy, queue-manager, and player-controller interfaces remain replaceable.

This is a private, non-commercial proof of concept. Spotify development mode requires the owner to have Premium. Guests do not authenticate with Spotify; only the owner does.

## Scope

### Included

- Single-owner Spotify OAuth and first-time setup wizard.
- Spotify track URLs, track URIs, and text search with five selectable results.
- Anonymous browser sessions with generated, editable nicknames.
- Persistent queue, configuration, sessions, and playback checkpoint.
- FIFO and round-robin ordering with pinned admin overrides.
- Admin reorder, remove, pause, resume, skip, device selection, and Spotify reconnection.
- Automatic playback when the first track is added.
- Sequential application-controlled playback and safe paused recovery after restart.
- Detection of external Spotify playback interference.
- Linux desktop operation and Raspberry Pi 4/ARM64 suitability.

### Excluded

- YouTube, TIDAL, Apple Music, and generic link mapping.
- Albums, playlists, podcasts, and multi-track submissions.
- Voting, moderation approval, accounts, roles, or internet hosting.
- Volume and seek controls.
- Managing or launching librespot.
- Spotify's native queue as the source of truth.
- Simulated playback and Docker as a requirement.

## Technology decisions

- Strict TypeScript and ESM on Node.js 24 LTS or newer.
- pnpm workspace.
- React and Vite SPA for setup, guest, login, and admin routes.
- Fastify serving REST, Socket.IO, and production static assets.
- SQLite with Drizzle and `better-sqlite3`.
- Shared Zod schemas for HTTP and realtime contracts.
- Vitest, React Testing Library, Fastify injection tests, and Playwright.
- `@dnd-kit` for accessible admin queue reordering.
- Plain CSS rather than a component framework.

Production runs as one Node process with one SQLite connection. Redis, SSR, a database server, and Docker are unnecessary.

## Repository structure

```text
QueueMe/
├── apps/
│   ├── server/
│   │   ├── drizzle/
│   │   └── src/
│   │       ├── config/
│   │       ├── db/
│   │       ├── modules/
│   │       │   ├── setup/
│   │       │   ├── security/
│   │       │   ├── sessions/
│   │       │   ├── spotify/
│   │       │   ├── resolver/
│   │       │   ├── queue/
│   │       │   ├── player/
│   │       │   └── realtime/
│   │       ├── routes/
│   │       ├── app.ts
│   │       └── server.ts
│   └── web/
│       └── src/
│           ├── app/
│           ├── api/
│           ├── realtime/
│           └── features/
├── packages/
│   ├── contracts/
│   └── core/
├── docs/
├── data/                 # ignored database and master key
├── pnpm-workspace.yaml
└── README.md
```

## Core interfaces

```ts
interface SubmissionResolver {
  supports(input: string): boolean;
  resolve(input: string, context: ResolveContext): Promise<Resolution>;
}

interface QueueOrderingPolicy {
  readonly id: "fifo" | "round_robin";
  order(items: PendingQueueItem[], context: OrderingContext): string[];
}

interface QueueManager {
  enqueue(command: EnqueueCommand): Promise<QueueSnapshot>;
  remove(command: RemoveCommand): Promise<QueueSnapshot>;
  pin(command: PinPositionCommand): Promise<QueueSnapshot>;
  unpin(command: UnpinCommand): Promise<QueueSnapshot>;
  setPolicy(command: SetPolicyCommand): Promise<QueueSnapshot>;
  promoteNext(): Promise<QueueItem | null>;
  completeCurrent(outcome: TerminalOutcome): Promise<QueueSnapshot>;
}

interface PlayerController {
  listDevices(): Promise<PlayerDevice[]>;
  getPlaybackState(): Promise<TransportSnapshot>;
  transfer(deviceId: string): Promise<void>;
  play(command: PlayTrackCommand): Promise<void>;
  pause(deviceId: string): Promise<void>;
}
```

The queue consumes provider-neutral canonical tracks. Future source resolvers must still emit a Spotify-backed track for the first playback backend; future player backends can implement `PlayerController` without changing queue storage.

## First-run setup and security

When no completed configuration exists:

1. Generate a one-time setup code and print it to the terminal.
2. Require the code at `/setup` before accepting configuration.
3. Collect an admin PIN, Spotify client ID and secret, and jukebox display name.
4. Show `http://127.0.0.1:3000/api/v1/oauth/spotify/callback` as the default redirect URI.
5. Run server-side Authorization Code OAuth with `user-read-playback-state` and `user-modify-playback-state`.
6. Save the owner identifier, discover devices, and optionally select librespot.
7. Allow completion without a device, but block playback until one is selected.

Generate `data/master.key` with mode `0600`, encrypt Spotify secrets and tokens with AES-256-GCM, and hash the PIN with `crypto.scrypt`. Cookies are opaque, HttpOnly, and SameSite Strict. Sensitive values are redacted from logs. Admin sessions last 12 hours; guest sessions last 30 days.

OAuth setup and reconnection use an explicit loopback address. A remote Raspberry Pi setup uses an SSH loopback tunnel unless HTTPS is added later.

## Data model

- `app_settings`: setup status, jukebox name, queue policy/revision, round-robin cursor, and selected device.
- `spotify_owner`: encrypted credentials/tokens, owner metadata, scopes, expiry, and integration status.
- `guest_sessions`: UUID, display name, and timestamps.
- `admin_sessions`: hashed opaque token and expiry.
- `setup_sessions` and `oauth_states`: short-lived setup claims and OAuth state.
- `tracks`: provider-neutral normalized metadata, unique by provider and provider track ID.
- `queue_items`: public UUID, track, guest, arrival sequence, state, effective position, optional pin, idempotency key, and timestamps.
- `player_checkpoint`: lifecycle, block reason, current item, progress, revisions, device observation, and last error.

SQLite uses foreign keys, WAL mode, `synchronous=NORMAL`, and a five-second busy timeout. Committed migrations run before the HTTP listener starts.

## Queue behavior

FIFO orders unpinned tracks by immutable arrival sequence.

Round-robin groups unpinned tracks by guest, preserves per-guest arrival order, rotates from the guest following `lastServedGuestId`, and takes one track per guest per pass. The cursor updates when a track becomes current.

Admin movement assigns a zero-based pinned position. Pinned tracks occupy their slots and the base policy fills the gaps. Pin collisions shift later pins forward; positions normalize as preceding tracks leave. Pins survive policy changes and can be cleared individually or together. The current item cannot be moved.

Queue changes run through one serialized command path and SQLite transaction. Successful mutations increment `queueRevision`.

Defaults are 100 pending tracks, 10 enqueues per guest per minute, 30 resolutions per guest per minute, duplicates allowed, and idempotency by guest plus client request ID.

## Resolution

- Parse `open.spotify.com/track/{id}` and `spotify:track:{id}` without arbitrary URL fetching.
- Reject other resource types and other services as unsupported for milestone one.
- Search plain text with `type=track`, returning five results.
- Filter local and explicitly unplayable tracks.
- Return a session-bound resolution ID kept in a bounded five-minute cache.
- Require that resolution ID and one of its track IDs when enqueueing.
- Do not retain raw search text after resolution.

## API

All JSON endpoints use `/api/v1` and structured errors containing a code, message, and request ID.

### Health and setup

- `GET /health`
- `GET /api/v1/setup/status`
- `POST /api/v1/setup/claim`
- `PUT /api/v1/setup/config`
- `GET /api/v1/setup/spotify/start`
- `GET /api/v1/oauth/spotify/callback`
- `GET /api/v1/setup/devices`
- `PUT /api/v1/setup/device`
- `POST /api/v1/setup/complete`

### Guest

- `GET /api/v1/bootstrap`
- `PATCH /api/v1/guest/session`
- `POST /api/v1/resolve`
- `POST /api/v1/queue/items`

### Admin

- `POST /api/v1/admin/session`
- `DELETE /api/v1/admin/session`
- `GET /api/v1/admin/bootstrap`
- `PUT /api/v1/admin/security/pin`
- `PUT /api/v1/admin/spotify/app`
- `GET /api/v1/admin/spotify/start`
- `GET /api/v1/admin/devices`
- `PUT /api/v1/admin/device`
- `PUT /api/v1/admin/queue/policy`
- `PUT /api/v1/admin/queue/items/:id/position`
- `DELETE /api/v1/admin/queue/items/:id/pin`
- `DELETE /api/v1/admin/queue/pins`
- `DELETE /api/v1/admin/queue/items/:id`
- `POST /api/v1/admin/player/pause`
- `POST /api/v1/admin/player/resume`
- `POST /api/v1/admin/player/skip`

Admin queue mutations include an expected revision; stale writes return `409 REVISION_CONFLICT`.

## Realtime events

Commands remain REST operations. Socket.IO sends:

- `state:snapshot`
- `queue:updated`
- `playback:updated`
- `session:updated`
- `system:notice`
- Admin-only `admin:status` and `devices:updated`

Every snapshot carries revisions and server time. Socket recovery is enabled for short disconnects, but every client supports full resynchronization after an unrecovered reconnect.

## Playback state machine

```text
IDLE ──queue added──> STARTING ──success──> PLAYING
  ^                       │                    │
  │                       └──failure──> BLOCKED
  │                                            │
  │                    PAUSED <──pause─────────┤
  │                       │                    │
  │                       └──resume──> STARTING│
  │                                            │
  └──queue empty── ADVANCING <──complete/skip─┘
```

Block reasons include setup, authentication, device availability, external playback, restart recovery, rate limiting, and command failure.

- The first track auto-starts when OAuth and a device are available.
- Adding while paused or blocked does not resume.
- QueueMe plays one URI at a time and does not use Spotify's queue.
- An inactive selected device is transferred, confirmed active, then given an explicit play command.
- Active playback is polled about every two seconds; inactive state about every ten seconds.
- Natural completion combines URI, progress, playing state, and a duration watchdog.
- Unexpected early URI/device changes block for external playback; QueueMe does not stop the external music.
- Admin Resume explicitly reclaims the device at the last confirmed progress.
- Skip while paused selects the next track but remains paused.
- Queue exhaustion pauses the Spotify device to prevent autoplay.
- Device changes while playing pause and require Resume.
- Missing device IDs may rebind only to one exact name/type match.
- If QueueMe restarts while it had been playing, it reconciles the saved item with Spotify and automatically adopts or resumes matching playback. Device or track conflicts remain blocked for safe manual recovery.

## Interfaces

The guest UI includes now playing, progress, search/link input, result selection, nickname editing, and the shared queue. The admin UI includes PIN login, playback controls, drag and keyboard queue ordering, pins, policy selection, Spotify/device status, reconnection, and recovery guidance.

## Testing

- Unit-test parsers, ordering policies, pins, idempotency, revisions, player transitions, crypto, OAuth state, and restart/external-playback behavior.
- Integration-test setup, mocked Spotify OAuth/API, guest flows, policies, admin controls, sequential playback, error handling, Socket.IO synchronization, and SQLite restart.
- Browser-test setup, multiple guests, realtime updates, admin login/controls, reorder accessibility, and responsive layouts.
- Manually verify librespot discovery, sequential playback, pause/resume/skip, restart recovery, device loss, and external interference.

## Implementation phases

1. Workspace, contracts, Fastify/Vite applications, SQLite schema, and migrations.
2. Secure setup, PIN sessions, Spotify OAuth/gateway, token refresh, and device discovery.
3. Guest sessions, Spotify resolution, resolution cache, and guest UI.
4. Queue manager, FIFO/round-robin/pins, admin APIs, and realtime synchronization.
5. Spotify player controller, orchestration state machine, progress, and sequential playback.
6. Restart recovery, interference detection, failure states, security hardening, and recovery tools.
7. Automated tests, real Spotify verification, documentation, and Raspberry Pi guidance.

## Prerequisites and assumptions

- The owner supplies Spotify Premium and Developer credentials.
- librespot is maintained separately and appears as a Spotify Connect device.
- The app binds to `0.0.0.0:3000`, while OAuth is completed via `127.0.0.1:3000`.
- Local-first covers application state and orchestration; Spotify search and control still require internet access.
- The target is private/home use, not a public or commercial streaming service.
