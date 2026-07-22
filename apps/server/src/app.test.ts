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
});
