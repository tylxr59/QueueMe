import { describe, expect, it } from "vitest";
import { parseSpotifyTrackId } from "./service.js";

describe("Spotify input parser", () => {
  it("parses Spotify track URLs and URIs", () => {
    expect(parseSpotifyTrackId("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x")).toBe("4uLU6hMCjMI75M1A2tKUQC");
    expect(parseSpotifyTrackId("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe("4uLU6hMCjMI75M1A2tKUQC");
  });

  it("rejects non-track resources", () => {
    expect(parseSpotifyTrackId("https://open.spotify.com/album/abc12345")).toBeNull();
  });
});

