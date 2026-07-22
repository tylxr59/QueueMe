export type Provider = "spotify";

export type CanonicalTrack = {
  provider: Provider;
  providerTrackId: string;
  playbackUri: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  artworkUrl: string | null;
  externalUrl: string;
  explicit: boolean;
};

export type Resolution = {
  kind: "exact" | "candidates";
  tracks: CanonicalTrack[];
};

export interface SubmissionResolver {
  supports(input: string): boolean;
  resolve(input: string): Promise<Resolution>;
}

export type QueuePolicy = "fifo" | "round_robin";
export type QueueItemStatus = "queued" | "current" | "played" | "skipped" | "removed" | "failed";

export type PendingQueueItem = {
  id: string;
  guestId: string;
  arrivalSequence: number;
  pinnedPosition: number | null;
};

export interface QueueOrderingPolicy {
  readonly id: QueuePolicy;
  order(items: PendingQueueItem[], lastServedGuestId: string | null): string[];
}

export const fifoPolicy: QueueOrderingPolicy = {
  id: "fifo",
  order(items) {
    return [...items].sort((a, b) => a.arrivalSequence - b.arrivalSequence).map((item) => item.id);
  },
};

export const roundRobinPolicy: QueueOrderingPolicy = {
  id: "round_robin",
  order(items, lastServedGuestId) {
    const sorted = [...items].sort((a, b) => a.arrivalSequence - b.arrivalSequence);
    const groups = new Map<string, PendingQueueItem[]>();
    for (const item of sorted) {
      const group = groups.get(item.guestId) ?? [];
      group.push(item);
      groups.set(item.guestId, group);
    }
    const guests = [...groups.keys()];
    if (lastServedGuestId && guests.includes(lastServedGuestId)) {
      const start = (guests.indexOf(lastServedGuestId) + 1) % guests.length;
      guests.push(...guests.splice(0, start));
    }
    const result: string[] = [];
    let remaining = sorted.length;
    while (remaining > 0) {
      for (const guestId of guests) {
        const next = groups.get(guestId)?.shift();
        if (next) {
          result.push(next.id);
          remaining -= 1;
        }
      }
    }
    return result;
  },
};

export function applyPinnedPositions(baseIds: string[], items: PendingQueueItem[]): string[] {
  const pinned = items
    .filter((item) => item.pinnedPosition !== null)
    .sort((a, b) => (a.pinnedPosition ?? 0) - (b.pinnedPosition ?? 0) || a.arrivalSequence - b.arrivalSequence);
  const pinnedIds = new Set(pinned.map((item) => item.id));
  const unpinned = baseIds.filter((id) => !pinnedIds.has(id));
  const result = Array<string | undefined>(items.length);
  for (const item of pinned) {
    let slot = Math.max(0, Math.min(item.pinnedPosition ?? 0, result.length - 1));
    while (result[slot] !== undefined && slot < result.length - 1) slot += 1;
    while (result[slot] !== undefined && slot > 0) slot -= 1;
    result[slot] = item.id;
  }
  let cursor = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (!result[index]) result[index] = unpinned[cursor++];
  }
  return result.filter((id): id is string => Boolean(id));
}

export type PlayerDevice = {
  id: string;
  name: string;
  type: string;
  active: boolean;
  restricted: boolean;
};

export type TransportSnapshot = {
  deviceId: string | null;
  trackUri: string | null;
  isPlaying: boolean;
  progressMs: number;
  observedAt: number;
};

export interface PlayerController {
  listDevices(): Promise<PlayerDevice[]>;
  getPlaybackState(): Promise<TransportSnapshot>;
  transfer(deviceId: string): Promise<void>;
  play(input: { deviceId: string; track: CanonicalTrack; positionMs: number }): Promise<void>;
  pause(deviceId: string): Promise<void>;
}

