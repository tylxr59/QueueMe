import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { hashToken } from "./modules/security/crypto.js";

describe("HTTP app", () => {
  let directory: string;
  let app: FastifyInstance;
  let sqlite: Database.Database;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "queueme-http-"));
    process.env.QUEUE_ME_DATA_DIR = directory;
    const module = await import("./app.js");
    const built = await module.buildApp();
    app = built.app;
    sqlite = built.services.sqlite;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.QUEUE_ME_DATA_DIR;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reports health and creates an anonymous guest", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", setupRequired: true });

    const bootstrap = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.headers["set-cookie"]).toContain("q_guest=");
    expect(bootstrap.json().guest.nickname).toMatch(/^Guest-/);
    expect(bootstrap.json().guestViewSettings).toEqual({
      allowNicknameChanges: true,
      showGuestNames: true,
      showAdminLink: true,
    });

    const setup = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({
      setupRequired: true,
      setupClaimed: false,
      spotifyConfigured: false,
      spotifyConnected: false,
    });
  });

  it("lets admins configure the guest view and enforces disabled name changes", async () => {
    const guestBootstrap = await app.inject({ method: "GET", url: "/api/v1/bootstrap" });
    const setCookie = guestBootstrap.headers["set-cookie"]!;
    const guestCookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const adminToken = "test-admin-token";
    const now = Date.now();
    sqlite.prepare("INSERT INTO admin_sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(adminToken), now, now, now + 60_000);

    const update = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/guest-view-settings",
      headers: { cookie: `q_admin=${adminToken}` },
      payload: { allowNicknameChanges: false, showGuestNames: false, showAdminLink: false },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ allowNicknameChanges: false, showGuestNames: false, showAdminLink: false });

    const refreshed = await app.inject({ method: "GET", url: "/api/v1/bootstrap", headers: { cookie: guestCookie } });
    expect(refreshed.json().guestViewSettings).toEqual({
      allowNicknameChanges: false,
      showGuestNames: false,
      showAdminLink: false,
    });

    const rename = await app.inject({
      method: "PATCH",
      url: "/api/v1/guest/session",
      headers: { cookie: guestCookie },
      payload: { nickname: "Changed name" },
    });
    expect(rename.statusCode).toBe(403);
    expect(rename.json().error.code).toBe("NICKNAME_CHANGES_DISABLED");
  });

  it("serves played-track rankings in bounded pages", async () => {
    const now = Date.now();
    sqlite.prepare("INSERT INTO guest_sessions (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)")
      .run("history-guest", "Listener", now, now);
    sqlite.prepare(`INSERT INTO tracks (provider, provider_track_id, playback_uri, title, artists_json, album, duration_ms,
      artwork_url, external_url, explicit, metadata_updated_at) VALUES ('spotify', ?, ?, ?, '[\"Artist\"]', 'Album', 180000, NULL, ?, 0, ?)`)
      .run("history-track", "spotify:track:history-track", "History Track", "https://open.spotify.com/track/history-track", now);
    const trackId = (sqlite.prepare("SELECT id FROM tracks WHERE provider_track_id = 'history-track'").get() as { id: number }).id;
    const insertPlay = sqlite.prepare(`INSERT INTO queue_items (public_id, track_id, guest_session_id, source_type, status,
      client_request_id, added_at, started_at, finished_at) VALUES (?, ?, 'history-guest', 'spotify_search', 'played', ?, ?, ?, ?)`);
    insertPlay.run(crypto.randomUUID(), trackId, crypto.randomUUID(), now, now, now);
    insertPlay.run(crypto.randomUUID(), trackId, crypto.randomUUID(), now, now, now + 1);

    const response = await app.inject({ method: "GET", url: "/api/v1/tracks/top?limit=10&offset=0" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("q_guest=");
    expect(response.json()).toMatchObject({
      items: [{ track: { title: "History Track" }, playCount: 2 }],
      nextOffset: null,
    });
  });
});
