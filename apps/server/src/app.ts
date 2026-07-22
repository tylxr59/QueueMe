import { randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Server as SocketServer } from "socket.io";
import type Database from "better-sqlite3";
import {
  adminLoginSchema,
  changePinSchema,
  deviceSchema,
  enqueueSchema,
  nicknameSchema,
  pinSchema,
  queuePolicySchema,
  resolveSchema,
  revisionSchema,
  setupClaimSchema,
  setupConfigSchema,
  spotifyAppSchema,
  type AdminBootstrapResponse,
  type BootstrapResponse,
  type ServerToClientEvents,
} from "@queueme/contracts";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { SecretBox, hashPin, hashToken, opaqueToken, verifyPin } from "./modules/security/crypto.js";
import { SpotifyGateway } from "./modules/spotify/gateway.js";
import { ResolverService } from "./modules/resolver/service.js";
import { QueueStore } from "./modules/queue/store.js";
import { PlayerCoordinator } from "./modules/player/coordinator.js";

const GUEST_COOKIE = "q_guest";
const ADMIN_COOKIE = "q_admin";
const SETUP_COOKIE = "q_setup";
const guestCookieAge = 30 * 24 * 60 * 60;
const adminCookieAge = 12 * 60 * 60;
const setupCookieAge = 2 * 60 * 60;

type ExpiringValue = { expiresAt: number; flow?: "setup" | "admin" };

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "body.adminPin", "body.spotifyClientSecret"],
    },
    genReqId: () => randomUUID(),
  });
  await app.register(cookie);
  const { sqlite } = createDatabase(config);
  const secretBox = SecretBox.open(config.dataDir);
  const spotify = new SpotifyGateway(sqlite, secretBox, config);
  const resolver = new ResolverService(spotify);
  const queue = new QueueStore(sqlite);
  const io = new SocketServer<Record<string, never>, ServerToClientEvents>(app.server, {
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false },
  });
  const player = new PlayerCoordinator(sqlite, queue, spotify, {
    queue: (snapshot) => io.emit("queue:updated", snapshot),
    playback: (snapshot) => io.emit("playback:updated", snapshot),
  });

  const setupCode = String(randomInt(100_000, 1_000_000));
  const setupClaims = new Map<string, ExpiringValue>();
  const oauthStates = new Map<string, ExpiringValue>();
  const rateBuckets = new Map<string, { count: number; resetsAt: number }>();
  if (isSetupRequired(sqlite)) app.log.warn(`QueueMe setup code: ${setupCode}`);

  app.addHook("preHandler", async (request, reply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return;
    const allowed = new Set([
      `http://127.0.0.1:${config.port}`,
      `http://localhost:${config.port}`,
      config.webDevUrl,
    ].filter((value): value is string => Boolean(value)));
    const hostOrigin = `http://${request.headers.host}`;
    if (origin !== hostOrigin && !allowed.has(origin)) {
      return reply.code(403).send(apiError("INVALID_ORIGIN", "Request origin is not allowed.", request.id));
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const candidate = error as Error & { statusCode?: number; code?: string };
    const status = candidate.statusCode && candidate.statusCode >= 400 ? candidate.statusCode : 500;
    if (status >= 500) request.log.error(error);
    reply.code(status).send(apiError(candidate.code ?? "INTERNAL_ERROR", status >= 500 ? "The request could not be completed." : candidate.message, request.id));
  });

  app.get("/health", async () => ({ status: "ok", setupRequired: isSetupRequired(sqlite), time: Date.now() }));

  app.get("/api/v1/setup/status", async (request) => ({
    setupRequired: isSetupRequired(sqlite),
    setupClaimed: hasSetupClaim(request, setupClaims),
    spotifyConfigured: Boolean(sqlite.prepare("SELECT id FROM spotify_owner WHERE id = 1").get()),
    redirectUri: config.redirectUri,
    spotifyConnected: spotify.isConnected(),
  }));

  app.post("/api/v1/setup/claim", async (request, reply) => {
    if (!isSetupRequired(sqlite)) throw httpError(409, "SETUP_COMPLETE", "QueueMe is already configured.");
    const { code } = setupClaimSchema.parse(request.body);
    if (code !== setupCode) throw httpError(401, "INVALID_SETUP_CODE", "The setup code is invalid.");
    const token = opaqueToken();
    setupClaims.set(hashToken(token), { expiresAt: Date.now() + setupCookieAge * 1000 });
    setCookie(reply, SETUP_COOKIE, token, setupCookieAge, config.secureCookies);
    return { claimed: true };
  });

  app.put("/api/v1/setup/config", async (request) => {
    requireSetup(request, setupClaims);
    const input = setupConfigSchema.parse(request.body);
    const pin = await hashPin(input.adminPin);
    const now = Date.now();
    sqlite.transaction(() => {
      sqlite.prepare(`UPDATE app_settings SET jukebox_name = ?, admin_pin_salt = ?, admin_pin_hash = ?, updated_at = ? WHERE id = 1`)
        .run(input.jukeboxName, pin.salt, pin.hash, now);
      sqlite.prepare(`INSERT INTO spotify_owner (id, client_id, encrypted_client_secret, status, updated_at)
        VALUES (1, ?, ?, 'disconnected', ?) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,
        encrypted_client_secret=excluded.encrypted_client_secret, encrypted_access_token=NULL, encrypted_refresh_token=NULL,
        status='disconnected', updated_at=excluded.updated_at`)
        .run(input.spotifyClientId, secretBox.encrypt(input.spotifyClientSecret), now);
    })();
    return { saved: true, redirectUri: config.redirectUri };
  });

  app.get("/api/v1/setup/spotify/start", async (request, reply) => {
    requireSetup(request, setupClaims);
    const state = opaqueToken();
    oauthStates.set(state, { expiresAt: Date.now() + 10 * 60_000, flow: "setup" });
    return reply.redirect(spotify.getAuthorizeUrl(state));
  });

  app.get("/api/v1/admin/spotify/start", async (request, reply) => {
    requireAdmin(request, sqlite);
    const state = opaqueToken();
    oauthStates.set(state, { expiresAt: Date.now() + 10 * 60_000, flow: "admin" });
    return reply.redirect(spotify.getAuthorizeUrl(state));
  });

  app.get("/api/v1/oauth/spotify/callback", async (request, reply) => {
    const query = request.query as { state?: string; code?: string; error?: string };
    const entry = query.state ? oauthStates.get(query.state) : undefined;
    if (!entry || entry.expiresAt < Date.now()) throw httpError(400, "INVALID_OAUTH_STATE", "The Spotify authorization request expired.");
    oauthStates.delete(query.state!);
    if (query.error || !query.code) throw httpError(400, "SPOTIFY_AUTH_DENIED", "Spotify authorization was not completed.");
    await spotify.exchangeCode(query.code);
    const base = config.webDevUrl ?? "";
    return reply.redirect(`${base}/${entry.flow === "setup" ? "setup" : "admin"}?spotify=connected`);
  });

  app.get("/api/v1/setup/devices", async (request) => {
    requireSetup(request, setupClaims);
    return { devices: await spotify.listDevices() };
  });

  app.put("/api/v1/setup/device", async (request) => {
    requireSetup(request, setupClaims);
    const { deviceId } = deviceSchema.parse(request.body);
    await saveDevice(sqlite, spotify, deviceId);
    return { selected: true };
  });

  app.post("/api/v1/setup/complete", async (request, reply) => {
    requireSetup(request, setupClaims);
    if (!spotify.isConnected()) throw httpError(409, "SPOTIFY_REQUIRED", "Connect the Spotify owner account before completing setup.");
    sqlite.prepare("UPDATE app_settings SET setup_complete = 1, updated_at = ? WHERE id = 1").run(Date.now());
    reply.clearCookie(SETUP_COOKIE, { path: "/", secure: config.secureCookies });
    return { complete: true };
  });

  app.get("/api/v1/bootstrap", async (request, reply) => {
    const guest = ensureGuest(request, reply, sqlite, config.secureCookies);
    return bootstrap(sqlite, queue, player, guest, isAdmin(request, sqlite));
  });

  app.patch("/api/v1/guest/session", async (request, reply) => {
    const guest = ensureGuest(request, reply, sqlite, config.secureCookies);
    const { nickname } = nicknameSchema.parse(request.body);
    sqlite.prepare("UPDATE guest_sessions SET display_name = ?, last_seen_at = ? WHERE id = ?").run(nickname, Date.now(), guest.id);
    return { id: guest.id, nickname };
  });

  app.post("/api/v1/resolve", async (request, reply) => {
    const guest = ensureGuest(request, reply, sqlite, config.secureCookies);
    enforceRate(rateBuckets, `resolve:${guest.id}`, 30, 60_000);
    requireConfigured(sqlite);
    const { input } = resolveSchema.parse(request.body);
    return resolver.resolve(input, guest.id);
  });

  app.post("/api/v1/queue/items", async (request, reply) => {
    const guest = ensureGuest(request, reply, sqlite, config.secureCookies);
    enforceRate(rateBuckets, `enqueue:${guest.id}`, 10, 60_000);
    requireConfigured(sqlite);
    const input = enqueueSchema.parse(request.body);
    const resolved = resolver.consume(input.resolutionId, input.spotifyTrackId, guest.id);
    const snapshot = queue.enqueue({ ...resolved, guestId: guest.id, clientRequestId: input.clientRequestId });
    io.emit("queue:updated", snapshot);
    void player.onQueueChanged();
    return reply.code(201).send(snapshot);
  });

  app.post("/api/v1/admin/session", async (request, reply) => {
    enforceRate(rateBuckets, `admin-login:${request.ip}`, 5, 15 * 60_000);
    const { pin } = adminLoginSchema.parse(request.body);
    const settings = sqlite.prepare("SELECT admin_pin_salt, admin_pin_hash FROM app_settings WHERE id = 1").get() as {
      admin_pin_salt: string | null;
      admin_pin_hash: string | null;
    };
    if (!settings.admin_pin_salt || !settings.admin_pin_hash || !await verifyPin(pin, settings.admin_pin_salt, settings.admin_pin_hash)) {
      throw httpError(401, "INVALID_PIN", "The admin PIN is invalid.");
    }
    const token = opaqueToken();
    const now = Date.now();
    sqlite.prepare("INSERT INTO admin_sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), now, now, now + adminCookieAge * 1000);
    setCookie(reply, ADMIN_COOKIE, token, adminCookieAge, config.secureCookies);
    return { authenticated: true };
  });

  app.delete("/api/v1/admin/session", async (request, reply) => {
    const token = request.cookies[ADMIN_COOKIE];
    if (token) sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
    reply.clearCookie(ADMIN_COOKIE, { path: "/", secure: config.secureCookies });
    return { authenticated: false };
  });

  app.get("/api/v1/admin/bootstrap", async (request, reply): Promise<AdminBootstrapResponse> => {
    requireAdmin(request, sqlite);
    const guest = ensureGuest(request, reply, sqlite, config.secureCookies);
    const base = bootstrap(sqlite, queue, player, guest, true);
    const owner = sqlite.prepare("SELECT account_name FROM spotify_owner WHERE id = 1").get() as { account_name: string | null } | undefined;
    return {
      ...base,
      spotify: { connected: spotify.isConnected(), accountName: owner?.account_name ?? null, deviceRequired: !player.snapshot().device },
      devices: spotify.isConnected() ? await spotify.listDevices() : [],
    };
  });

  app.get("/api/v1/admin/devices", async (request) => {
    requireAdmin(request, sqlite);
    const devices = await spotify.listDevices();
    io.to("admin").emit("devices:updated", devices);
    return { devices };
  });

  app.put("/api/v1/admin/device", async (request) => {
    requireAdmin(request, sqlite);
    const { deviceId } = deviceSchema.parse(request.body);
    if (player.snapshot().status === "playing") await player.pause();
    await saveDevice(sqlite, spotify, deviceId);
    await player.selectedDeviceChanged();
    return { selected: true, playback: player.snapshot() };
  });

  app.put("/api/v1/admin/security/pin", async (request) => {
    requireAdmin(request, sqlite);
    const input = changePinSchema.parse(request.body);
    const settings = sqlite.prepare("SELECT admin_pin_salt, admin_pin_hash FROM app_settings WHERE id = 1").get() as {
      admin_pin_salt: string | null;
      admin_pin_hash: string | null;
    };
    if (!settings.admin_pin_salt || !settings.admin_pin_hash || !await verifyPin(input.currentPin, settings.admin_pin_salt, settings.admin_pin_hash)) {
      throw httpError(401, "INVALID_PIN", "The current admin PIN is invalid.");
    }
    const next = await hashPin(input.newPin);
    sqlite.prepare("UPDATE app_settings SET admin_pin_salt = ?, admin_pin_hash = ?, updated_at = ? WHERE id = 1")
      .run(next.salt, next.hash, Date.now());
    return { changed: true };
  });

  app.put("/api/v1/admin/spotify/app", async (request) => {
    requireAdmin(request, sqlite);
    const input = spotifyAppSchema.parse(request.body);
    await player.pause();
    sqlite.transaction(() => {
      sqlite.prepare(`UPDATE spotify_owner SET client_id = ?, encrypted_client_secret = ?, account_id = NULL, account_name = NULL,
        encrypted_access_token = NULL, encrypted_refresh_token = NULL, access_token_expires_at = NULL, refresh_token_issued_at = NULL,
        scopes = NULL, status = 'disconnected', last_error = NULL, updated_at = ? WHERE id = 1`)
        .run(input.clientId, secretBox.encrypt(input.clientSecret), Date.now());
      sqlite.prepare(`UPDATE app_settings SET selected_device_id = NULL, selected_device_name = NULL,
        selected_device_type = NULL, updated_at = ? WHERE id = 1`).run(Date.now());
    })();
    return { saved: true, reconnectRequired: true };
  });

  app.put("/api/v1/admin/queue/policy", async (request) => {
    requireAdmin(request, sqlite);
    const input = queuePolicySchema.parse(request.body);
    const snapshot = queue.setPolicy(input.policy, input.expectedRevision, input.clearPins);
    io.emit("queue:updated", snapshot);
    return snapshot;
  });

  app.put("/api/v1/admin/queue/items/:id/position", async (request) => {
    requireAdmin(request, sqlite);
    const input = pinSchema.parse(request.body);
    const snapshot = queue.pin((request.params as { id: string }).id, input.position, input.expectedRevision);
    io.emit("queue:updated", snapshot);
    return snapshot;
  });

  app.delete("/api/v1/admin/queue/items/:id/pin", async (request) => {
    requireAdmin(request, sqlite);
    const { expectedRevision } = revisionSchema.parse(request.body);
    const snapshot = queue.unpin((request.params as { id: string }).id, expectedRevision);
    io.emit("queue:updated", snapshot);
    return snapshot;
  });

  app.delete("/api/v1/admin/queue/pins", async (request) => {
    requireAdmin(request, sqlite);
    const { expectedRevision } = revisionSchema.parse(request.body);
    const snapshot = queue.clearPins(expectedRevision);
    io.emit("queue:updated", snapshot);
    return snapshot;
  });

  app.delete("/api/v1/admin/queue/items/:id", async (request) => {
    requireAdmin(request, sqlite);
    const { expectedRevision } = revisionSchema.parse(request.body);
    const wasPlaying = player.snapshot().status === "playing";
    const result = queue.remove((request.params as { id: string }).id, expectedRevision);
    io.emit("queue:updated", result.snapshot);
    if (result.wasCurrent) await player.afterCurrentRemoved(wasPlaying);
    return result.snapshot;
  });

  app.post("/api/v1/admin/player/pause", async (request) => {
    requireAdmin(request, sqlite);
    await player.pause();
    return player.snapshot();
  });
  app.post("/api/v1/admin/player/resume", async (request) => {
    requireAdmin(request, sqlite);
    await player.resume();
    return player.snapshot();
  });
  app.post("/api/v1/admin/player/skip", async (request) => {
    requireAdmin(request, sqlite);
    await player.skip();
    return player.snapshot();
  });

  io.on("connection", (socket) => {
    const cookies = parseCookies(socket.handshake.headers.cookie ?? "");
    const guest = cookies[GUEST_COOKIE] ? findGuest(sqlite, cookies[GUEST_COOKIE]!) : null;
    const admin = cookies[ADMIN_COOKIE] ? isAdminToken(sqlite, cookies[ADMIN_COOKIE]!) : false;
    if (admin) socket.join("admin");
    if (guest) socket.emit("state:snapshot", bootstrap(sqlite, queue, player, guest, admin));
  });

  const webDist = path.resolve(process.cwd(), "../web/dist");
  if (config.isProduction && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url === "/health") return reply.code(404).send(apiError("NOT_FOUND", "Route not found.", request.id));
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    player.close();
    io.close();
    sqlite.close();
  });

  return { app, config, services: { sqlite, spotify, resolver, queue, player } };
}

function bootstrap(
  sqlite: Database.Database,
  queue: QueueStore,
  player: PlayerCoordinator,
  guest: { id: string; nickname: string },
  admin: boolean,
): BootstrapResponse {
  const settings = sqlite.prepare("SELECT setup_complete, jukebox_name FROM app_settings WHERE id = 1").get() as {
    setup_complete: number;
    jukebox_name: string;
  };
  return {
    setupRequired: !settings.setup_complete,
    jukeboxName: settings.jukebox_name,
    guest,
    queue: queue.snapshot(),
    playback: player.snapshot(),
    admin,
    serverTime: Date.now(),
  };
}

function ensureGuest(request: FastifyRequest, reply: FastifyReply, sqlite: Database.Database, secure: boolean) {
  const existingId = request.cookies[GUEST_COOKIE];
  const existing = existingId ? findGuest(sqlite, existingId) : null;
  if (existing) {
    sqlite.prepare("UPDATE guest_sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), existing.id);
    return existing;
  }
  const id = randomUUID();
  const nickname = `Guest-${id.slice(0, 4).toUpperCase()}`;
  const now = Date.now();
  sqlite.prepare("INSERT INTO guest_sessions (id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run(id, nickname, now, now);
  setCookie(reply, GUEST_COOKIE, id, guestCookieAge, secure);
  return { id, nickname };
}

function findGuest(sqlite: Database.Database, id: string) {
  const row = sqlite.prepare("SELECT id, display_name FROM guest_sessions WHERE id = ?").get(id) as { id: string; display_name: string } | undefined;
  return row ? { id: row.id, nickname: row.display_name } : null;
}

function requireSetup(request: FastifyRequest, claims: Map<string, ExpiringValue>) {
  if (!hasSetupClaim(request, claims)) throw httpError(401, "SETUP_CLAIM_REQUIRED", "Enter the setup code again.");
}

function hasSetupClaim(request: FastifyRequest, claims: Map<string, ExpiringValue>) {
  const token = request.cookies[SETUP_COOKIE];
  if (!token) return false;
  const tokenHash = hashToken(token);
  const claim = claims.get(tokenHash);
  if (!claim || claim.expiresAt < Date.now()) {
    claims.delete(tokenHash);
    return false;
  }
  return true;
}

function requireAdmin(request: FastifyRequest, sqlite: Database.Database) {
  const token = request.cookies[ADMIN_COOKIE];
  if (!token || !isAdminToken(sqlite, token)) throw httpError(401, "ADMIN_REQUIRED", "Admin login is required.");
}

function isAdmin(request: FastifyRequest, sqlite: Database.Database) {
  const token = request.cookies[ADMIN_COOKIE];
  return Boolean(token && isAdminToken(sqlite, token));
}

function isAdminToken(sqlite: Database.Database, token: string) {
  const now = Date.now();
  const result = sqlite.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ? AND expires_at > ?").run(now, hashToken(token), now);
  return result.changes === 1;
}

function isSetupRequired(sqlite: Database.Database) {
  const row = sqlite.prepare("SELECT setup_complete FROM app_settings WHERE id = 1").get() as { setup_complete: number };
  return !row.setup_complete;
}

function requireConfigured(sqlite: Database.Database) {
  if (isSetupRequired(sqlite)) throw httpError(409, "SETUP_REQUIRED", "Complete QueueMe setup first.");
}

async function saveDevice(sqlite: Database.Database, spotify: SpotifyGateway, deviceId: string) {
  const device = (await spotify.listDevices()).find((candidate) => candidate.id === deviceId);
  if (!device) throw httpError(404, "DEVICE_UNAVAILABLE", "The Spotify Connect device is unavailable.");
  sqlite.prepare(`UPDATE app_settings SET selected_device_id = ?, selected_device_name = ?, selected_device_type = ?, updated_at = ? WHERE id = 1`)
    .run(device.id, device.name, device.type, Date.now());
}

function setCookie(reply: FastifyReply, name: string, value: string, maxAge: number, secure: boolean) {
  reply.setCookie(name, value, { path: "/", httpOnly: true, sameSite: "strict", secure, maxAge });
}

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function apiError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

function parseCookies(header: string) {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter((pair) => pair.length === 2).map(([key, value]) => [key!, decodeURIComponent(value!)]));
}

function enforceRate(buckets: Map<string, { count: number; resetsAt: number }>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw httpError(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
}
