import type Database from "better-sqlite3";
import type { PlaybackSnapshot, QueueSnapshot } from "@queueme/contracts";
import type { SpotifyGateway } from "../spotify/gateway.js";
import { SpotifyError } from "../spotify/gateway.js";
import type { QueueStore } from "../queue/store.js";

type Emitter = {
  queue(snapshot: QueueSnapshot): void;
  playback(snapshot: PlaybackSnapshot): void;
};

export class PlayerCoordinator {
  private command = Promise.resolve();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly queue: QueueStore,
    private readonly spotify: SpotifyGateway,
    private readonly emit: Emitter,
  ) {
    const current = queue.current();
    if (current) this.writeState("paused", "restart_recovery", undefined, false);
    else this.writeState("idle", null, undefined, false);
    this.schedulePoll();
  }

  snapshot(): PlaybackSnapshot {
    const row = this.sqlite.prepare(`SELECT p.*, a.selected_device_id, a.selected_device_name
      FROM player_checkpoint p CROSS JOIN app_settings a WHERE p.id = 1`).get() as {
      status: PlaybackSnapshot["status"];
      block_reason: string | null;
      progress_ms: number;
      revision: number;
      observed_at: number;
      last_error: string | null;
      selected_device_id: string | null;
      selected_device_name: string | null;
    };
    return {
      revision: row.revision,
      status: row.status,
      blockReason: row.block_reason,
      progressMs: row.progress_ms,
      observedAt: row.observed_at,
      device: row.selected_device_id && row.selected_device_name ? { id: row.selected_device_id, name: row.selected_device_name } : null,
      error: row.last_error,
    };
  }

  onQueueChanged() {
    return this.serial(async () => {
      const state = this.snapshot();
      if (!this.queue.current() && this.queue.snapshot().items.length > 0 && (state.status === "idle" || state.blockReason === "device_required")) {
        await this.startCurrent(0);
      }
    });
  }

  pause() {
    return this.serial(async () => {
      const device = this.device();
      if (device.id && this.snapshot().status === "playing") await this.spotify.pause(device.id);
      this.writeState(this.queue.current() ? "paused" : "idle", null);
    });
  }

  resume() {
    return this.serial(async () => {
      const current = this.queue.current();
      await this.startCurrent(current ? this.snapshot().progressMs : 0);
    });
  }

  skip() {
    return this.serial(async () => {
      const wasPlaying = this.snapshot().status === "playing";
      if (this.queue.current()) this.queue.completeCurrent("skipped", "admin_skip");
      this.emit.queue(this.queue.snapshot());
      if (wasPlaying) await this.startCurrent(0);
      else {
        const next = this.queue.promoteNext();
        if (next) {
          this.emit.queue(this.queue.snapshot());
          this.writeState("paused", null, 0);
        } else {
          await this.pauseDeviceIfPossible();
          this.writeState("idle", null, 0);
        }
      }
    });
  }

  afterCurrentRemoved(wasPlaying: boolean) {
    return this.serial(async () => {
      if (wasPlaying) await this.startCurrent(0);
      else if (this.queue.snapshot().items.length > 0) {
        this.queue.promoteNext();
        this.emit.queue(this.queue.snapshot());
        this.writeState("paused", null, 0);
      } else {
        await this.pauseDeviceIfPossible();
        this.writeState("idle", null, 0);
      }
    });
  }

  selectedDeviceChanged() {
    return this.serial(async () => {
      if (this.snapshot().status === "playing") await this.pauseDeviceIfPossible();
      this.writeState(this.queue.current() ? "paused" : "idle", this.queue.current() ? "device_changed" : null);
    });
  }

  close() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private async startCurrent(positionMs: number) {
    let current = this.queue.current();
    if (!current) {
      current = this.queue.promoteNext();
      if (current) this.emit.queue(this.queue.snapshot());
    }
    if (!current) {
      await this.pauseDeviceIfPossible();
      this.writeState("idle", null, 0);
      return;
    }
    if (!this.spotify.isConnected()) {
      this.writeState("blocked", "auth_required", positionMs, true, "Connect the Spotify owner account.");
      return;
    }
    try {
      const device = await this.resolveDevice();
      if (!device) {
        this.writeState("blocked", "device_required", positionMs, true, "Select an available Spotify Connect device.");
        return;
      }
      this.writeState("starting", null, positionMs);
      if (!device.active) {
        await this.spotify.transfer(device.id);
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      await this.spotify.play({ deviceId: device.id, track: current.track, positionMs });
      this.writeState("playing", null, positionMs);
    } catch (error) {
      this.blockFromError(error, positionMs);
    }
  }

  private async poll() {
    if (this.snapshot().status !== "playing") return;
    const current = this.queue.current();
    if (!current) return;
    try {
      const remote = await this.spotify.getPlaybackState();
      const selected = this.device().id;
      if (remote.deviceId && selected && remote.deviceId !== selected) {
        this.writeState("blocked", "external_playback", undefined, true, "Playback moved to another Spotify device.");
        return;
      }
      if (remote.trackUri && remote.trackUri !== current.track.playbackUri) {
        const nearEnd = this.snapshot().progressMs >= current.track.durationMs - 3_000;
        if (nearEnd) await this.advancePlayed();
        else this.writeState("blocked", "external_playback", undefined, true, "Spotify is playing a track outside the QueueMe queue.");
        return;
      }
      if (!remote.isPlaying) {
        this.writeState("paused", null, remote.progressMs);
        return;
      }
      if (remote.progressMs >= current.track.durationMs - 900) {
        await this.advancePlayed();
        return;
      }
      this.writeState("playing", null, remote.progressMs);
    } catch (error) {
      this.blockFromError(error, this.snapshot().progressMs);
    }
  }

  private async advancePlayed() {
    this.writeState("advancing", null);
    this.queue.completeCurrent("played");
    this.emit.queue(this.queue.snapshot());
    await this.startCurrent(0);
  }

  private async resolveDevice() {
    const selected = this.device();
    if (!selected.id) return null;
    const devices = await this.spotify.listDevices();
    const direct = devices.find((device) => device.id === selected.id);
    if (direct) return direct;
    const matches = devices.filter((device) => device.name === selected.name && device.type === selected.type);
    if (matches.length !== 1) return null;
    const rebound = matches[0]!;
    this.sqlite.prepare("UPDATE app_settings SET selected_device_id = ?, updated_at = ? WHERE id = 1").run(rebound.id, Date.now());
    return rebound;
  }

  private device() {
    return this.sqlite.prepare("SELECT selected_device_id AS id, selected_device_name AS name, selected_device_type AS type FROM app_settings WHERE id = 1")
      .get() as { id: string | null; name: string | null; type: string | null };
  }

  private async pauseDeviceIfPossible() {
    const device = this.device();
    if (!device.id || !this.spotify.isConnected()) return;
    try { await this.spotify.pause(device.id); } catch {}
  }

  private blockFromError(error: unknown, progressMs: number) {
    if (error instanceof SpotifyError) {
      const reason = error.code === "AUTH_REQUIRED" ? "auth_required" : error.code === "RATE_LIMITED" ? "rate_limited" : "command_failed";
      this.writeState("blocked", reason, progressMs, true, error.message);
    } else {
      this.writeState("blocked", "command_failed", progressMs, true, error instanceof Error ? error.message : "Playback command failed.");
    }
  }

  private writeState(
    status: PlaybackSnapshot["status"],
    blockReason: string | null,
    progressMs?: number,
    emit = true,
    error: string | null = null,
  ) {
    const now = Date.now();
    this.sqlite.prepare(`UPDATE player_checkpoint SET status = ?, block_reason = ?, progress_ms = COALESCE(?, progress_ms),
      revision = revision + 1, observed_at = ?, last_error = ?, updated_at = ? WHERE id = 1`)
      .run(status, blockReason, progressMs ?? null, now, error, now);
    if (emit) this.emit.playback(this.snapshot());
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.command.then(work, work);
    this.command = next.then(() => undefined, () => undefined);
    return next;
  }

  private schedulePoll() {
    const run = async () => {
      await this.serial(() => this.poll()).catch(() => undefined);
      this.pollTimer = setTimeout(run, this.snapshot().status === "playing" ? 2_000 : 10_000);
      this.pollTimer.unref();
    };
    this.pollTimer = setTimeout(run, 2_000);
    this.pollTimer.unref();
  }
}
