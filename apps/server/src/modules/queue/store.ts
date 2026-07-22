import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CanonicalTrack, PendingQueueItem, QueuePolicy } from "@queueme/core";
import { applyPinnedPositions, fifoPolicy, roundRobinPolicy } from "@queueme/core";
import type { QueueItemView, QueueSnapshot, TopTracksResponse } from "@queueme/contracts";

type TrackRow = {
  provider: "spotify";
  provider_track_id: string;
  playback_uri: string;
  title: string;
  artists_json: string;
  album: string;
  duration_ms: number;
  artwork_url: string | null;
  external_url: string;
  explicit: number;
};

type JoinedRow = TrackRow & {
  id: number;
  public_id: string;
  guest_session_id: string;
  display_name: string;
  status: "queued" | "current";
  position: number | null;
  pinned_position: number | null;
  added_at: number;
};

type TopTrackRow = TrackRow & { play_count: number; last_played_at: number };

export class RevisionConflictError extends Error {
  code = "REVISION_CONFLICT";
  statusCode = 409;
}

export class QueueStore {
  constructor(private readonly sqlite: Database.Database) {}

  snapshot(): QueueSnapshot {
    const settings = this.settings();
    const rows = this.activeRows();
    return {
      revision: settings.queue_revision,
      policy: settings.queue_policy,
      current: rows.find((row) => row.status === "current") ? toView(rows.find((row) => row.status === "current")!) : null,
      items: rows.filter((row) => row.status === "queued").sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(toView),
    };
  }

  enqueue(input: {
    track: CanonicalTrack;
    guestId: string;
    sourceType: "spotify_link" | "spotify_search";
    clientRequestId: string;
  }): QueueSnapshot {
    const existing = this.sqlite.prepare("SELECT public_id FROM queue_items WHERE guest_session_id = ? AND client_request_id = ?")
      .get(input.guestId, input.clientRequestId);
    if (existing) return this.snapshot();
    const pending = this.sqlite.prepare("SELECT COUNT(*) AS count FROM queue_items WHERE status = 'queued'").get() as { count: number };
    if (pending.count >= 100) throw Object.assign(new Error("The queue is full."), { code: "QUEUE_FULL", statusCode: 409 });

    this.sqlite.transaction(() => {
      const now = Date.now();
      this.sqlite.prepare(`INSERT INTO tracks (provider, provider_track_id, playback_uri, title, artists_json, album, duration_ms,
        artwork_url, external_url, explicit, metadata_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, provider_track_id) DO UPDATE SET playback_uri=excluded.playback_uri, title=excluded.title,
        artists_json=excluded.artists_json, album=excluded.album, duration_ms=excluded.duration_ms, artwork_url=excluded.artwork_url,
        external_url=excluded.external_url, explicit=excluded.explicit, metadata_updated_at=excluded.metadata_updated_at`)
        .run(input.track.provider, input.track.providerTrackId, input.track.playbackUri, input.track.title, JSON.stringify(input.track.artists),
          input.track.album, input.track.durationMs, input.track.artworkUrl, input.track.externalUrl, Number(input.track.explicit), now);
      const track = this.sqlite.prepare("SELECT id FROM tracks WHERE provider = ? AND provider_track_id = ?")
        .get(input.track.provider, input.track.providerTrackId) as { id: number };
      const max = this.sqlite.prepare("SELECT COALESCE(MAX(position), -1) AS value FROM queue_items WHERE status = 'queued'").get() as { value: number };
      this.sqlite.prepare(`INSERT INTO queue_items (public_id, track_id, guest_session_id, source_type, status, position,
        client_request_id, added_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`)
        .run(randomUUID(), track.id, input.guestId, input.sourceType, max.value + 1, input.clientRequestId, now);
      this.reorder(false);
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  setPolicy(policy: QueuePolicy, expectedRevision: number, clearPins: boolean) {
    this.assertRevision(expectedRevision);
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE app_settings SET queue_policy = ?, updated_at = ? WHERE id = 1").run(policy, Date.now());
      if (clearPins) this.sqlite.prepare("UPDATE queue_items SET pinned_position = NULL WHERE status = 'queued'").run();
      this.reorder(false);
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  pin(publicId: string, position: number, expectedRevision: number) {
    this.assertRevision(expectedRevision);
    this.sqlite.transaction(() => {
      const target = this.sqlite.prepare("SELECT id FROM queue_items WHERE public_id = ? AND status = 'queued'").get(publicId);
      if (!target) throw Object.assign(new Error("Queue item not found."), { code: "NOT_FOUND", statusCode: 404 });
      this.sqlite.prepare("UPDATE queue_items SET pinned_position = pinned_position + 1 WHERE status = 'queued' AND pinned_position >= ? AND public_id != ?")
        .run(position, publicId);
      this.sqlite.prepare("UPDATE queue_items SET pinned_position = ? WHERE public_id = ?").run(position, publicId);
      this.reorder(true);
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  unpin(publicId: string, expectedRevision: number) {
    this.assertRevision(expectedRevision);
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE queue_items SET pinned_position = NULL WHERE public_id = ? AND status = 'queued'").run(publicId);
      this.reorder(true);
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  clearPins(expectedRevision: number) {
    this.assertRevision(expectedRevision);
    this.sqlite.transaction(() => {
      this.sqlite.prepare("UPDATE queue_items SET pinned_position = NULL WHERE status = 'queued'").run();
      this.reorder(false);
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  remove(publicId: string, expectedRevision: number) {
    this.assertRevision(expectedRevision);
    let wasCurrent = false;
    this.sqlite.transaction(() => {
      const row = this.sqlite.prepare("SELECT status, position FROM queue_items WHERE public_id = ? AND status IN ('queued', 'current')").get(publicId) as
        | { status: string; position: number | null }
        | undefined;
      if (!row) throw Object.assign(new Error("Queue item not found."), { code: "NOT_FOUND", statusCode: 404 });
      wasCurrent = row.status === "current";
      this.sqlite.prepare("UPDATE queue_items SET status = 'removed', position = NULL, pinned_position = NULL, finished_at = ?, terminal_reason = 'admin_removed' WHERE public_id = ?")
        .run(Date.now(), publicId);
      if (wasCurrent) this.sqlite.prepare("UPDATE player_checkpoint SET current_queue_item_id = NULL WHERE id = 1").run();
      this.reorder(true);
      this.bumpRevision();
    })();
    return { snapshot: this.snapshot(), wasCurrent };
  }

  promoteNext(): QueueItemView | null {
    let promoted: QueueItemView | null = null;
    this.sqlite.transaction(() => {
      const next = this.activeRows().filter((row) => row.status === "queued").sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
      if (!next) return;
      this.sqlite.prepare("UPDATE queue_items SET status = 'current', position = NULL, pinned_position = NULL, started_at = ? WHERE id = ?")
        .run(Date.now(), next.id);
      this.sqlite.prepare("UPDATE app_settings SET last_served_guest_id = ?, updated_at = ? WHERE id = 1").run(next.guest_session_id, Date.now());
      this.sqlite.prepare("UPDATE player_checkpoint SET current_queue_item_id = ?, progress_ms = 0, updated_at = ? WHERE id = 1").run(next.id, Date.now());
      this.reorder(true);
      this.bumpRevision();
      promoted = { ...toView(next), status: "current", position: null, pinnedPosition: null };
    })();
    return promoted;
  }

  completeCurrent(status: "played" | "skipped" | "failed", reason?: string) {
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`UPDATE queue_items SET status = ?, finished_at = ?, terminal_reason = ? WHERE status = 'current'`)
        .run(status, Date.now(), reason ?? null);
      this.sqlite.prepare("UPDATE player_checkpoint SET current_queue_item_id = NULL, progress_ms = 0, updated_at = ? WHERE id = 1").run(Date.now());
      this.bumpRevision();
    })();
    return this.snapshot();
  }

  current(): QueueItemView | null {
    const row = this.activeRows().find((candidate) => candidate.status === "current");
    return row ? toView(row) : null;
  }

  topTracks(limit: number, offset: number): TopTracksResponse {
    const rows = this.sqlite.prepare(`SELECT t.provider, t.provider_track_id, t.playback_uri, t.title, t.artists_json,
      t.album, t.duration_ms, t.artwork_url, t.external_url, t.explicit, COUNT(q.id) AS play_count,
      MAX(q.finished_at) AS last_played_at
      FROM queue_items q JOIN tracks t ON t.id = q.track_id
      WHERE q.status = 'played'
      GROUP BY t.id
      ORDER BY play_count DESC, last_played_at DESC, t.id ASC
      LIMIT ? OFFSET ?`).all(limit + 1, offset) as TopTrackRow[];
    const hasMore = rows.length > limit;
    return {
      items: rows.slice(0, limit).map((row) => ({
        track: toTrack(row),
        playCount: row.play_count,
        lastPlayedAt: row.last_played_at,
      })),
      nextOffset: hasMore ? offset + limit : null,
    };
  }

  private reorder(normalizePins: boolean) {
    const settings = this.settings();
    const rows = this.activeRows().filter((row) => row.status === "queued");
    const pending: PendingQueueItem[] = rows.map((row) => ({
      id: row.public_id,
      guestId: row.guest_session_id,
      arrivalSequence: row.id,
      pinnedPosition: row.pinned_position,
    }));
    const policy = settings.queue_policy === "round_robin" ? roundRobinPolicy : fifoPolicy;
    const effective = applyPinnedPositions(policy.order(pending, settings.last_served_guest_id), pending);
    const updatePosition = this.sqlite.prepare("UPDATE queue_items SET position = ? WHERE public_id = ?");
    const normalizePin = this.sqlite.prepare("UPDATE queue_items SET pinned_position = ? WHERE public_id = ? AND pinned_position IS NOT NULL");
    effective.forEach((id, index) => {
      updatePosition.run(index, id);
      if (normalizePins) normalizePin.run(index, id);
    });
  }

  private activeRows(): JoinedRow[] {
    return this.sqlite.prepare(`SELECT q.*, g.display_name, t.provider, t.provider_track_id, t.playback_uri, t.title,
      t.artists_json, t.album, t.duration_ms, t.artwork_url, t.external_url, t.explicit
      FROM queue_items q JOIN guest_sessions g ON g.id = q.guest_session_id JOIN tracks t ON t.id = q.track_id
      WHERE q.status IN ('queued', 'current')`).all() as JoinedRow[];
  }

  private settings() {
    return this.sqlite.prepare("SELECT queue_policy, queue_revision, last_served_guest_id FROM app_settings WHERE id = 1").get() as {
      queue_policy: QueuePolicy;
      queue_revision: number;
      last_served_guest_id: string | null;
    };
  }

  private assertRevision(expected: number) {
    if (this.settings().queue_revision !== expected) throw new RevisionConflictError("The queue changed; refresh and try again.");
  }

  private bumpRevision() {
    this.sqlite.prepare("UPDATE app_settings SET queue_revision = queue_revision + 1, updated_at = ? WHERE id = 1").run(Date.now());
  }
}

function toView(row: JoinedRow): QueueItemView {
  return {
    id: row.public_id,
    guestName: row.display_name,
    status: row.status,
    position: row.position,
    pinnedPosition: row.pinned_position,
    addedAt: row.added_at,
    track: toTrack(row),
  };
}

function toTrack(row: TrackRow): CanonicalTrack {
  return {
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    playbackUri: row.playback_uri,
    title: row.title,
    artists: JSON.parse(row.artists_json) as string[],
    album: row.album,
    durationMs: row.duration_ms,
    artworkUrl: row.artwork_url,
    externalUrl: row.external_url,
    explicit: Boolean(row.explicit),
  };
}
