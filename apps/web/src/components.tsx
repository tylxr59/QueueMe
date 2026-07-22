import { useEffect, useState, type ReactNode } from "react";
import type { PlaybackSnapshot, QueueItemView, QueueSnapshot } from "@queueme/contracts";

export function Shell({ children, title = "QueueMe", eyebrow = "Party jukebox" }: { children: ReactNode; title?: string; eyebrow?: string }) {
  return <div className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">Q</span><span><small>{eyebrow}</small>{title}</span></a></header>
    <main>{children}</main>
  </div>;
}

export function ErrorBanner({ message }: { message: string | null }) {
  return message ? <div className="banner error" role="alert">{message}</div> : null;
}

export function NowPlaying({ queue, playback, compact = false }: { queue: QueueSnapshot; playback: PlaybackSnapshot; compact?: boolean }) {
  const current = queue.current;
  const [progress, setProgress] = useState(playback.progressMs);
  useEffect(() => {
    setProgress(playback.progressMs);
    if (playback.status !== "playing") return;
    const timer = window.setInterval(() => setProgress(playback.progressMs + Date.now() - playback.observedAt), 500);
    return () => window.clearInterval(timer);
  }, [playback.progressMs, playback.observedAt, playback.status]);
  if (!current) return <section className="now empty"><div className="record-placeholder">♪</div><div><span className="kicker">Nothing playing</span><h2>The queue is open</h2><p>Add the first track to start the party.</p></div></section>;
  const pct = Math.min(100, progress / current.track.durationMs * 100);
  return <section className={`now ${compact ? "compact" : ""}`}>
    {current.track.artworkUrl ? <img src={current.track.artworkUrl} alt="" /> : <div className="record-placeholder">♪</div>}
    <div className="now-copy"><span className="kicker">{playback.status === "playing" ? "Now playing" : playback.status}</span>
      <h2>{current.track.title}</h2><p>{current.track.artists.join(", ")} · {current.track.album}</p>
      <div className="progress"><span style={{ width: `${pct}%` }} /></div>
      {playback.blockReason && <p className="status-note">Needs attention: {humanize(playback.blockReason)}</p>}
    </div>
  </section>;
}

export function QueueList({ queue, actions }: {
  queue: QueueSnapshot;
  actions?: { move(item: QueueItemView, position: number): void; remove(item: QueueItemView): void; unpin(item: QueueItemView): void };
}) {
  if (queue.items.length === 0) return <div className="queue-empty">No tracks waiting yet.</div>;
  return <ol className="queue-list">{queue.items.map((item, index) => <li key={item.id}>
    <span className="queue-number">{index + 1}</span>
    {item.track.artworkUrl ? <img src={item.track.artworkUrl} alt="" /> : <span className="thumb-placeholder">♪</span>}
    <div className="track-copy"><strong>{item.track.title}</strong><span>{item.track.artists.join(", ")}</span><small>Added by {item.guestName}{item.pinnedPosition !== null ? " · pinned" : ""}</small></div>
    {actions && <div className="row-actions">
      <button className="icon-button" disabled={index === 0} onClick={() => actions.move(item, index - 1)} aria-label={`Move ${item.track.title} up`}>↑</button>
      <button className="icon-button" disabled={index === queue.items.length - 1} onClick={() => actions.move(item, index + 1)} aria-label={`Move ${item.track.title} down`}>↓</button>
      {item.pinnedPosition !== null && <button className="small-button" onClick={() => actions.unpin(item)}>Unpin</button>}
      <button className="small-button danger" onClick={() => actions.remove(item)}>Remove</button>
    </div>}
  </li>)}</ol>;
}

export const humanize = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

