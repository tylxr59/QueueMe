import { useEffect, useState } from "react";
import type { AdminBootstrapResponse, PlaybackSnapshot, QueueItemView, QueueSnapshot } from "@queueme/contracts";
import { ApiError, api, json } from "../api";
import { ErrorBanner, NowPlaying, QueueList, Shell, humanize } from "../components";

export function AdminPage() {
  const [data, setData] = useState<AdminBootstrapResponse | null>(null);
  const [login, setLogin] = useState(true);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = async () => { try { setData(await api<AdminBootstrapResponse>("/api/v1/admin/bootstrap")); setLogin(false); } catch (reason) { if (reason instanceof ApiError && reason.status === 401) setLogin(true); else setError(reason instanceof Error ? reason.message : "Unable to load admin."); } };
  useEffect(() => { void load(); }, []);
  const authenticate = async (event: React.FormEvent) => { event.preventDefault(); try { await api("/api/v1/admin/session", json("POST", { pin })); setPin(""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Login failed."); } };
  if (login) return <Shell eyebrow="Owner area" title="Admin"><section className="setup-card narrow"><span className="kicker">Protected controls</span><h1>Enter admin PIN</h1><form className="stack-form" onSubmit={authenticate}><label>PIN<input autoFocus type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></label><button>Unlock controls</button></form><ErrorBanner message={error} /></section></Shell>;
  if (!data) return <Shell><div className="loading">Loading controls…</div></Shell>;

  const updateQueue = (queue: QueueSnapshot) => setData((current) => current ? { ...current, queue } : current);
  const updatePlayback = (playback: PlaybackSnapshot) => setData((current) => current ? { ...current, playback } : current);
  const command = async (name: "pause" | "resume" | "skip") => { try { updatePlayback(await api(`/api/v1/admin/player/${name}`, json("POST"))); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Playback command failed."); } };
  const queueAction = async (path: string, init: RequestInit) => { try { updateQueue(await api<QueueSnapshot>(path, init)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Queue command failed."); await load(); } };
  const move = (item: QueueItemView, position: number) => void queueAction(`/api/v1/admin/queue/items/${item.id}/position`, json("PUT", { position, expectedRevision: data.queue.revision }));
  const remove = (item: QueueItemView) => void queueAction(`/api/v1/admin/queue/items/${item.id}`, json("DELETE", { expectedRevision: data.queue.revision }));
  const unpin = (item: QueueItemView) => void queueAction(`/api/v1/admin/queue/items/${item.id}/pin`, json("DELETE", { expectedRevision: data.queue.revision }));
  const selectDevice = async (deviceId: string) => { try { await api("/api/v1/admin/device", json("PUT", { deviceId })); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Device selection failed."); } };
  return <Shell eyebrow="Owner area" title={`${data.jukeboxName} Admin`}><div className="admin-layout">
    <section className="admin-main"><NowPlaying queue={data.queue} playback={data.playback} compact />
      <div className="control-bar"><button className="secondary" onClick={() => void command(data.playback.status === "playing" ? "pause" : "resume")}>{data.playback.status === "playing" ? "Pause" : "Resume"}</button><button onClick={() => void command("skip")}>Skip track</button></div>
      <ErrorBanner message={error} />
      {data.playback.blockReason && <div className="banner warning"><strong>{humanize(data.playback.blockReason)}</strong><span>{data.playback.error ?? "Resolve the issue, then press Resume."}</span></div>}
      <section className="card"><div className="section-heading"><div><span className="kicker">Application queue</span><h2>{data.queue.items.length} waiting</h2></div><div className="toolbar"><select value={data.queue.policy} onChange={(e) => void queueAction("/api/v1/admin/queue/policy", json("PUT", { policy: e.target.value, expectedRevision: data.queue.revision, clearPins: false }))}><option value="fifo">FIFO</option><option value="round_robin">Round robin</option></select><button className="small-button" onClick={() => void queueAction("/api/v1/admin/queue/pins", json("DELETE", { expectedRevision: data.queue.revision }))}>Clear pins</button></div></div><QueueList queue={data.queue} actions={{ move, remove, unpin }} /></section>
    </section>
    <aside className="admin-aside"><section className="card"><span className="kicker">Spotify owner</span><h3>{data.spotify.connected ? data.spotify.accountName ?? "Connected" : "Not connected"}</h3>{!data.spotify.connected && <a className="button-link" href="/api/v1/admin/spotify/start">Reconnect Spotify</a>}</section>
      <section className="card"><span className="kicker">Playback device</span><h3>{data.playback.device?.name ?? "No device selected"}</h3>{data.devices.length === 0 && <p className="status-note">No devices returned by Spotify. Select librespot once in the Spotify Connect picker, then refresh here.</p>}<select value={data.playback.device?.id ?? ""} onChange={(e) => void selectDevice(e.target.value)}><option value="" disabled>Select Spotify Connect device</option>{data.devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.type}{device.active ? " · active" : ""}</option>)}</select><button className="secondary full" onClick={() => void load()}>Refresh devices</button></section>
      <a className="admin-link" href="/">← Guest view</a></aside>
  </div></Shell>;
}
