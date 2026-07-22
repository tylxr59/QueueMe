import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlaybackSnapshot, QueueSnapshot } from "@queueme/contracts";
import { formatDuration, humanize, NowPlaying, QueueList } from "./components";

describe("humanize", () => {
  it("turns machine state into readable copy", () => {
    expect(humanize("restart_recovery")).toBe("Restart recovery");
  });
});

describe("formatDuration", () => {
  it("formats milliseconds as minutes and seconds", () => {
    expect(formatDuration(12_900)).toBe("0:12");
    expect(formatDuration(134_000)).toBe("2:14");
  });
});

describe("guest-name attribution", () => {
  it("shows who queued the current song and can hide attribution from guest components", () => {
    expect(renderToStaticMarkup(createElement(NowPlaying, { queue, playback }))).toContain("Queued by Alice");
    expect(renderToStaticMarkup(createElement(NowPlaying, { queue, playback, showGuestName: false }))).not.toContain("Alice");
    expect(renderToStaticMarkup(createElement(QueueList, { queue }))).toContain("Added by Bob");
    expect(renderToStaticMarkup(createElement(QueueList, { queue, showGuestNames: false }))).not.toContain("Bob");
  });
});

const track = {
  provider: "spotify" as const,
  providerTrackId: "track-id",
  playbackUri: "spotify:track:track-id",
  title: "Test song",
  artists: ["Test artist"],
  album: "Test album",
  durationMs: 180_000,
  artworkUrl: null,
  externalUrl: "https://open.spotify.com/track/track-id",
  explicit: false,
};

const queue: QueueSnapshot = {
  revision: 1,
  policy: "fifo",
  current: { id: "current", track, guestName: "Alice", status: "current", position: null, pinnedPosition: null, addedAt: 1 },
  items: [{ id: "next", track, guestName: "Bob", status: "queued", position: 0, pinnedPosition: null, addedAt: 2 }],
};

const playback: PlaybackSnapshot = {
  revision: 1,
  status: "playing",
  blockReason: null,
  progressMs: 10_000,
  observedAt: Date.now(),
  device: { id: "device", name: "Player" },
  error: null,
};
