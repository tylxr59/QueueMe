import { useEffect, useState, type ReactNode } from "react";
import type { PlaybackSnapshot, QueueItemView, QueueSnapshot } from "@queueme/contracts";

export function Shell({ children, title = "QueueMe", eyebrow }: { children: ReactNode; title?: string; eyebrow?: string }) {
  return <div className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">Q</span><span>{eyebrow && <small>{eyebrow}</small>}{title}</span></a></header>
    <main>{children}</main>
  </div>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <div className="banner error" role="alert">{message}</div> : null;
}

export function NowPlaying({ queue, playback, compact = false, showGuestName = true }: {
  queue: QueueSnapshot;
  playback: PlaybackSnapshot;
  compact?: boolean;
  showGuestName?: boolean;
}) {
  const current = queue.current;
  const [progress, setProgress] = useState(playback.progressMs);
  useEffect(() => {
    setProgress(playback.progressMs);
    if (playback.status !== "playing") return;
    const timer = window.setInterval(() => setProgress(playback.progressMs + Date.now() - playback.observedAt), 500);
    return () => window.clearInterval(timer);
  }, [playback.progressMs, playback.observedAt, playback.status]);
  if (!current) return <section className="now empty"><div className="record-placeholder" aria-hidden="true">♪</div><div><span className="kicker">Nothing playing</span><h2>The queue is open</h2><p>Add the first track to start the party.</p></div></section>;
  const duration = Math.max(0, current.track.durationMs);
  const elapsed = Math.min(duration, Math.max(0, progress));
  const pct = duration > 0 ? elapsed / duration * 100 : 0;
  return <section className={`now ${compact ? "compact" : ""}`}>
    {current.track.artworkUrl ? <img src={current.track.artworkUrl} alt="" /> : <div className="record-placeholder" aria-hidden="true">♪</div>}
    <div className="now-copy"><span className="kicker">{playback.status === "playing" ? "Now playing" : playback.status}</span>
      <h2>{current.track.title}</h2><p>{current.track.artists.join(", ")} · {current.track.album}</p>
      {showGuestName && <small className="queued-by">Queued by {current.guestName}</small>}
      <div className="progress-row"><div className="progress"><span style={{ width: `${pct}%` }} /></div><span className="progress-time">{formatDuration(elapsed)} / {formatDuration(duration)}</span></div>
      {playback.blockReason && <p className="status-note">Needs attention: {humanize(playback.blockReason)}</p>}
    </div>
  </section>;
}

export function QueueList({ queue, actions, showGuestNames = true }: {
  queue: QueueSnapshot;
  actions?: { move(item: QueueItemView, position: number): void; remove(item: QueueItemView): void; unpin(item: QueueItemView): void };
  showGuestNames?: boolean;
}) {
  if (queue.items.length === 0) return <div className="queue-empty">No tracks waiting yet.</div>;
  return <ol className="queue-list">{queue.items.map((item, index) => <li key={item.id}>
    <span className="queue-number">{index + 1}</span>
    {item.track.artworkUrl ? <img src={item.track.artworkUrl} alt="" /> : <span className="thumb-placeholder" aria-hidden="true">♪</span>}
    <div className="track-copy"><strong>{item.track.title}</strong><span>{item.track.artists.join(", ")}</span>{(showGuestNames || item.pinnedPosition !== null) && <small>{showGuestNames && `Added by ${item.guestName}`}{showGuestNames && item.pinnedPosition !== null ? " · " : ""}{item.pinnedPosition !== null && "Pinned"}</small>}</div>
    {actions && <div className="row-actions">
      <button className="icon-button" disabled={index === 0} onClick={() => actions.move(item, index - 1)} aria-label={`Move ${item.track.title} up`}>↑</button>
      <button className="icon-button" disabled={index === queue.items.length - 1} onClick={() => actions.move(item, index + 1)} aria-label={`Move ${item.track.title} down`}>↓</button>
      {item.pinnedPosition !== null && <button className="small-button" onClick={() => actions.unpin(item)}>Unpin</button>}
      <button className="small-button danger" onClick={() => actions.remove(item)}>Remove</button>
    </div>}
  </li>)}</ol>;
}

export const humanize = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
};
