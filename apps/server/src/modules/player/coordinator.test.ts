import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueItemView } from "@queueme/contracts";
import type { QueueStore } from "../queue/store.js";
import type { SpotifyGateway } from "../spotify/gateway.js";
import { PlayerCoordinator } from "./coordinator.js";

const current: QueueItemView = {
  id: "queue-item",
  guestName: "Guest",
  status: "current",
  position: null,
  pinnedPosition: null,
  addedAt: 1,
  track: {
    provider: "spotify",
    providerTrackId: "track-id",
    playbackUri: "spotify:track:track-id",
    title: "Track",
    artists: ["Artist"],
    album: "Album",
    durationMs: 180_000,
    artworkUrl: null,
    externalUrl: "https://open.spotify.com/track/track-id",
    explicit: false,
  },
};

describe("PlayerCoordinator restart recovery", () => {
  let sqlite: Database.Database;
  let coordinator: PlayerCoordinator;

  afterEach(() => {
    coordinator?.close();
    sqlite?.close();
  });

  it("adopts matching playback that continued through the restart", async () => {
    const spotify = createSpotify({
      deviceId: "device-id",
      trackUri: current.track.playbackUri,
      isPlaying: true,
      progressMs: 8_000,
      observedAt: Date.now(),
    });
    coordinator = createCoordinator(spotify);

    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ status: "playing", progressMs: 8_000, blockReason: null }));
    expect(spotify.play).not.toHaveBeenCalled();
  });

  it("resumes the saved item when Spotify no longer has active playback", async () => {
    const spotify = createSpotify({
      deviceId: null,
      trackUri: null,
      isPlaying: false,
      progressMs: 0,
      observedAt: Date.now(),
    });
    coordinator = createCoordinator(spotify);

    await vi.waitFor(() => expect(coordinator.snapshot().status).toBe("playing"));
    expect(spotify.play).toHaveBeenCalledWith({ deviceId: "device-id", track: current.track, positionMs: 4_000 });
  });

  it("does not overwrite conflicting Spotify playback", async () => {
    const spotify = createSpotify({
      deviceId: "device-id",
      trackUri: "spotify:track:someone-elses-track",
      isPlaying: true,
      progressMs: 12_000,
      observedAt: Date.now(),
    });
    coordinator = createCoordinator(spotify);

    await vi.waitFor(() => expect(coordinator.snapshot()).toMatchObject({ status: "blocked", blockReason: "external_playback" }));
    expect(spotify.play).not.toHaveBeenCalled();
  });

  function createCoordinator(spotify: ReturnType<typeof createSpotify>) {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY,
        selected_device_id TEXT,
        selected_device_name TEXT,
        selected_device_type TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE player_checkpoint (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        block_reason TEXT,
        progress_ms INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO app_settings VALUES (1, 'device-id', 'Kitchen', 'Speaker', 1);
      INSERT INTO player_checkpoint VALUES (1, 'playing', NULL, 4000, 1, 1, NULL, 1);
    `);
    const queue = {
      current: vi.fn(() => current),
      snapshot: vi.fn(() => ({ revision: 1, policy: "fifo", current, items: [] })),
    } as unknown as QueueStore;
    return new PlayerCoordinator(sqlite, queue, spotify as unknown as SpotifyGateway, { queue: vi.fn(), playback: vi.fn() });
  }
});

function createSpotify(playback: {
  deviceId: string | null;
  trackUri: string | null;
  isPlaying: boolean;
  progressMs: number;
  observedAt: number;
}) {
  return {
    isConnected: vi.fn(() => true),
    listDevices: vi.fn(async () => [{ id: "device-id", name: "Kitchen", type: "Speaker", active: true, restricted: false }]),
    getPlaybackState: vi.fn(async () => playback),
    transfer: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
  };
}
