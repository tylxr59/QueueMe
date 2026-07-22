import { z } from "zod";
import type { CanonicalTrack, PlayerDevice, QueuePolicy } from "@queueme/core";

export const setupClaimSchema = z.object({ code: z.string().min(6).max(32) });
export const setupConfigSchema = z.object({
  jukeboxName: z.string().trim().min(1).max(64),
  adminPin: z.string().regex(/^\d{6,12}$/),
  spotifyClientId: z.string().trim().min(8).max(128),
  spotifyClientSecret: z.string().trim().min(8).max(256),
});
export const adminLoginSchema = z.object({ pin: z.string().regex(/^\d{6,12}$/) });
export const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{6,12}$/),
  newPin: z.string().regex(/^\d{6,12}$/),
});
export const spotifyAppSchema = z.object({
  clientId: z.string().trim().min(8).max(128),
  clientSecret: z.string().trim().min(8).max(256),
});
export const nicknameSchema = z.object({ nickname: z.string().trim().min(1).max(32) });
export const guestViewSettingsSchema = z.object({
  allowNicknameChanges: z.boolean(),
  showGuestNames: z.boolean(),
  showAdminLink: z.boolean(),
});
export const resolveSchema = z.object({ input: z.string().trim().min(1).max(300) });
export const enqueueSchema = z.object({
  resolutionId: z.string().uuid(),
  spotifyTrackId: z.string().min(8).max(64),
  clientRequestId: z.string().uuid(),
});
export const deviceSchema = z.object({ deviceId: z.string().min(1).max(256) });
export const queuePolicySchema = z.object({
  policy: z.enum(["fifo", "round_robin"]),
  expectedRevision: z.number().int().nonnegative(),
  clearPins: z.boolean().optional().default(false),
});
export const pinSchema = z.object({
  position: z.number().int().nonnegative(),
  expectedRevision: z.number().int().nonnegative(),
});
export const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative() });

export type PublicTrack = CanonicalTrack;
export type QueueItemView = {
  id: string;
  track: CanonicalTrack;
  guestName: string;
  status: "queued" | "current";
  position: number | null;
  pinnedPosition: number | null;
  addedAt: number;
};
export type QueueSnapshot = {
  revision: number;
  policy: QueuePolicy;
  current: QueueItemView | null;
  items: QueueItemView[];
};
export type PlaybackStatus = "idle" | "starting" | "playing" | "paused" | "advancing" | "blocked";
export type PlaybackSnapshot = {
  revision: number;
  status: PlaybackStatus;
  blockReason: string | null;
  progressMs: number;
  observedAt: number;
  device: { id: string; name: string } | null;
  error: string | null;
};
export type GuestViewSettings = z.infer<typeof guestViewSettingsSchema>;
export type BootstrapResponse = {
  setupRequired: boolean;
  jukeboxName: string;
  guest: { id: string; nickname: string };
  queue: QueueSnapshot;
  playback: PlaybackSnapshot;
  guestViewSettings: GuestViewSettings;
  admin: boolean;
  serverTime: number;
};
export type ResolutionResponse = {
  resolutionId: string;
  kind: "exact" | "candidates";
  tracks: CanonicalTrack[];
  expiresAt: number;
};
export type AdminBootstrapResponse = BootstrapResponse & {
  spotify: { connected: boolean; accountName: string | null; deviceRequired: boolean };
  devices: PlayerDevice[];
};
export type ServerToClientEvents = {
  "state:snapshot": (snapshot: BootstrapResponse) => void;
  "queue:updated": (snapshot: QueueSnapshot) => void;
  "playback:updated": (snapshot: PlaybackSnapshot) => void;
  "system:notice": (notice: { level: "info" | "warning" | "error"; message: string }) => void;
  "devices:updated": (devices: PlayerDevice[]) => void;
};
