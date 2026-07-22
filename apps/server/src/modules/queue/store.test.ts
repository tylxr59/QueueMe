import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { CanonicalTrack } from "@queueme/core";
import { createDatabase } from "../../db/client.js";
import { QueueStore } from "./store.js";

describe("QueueStore", () => {
  let directory: string;
  let sqlite: Database.Database;
  let queue: QueueStore;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "queueme-test-"));
    sqlite = createDatabase({ host: "127.0.0.1", port: 0, dataDir: directory, redirectUri: "http://127.0.0.1/callback", secureCookies: false, webDevUrl: undefined, isProduction: false }).sqlite;
    const now = Date.now();
    sqlite.prepare("INSERT INTO guest_sessions (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run("a", "Alice", now, now);
    sqlite.prepare("INSERT INTO guest_sessions (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run("b", "Bob", now, now);
    queue = new QueueStore(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("round robins guests and preserves a pinned override", () => {
    queue.enqueue({ track: track("a1"), guestId: "a", sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    queue.enqueue({ track: track("a2"), guestId: "a", sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    queue.enqueue({ track: track("b1"), guestId: "b", sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    queue.enqueue({ track: track("b2"), guestId: "b", sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    let snapshot = queue.snapshot();
    snapshot = queue.setPolicy("round_robin", snapshot.revision, false);
    expect(snapshot.items.map((item) => item.track.title)).toEqual(["a1", "b1", "a2", "b2"]);
    const a2 = snapshot.items.find((item) => item.track.title === "a2")!;
    snapshot = queue.pin(a2.id, 0, snapshot.revision);
    expect(snapshot.items.map((item) => item.track.title)).toEqual(["a2", "a1", "b1", "b2"]);
  });

  it("deduplicates retries by guest request id", () => {
    const requestId = crypto.randomUUID();
    queue.enqueue({ track: track("same"), guestId: "a", sourceType: "spotify_search", clientRequestId: requestId });
    queue.enqueue({ track: track("same"), guestId: "a", sourceType: "spotify_search", clientRequestId: requestId });
    expect(queue.snapshot().items).toHaveLength(1);
  });

  it("ranks played tracks by play count and paginates without including skipped tracks", () => {
    play("favorite", "a");
    play("favorite", "b");
    play("other", "a");
    queue.enqueue({ track: track("skipped"), guestId: "a", sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    queue.promoteNext();
    queue.completeCurrent("skipped", "admin_skip");

    const first = queue.topTracks(1, 0);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ track: { title: "favorite" }, playCount: 2 });
    expect(first.nextOffset).toBe(1);

    const second = queue.topTracks(1, first.nextOffset!);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ track: { title: "other" }, playCount: 1 });
    expect(second.nextOffset).toBeNull();
  });

  function play(id: string, guestId: string) {
    queue.enqueue({ track: track(id), guestId, sourceType: "spotify_search", clientRequestId: crypto.randomUUID() });
    queue.promoteNext();
    queue.completeCurrent("played");
  }
});

function track(id: string): CanonicalTrack {
  return {
    provider: "spotify",
    providerTrackId: id.padEnd(8, "x"),
    playbackUri: `spotify:track:${id}`,
    title: id,
    artists: ["Test Artist"],
    album: "Test Album",
    durationMs: 180_000,
    artworkUrl: null,
    externalUrl: `https://open.spotify.com/track/${id}`,
    explicit: false,
  };
}
