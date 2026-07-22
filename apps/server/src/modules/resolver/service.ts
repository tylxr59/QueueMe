import { randomUUID } from "node:crypto";
import type { CanonicalTrack } from "@queueme/core";
import type { ResolutionResponse } from "@queueme/contracts";
import type { SpotifyGateway } from "../spotify/gateway.js";

const SPOTIFY_ID = /^[A-Za-z0-9]{8,64}$/;

type CacheEntry = ResolutionResponse & { guestId: string; sourceType: "spotify_link" | "spotify_search" };

export class ResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly spotify: SpotifyGateway) {}

  async resolve(input: string, guestId: string): Promise<ResolutionResponse> {
    this.prune();
    const trackId = parseSpotifyTrackId(input);
    let tracks: CanonicalTrack[];
    let kind: "exact" | "candidates";
    let sourceType: CacheEntry["sourceType"];
    if (trackId) {
      tracks = [await this.spotify.getTrack(trackId)];
      kind = "exact";
      sourceType = "spotify_link";
    } else if (looksLikeUrl(input)) {
      throw Object.assign(new Error("Only Spotify track links are supported in this milestone."), { code: "UNSUPPORTED_SOURCE", statusCode: 422 });
    } else {
      tracks = await this.spotify.searchTracks(input);
      kind = "candidates";
      sourceType = "spotify_search";
    }
    if (tracks.length === 0) throw Object.assign(new Error("No playable Spotify tracks were found."), { code: "NO_RESULTS", statusCode: 404 });
    const result: ResolutionResponse = { resolutionId: randomUUID(), kind, tracks, expiresAt: Date.now() + 300_000 };
    this.cache.set(result.resolutionId, { ...result, guestId, sourceType });
    while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value as string);
    return result;
  }

  consume(resolutionId: string, trackId: string, guestId: string) {
    this.prune();
    const entry = this.cache.get(resolutionId);
    const track = entry?.tracks.find((candidate) => candidate.providerTrackId === trackId);
    if (!entry || entry.guestId !== guestId || !track) {
      throw Object.assign(new Error("The search result expired. Search again and select a track."), { code: "RESOLUTION_EXPIRED", statusCode: 410 });
    }
    return { track, sourceType: entry.sourceType };
  }

  private prune() {
    const now = Date.now();
    for (const [id, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(id);
  }
}

export function parseSpotifyTrackId(input: string): string | null {
  const trimmed = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]+)$/.exec(trimmed);
  if (uri?.[1] && SPOTIFY_ID.test(uri[1])) return uri[1];
  try {
    const url = new URL(trimmed);
    if (url.hostname !== "open.spotify.com") return null;
    const match = /^\/track\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    return match?.[1] && SPOTIFY_ID.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

const looksLikeUrl = (input: string) => /^https?:\/\//i.test(input.trim()) || /^spotify:/i.test(input.trim());

