CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  setup_complete INTEGER NOT NULL DEFAULT 0,
  jukebox_name TEXT NOT NULL DEFAULT 'QueueMe',
  admin_pin_salt TEXT,
  admin_pin_hash TEXT,
  queue_policy TEXT NOT NULL DEFAULT 'fifo' CHECK (queue_policy IN ('fifo', 'round_robin')),
  queue_revision INTEGER NOT NULL DEFAULT 0,
  last_served_guest_id TEXT,
  selected_device_id TEXT,
  selected_device_name TEXT,
  selected_device_type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spotify_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_id TEXT NOT NULL,
  encrypted_client_secret TEXT NOT NULL,
  account_id TEXT,
  account_name TEXT,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_issued_at INTEGER,
  scopes TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_track_id TEXT NOT NULL,
  playback_uri TEXT NOT NULL,
  title TEXT NOT NULL,
  artists_json TEXT NOT NULL,
  album TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  artwork_url TEXT,
  external_url TEXT NOT NULL,
  explicit INTEGER NOT NULL,
  metadata_updated_at INTEGER NOT NULL,
  UNIQUE(provider, provider_track_id)
);

CREATE TABLE IF NOT EXISTS queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('spotify_link', 'spotify_search')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'current', 'played', 'skipped', 'removed', 'failed')),
  position INTEGER,
  pinned_position INTEGER,
  client_request_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  terminal_reason TEXT,
  UNIQUE(guest_session_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS queue_status_position_idx ON queue_items(status, position);

CREATE TABLE IF NOT EXISTS player_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'idle',
  block_reason TEXT,
  current_queue_item_id INTEGER REFERENCES queue_items(id),
  progress_ms INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  observed_at INTEGER NOT NULL,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

