import type Database from "better-sqlite3";
import type { CanonicalTrack, PlayerController, PlayerDevice, TransportSnapshot } from "@queueme/core";
import type { AppConfig } from "../../config.js";
import type { SecretBox } from "../security/crypto.js";

type OwnerRow = {
  client_id: string;
  encrypted_client_secret: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  access_token_expires_at: number | null;
};

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  is_local?: boolean;
  is_playable?: boolean;
  artists: Array<{ name: string }>;
  album: { name: string; images?: Array<{ url: string; width?: number }> };
  external_urls: { spotify: string };
};

export class SpotifyError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAfter?: number) {
    super(message);
  }
}

export class SpotifyGateway implements PlayerController {
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly secrets: SecretBox,
    private readonly config: AppConfig,
  ) {}

  isConnected() {
    const row = this.sqlite.prepare("SELECT status, encrypted_refresh_token FROM spotify_owner WHERE id = 1").get() as
      | { status: string; encrypted_refresh_token: string | null }
      | undefined;
    return row?.status === "connected" && Boolean(row.encrypted_refresh_token);
  }

  getAuthorizeUrl(state: string) {
    const owner = this.owner();
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: owner.client_id,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      state,
      scope: "user-read-playback-state user-modify-playback-state",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string) {
    const owner = this.owner();
    const clientSecret = this.secrets.decrypt(owner.encrypted_client_secret);
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${owner.client_id}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri }),
    });
    const token = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new SpotifyError(response.status, "OAUTH_EXCHANGE_FAILED", String(token.error_description ?? token.error));
    const now = Date.now();
    this.sqlite.prepare(`UPDATE spotify_owner SET encrypted_access_token = ?, encrypted_refresh_token = ?,
      access_token_expires_at = ?, refresh_token_issued_at = ?, scopes = ?, status = 'connected', last_error = NULL, updated_at = ? WHERE id = 1`)
      .run(
        this.secrets.encrypt(String(token.access_token)),
        this.secrets.encrypt(String(token.refresh_token)),
        now + Number(token.expires_in) * 1000,
        now,
        String(token.scope ?? ""),
        now,
      );
    const profile = await this.api<{ account_id?: string; id?: string; display_name?: string }>("/me");
    this.sqlite.prepare("UPDATE spotify_owner SET account_id = ?, account_name = ?, updated_at = ? WHERE id = 1")
      .run(profile.account_id ?? profile.id ?? null, profile.display_name ?? "Spotify owner", Date.now());
  }

  async searchTracks(query: string): Promise<CanonicalTrack[]> {
    const params = new URLSearchParams({ q: query, type: "track", limit: "5" });
    const result = await this.api<{ tracks: { items: SpotifyTrack[] } }>(`/search?${params}`);
    return result.tracks.items.filter((track) => !track.is_local && track.is_playable !== false).map(normalizeTrack);
  }

  async getTrack(id: string): Promise<CanonicalTrack> {
    return normalizeTrack(await this.api<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`));
  }

  async listDevices(): Promise<PlayerDevice[]> {
    const result = await this.api<{ devices: Array<{ id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean }> }>("/me/player/devices");
    return result.devices.filter((device): device is typeof device & { id: string } => Boolean(device.id)).map((device) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      active: device.is_active,
      restricted: device.is_restricted,
    }));
  }

  async getPlaybackState(): Promise<TransportSnapshot> {
    const response = await this.rawApi("/me/player");
    if (response.status === 204) return { deviceId: null, trackUri: null, isPlaying: false, progressMs: 0, observedAt: Date.now() };
    const state = await this.parseResponse<{
      device?: { id?: string | null };
      item?: { uri?: string } | null;
      is_playing?: boolean;
      progress_ms?: number | null;
    }>(response);
    return {
      deviceId: state.device?.id ?? null,
      trackUri: state.item?.uri ?? null,
      isPlaying: state.is_playing ?? false,
      progressMs: state.progress_ms ?? 0,
      observedAt: Date.now(),
    };
  }

  async transfer(deviceId: string) {
    await this.api<void>("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: false }) });
  }

  async play(input: { deviceId: string; track: CanonicalTrack; positionMs: number }) {
    await this.api<void>(`/me/player/play?device_id=${encodeURIComponent(input.deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [input.track.playbackUri], position_ms: input.positionMs }),
    });
  }

  async pause(deviceId: string) {
    await this.api<void>(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT" });
  }

  private owner(): OwnerRow {
    const row = this.sqlite.prepare("SELECT * FROM spotify_owner WHERE id = 1").get() as OwnerRow | undefined;
    if (!row) throw new SpotifyError(401, "SPOTIFY_NOT_CONFIGURED", "Spotify application credentials are not configured.");
    return row;
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    const owner = this.owner();
    if (!forceRefresh && owner.encrypted_access_token && (owner.access_token_expires_at ?? 0) > Date.now() + 300_000) {
      return this.secrets.decrypt(owner.encrypted_access_token);
    }
    if (!this.refreshPromise) this.refreshPromise = this.refresh(owner).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async refresh(owner: OwnerRow): Promise<string> {
    if (!owner.encrypted_refresh_token) throw new SpotifyError(401, "AUTH_REQUIRED", "Reconnect the Spotify owner account.");
    const refreshToken = this.secrets.decrypt(owner.encrypted_refresh_token);
    const clientSecret = this.secrets.decrypt(owner.encrypted_client_secret);
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${owner.client_id}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      this.sqlite.prepare("UPDATE spotify_owner SET status = 'auth_required', last_error = ?, updated_at = ? WHERE id = 1")
        .run(String(payload.error_description ?? payload.error), Date.now());
      throw new SpotifyError(response.status, "AUTH_REQUIRED", "Reconnect the Spotify owner account.");
    }
    const accessToken = String(payload.access_token);
    this.sqlite.prepare(`UPDATE spotify_owner SET encrypted_access_token = ?, encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
      access_token_expires_at = ?, status = 'connected', last_error = NULL, updated_at = ? WHERE id = 1`)
      .run(
        this.secrets.encrypt(accessToken),
        payload.refresh_token ? this.secrets.encrypt(String(payload.refresh_token)) : null,
        Date.now() + Number(payload.expires_in) * 1000,
        Date.now(),
      );
    return accessToken;
  }

  private async rawApi(path: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
    const token = await this.accessToken();
    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    if (response.status === 401 && retryAuth) {
      await this.accessToken(true);
      return this.rawApi(path, init, false);
    }
    return response;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.parseResponse<T>(await this.rawApi(path, init));
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    let message = `Spotify request failed (${response.status})`;
    try {
      const payload = await response.json() as { error?: { message?: string } | string };
      message = typeof payload.error === "string" ? payload.error : payload.error?.message ?? message;
    } catch {}
    throw new SpotifyError(response.status, response.status === 429 ? "RATE_LIMITED" : "SPOTIFY_API_ERROR", message, retryAfter || undefined);
  }
}

function normalizeTrack(track: SpotifyTrack): CanonicalTrack {
  return {
    provider: "spotify",
    providerTrackId: track.id,
    playbackUri: track.uri,
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album.name,
    durationMs: track.duration_ms,
    artworkUrl: track.album.images?.sort((a, b) => Math.abs((a.width ?? 300) - 300) - Math.abs((b.width ?? 300) - 300))[0]?.url ?? null,
    externalUrl: track.external_urls.spotify,
    explicit: track.explicit,
  };
}

