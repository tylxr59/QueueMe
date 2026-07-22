import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

describe("HTTP app", () => {
  let directory: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "queueme-http-"));
    process.env.QUEUE_ME_DATA_DIR = directory;
    const module = await import("./app.js");
    app = (await module.buildApp()).app;
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

    const setup = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({
      setupRequired: true,
      setupClaimed: false,
      spotifyConfigured: false,
      spotifyConnected: false,
    });
  });
});
