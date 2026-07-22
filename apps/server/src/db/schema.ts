import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  setupComplete: integer("setup_complete", { mode: "boolean" }).notNull(),
  jukeboxName: text("jukebox_name").notNull(),
  adminPinSalt: text("admin_pin_salt"),
  adminPinHash: text("admin_pin_hash"),
  queuePolicy: text("queue_policy").notNull(),
  queueRevision: integer("queue_revision").notNull(),
  lastServedGuestId: text("last_served_guest_id"),
  selectedDeviceId: text("selected_device_id"),
  selectedDeviceName: text("selected_device_name"),
  selectedDeviceType: text("selected_device_type"),
  allowNicknameChanges: integer("allow_nickname_changes", { mode: "boolean" }).notNull(),
  showGuestNames: integer("show_guest_names", { mode: "boolean" }).notNull(),
  showAdminLink: integer("show_admin_link", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const spotifyOwner = sqliteTable("spotify_owner", {
  id: integer("id").primaryKey(),
  clientId: text("client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  accountId: text("account_id"),
  accountName: text("account_name"),
  encryptedAccessToken: text("encrypted_access_token"),
  encryptedRefreshToken: text("encrypted_refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at"),
  refreshTokenIssuedAt: integer("refresh_token_issued_at"),
  scopes: text("scopes"),
  status: text("status").notNull(),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});

export const guestSessions = sqliteTable("guest_sessions", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const adminSessions = sqliteTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  providerTrackId: text("provider_track_id").notNull(),
  playbackUri: text("playback_uri").notNull(),
  title: text("title").notNull(),
  artistsJson: text("artists_json").notNull(),
  album: text("album").notNull(),
  durationMs: integer("duration_ms").notNull(),
  artworkUrl: text("artwork_url"),
  externalUrl: text("external_url").notNull(),
  explicit: integer("explicit", { mode: "boolean" }).notNull(),
  metadataUpdatedAt: integer("metadata_updated_at").notNull(),
}, (table) => [uniqueIndex("tracks_provider_id_idx").on(table.provider, table.providerTrackId)]);

export const queueItems = sqliteTable("queue_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  trackId: integer("track_id").notNull().references(() => tracks.id),
  guestSessionId: text("guest_session_id").notNull().references(() => guestSessions.id),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull(),
  position: integer("position"),
  pinnedPosition: integer("pinned_position"),
  clientRequestId: text("client_request_id").notNull(),
  addedAt: integer("added_at").notNull(),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  terminalReason: text("terminal_reason"),
});

export const playerCheckpoint = sqliteTable("player_checkpoint", {
  id: integer("id").primaryKey(),
  status: text("status").notNull(),
  blockReason: text("block_reason"),
  currentQueueItemId: integer("current_queue_item_id").references(() => queueItems.id),
  progressMs: integer("progress_ms").notNull(),
  revision: integer("revision").notNull(),
  observedAt: integer("observed_at").notNull(),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});
