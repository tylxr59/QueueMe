import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import type { QueueSnapshot, ResolutionResponse } from "@queueme/contracts";
import { api, json } from "../api";
import { ErrorBanner, NowPlaying, QueueList, Shell } from "../components";
import { useAppState } from "../state";
import { createClientRequestId } from "../uuid";

export function GuestPage() {
  const { state, loading, error: loadError, refresh, setQueue } = useAppState();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<ResolutionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nickname, setNickname] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state) setNickname(state.guest.nickname); }, [state?.guest.nickname]);
  if (loading) return <Shell><div className="loading">Opening the queue…</div></Shell>;
  if (!state) return <Shell><ErrorBanner message={loadError} /><button onClick={() => void refresh()}>Retry</button></Shell>;
  if (state.setupRequired) return <Navigate to="/setup" replace />;

  const resolve = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setResults(null);
    try {
      const resolution = await api<ResolutionResponse>("/api/v1/resolve", json("POST", { input }));
      setResults(resolution);
      if (resolution.kind === "exact" && resolution.tracks[0]) await enqueue(resolution, resolution.tracks[0].providerTrackId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to resolve that track."); }
    finally { setBusy(false); }
  };
  const enqueue = async (resolution: ResolutionResponse, spotifyTrackId: string) => {
    setBusy(true); setError(null);
    try {
      const queue = await api<QueueSnapshot>("/api/v1/queue/items", json("POST", {
        resolutionId: resolution.resolutionId, spotifyTrackId, clientRequestId: createClientRequestId(),
      }));
      setQueue(queue); setInput(""); setResults(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add the track."); }
    finally { setBusy(false); }
  };
  const saveName = async () => {
    try { await api("/api/v1/guest/session", json("PATCH", { nickname })); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save your name."); }
  };
  const clearSearch = () => {
    setInput("");
    setResults(null);
    setError(null);
    searchInputRef.current?.focus();
  };

  return <Shell title={state.jukeboxName}>
    <div className="guest-grid">
      <div className="primary-column">
        <NowPlaying queue={state.queue} playback={state.playback} />
        <section className="card add-card"><span className="kicker">Your turn</span><h1>Add a track</h1>
          <p>Paste a Spotify track link or search by song and artist.</p>
          <form className="search-form" onSubmit={resolve}>
            <div className="search-input-wrap">
              <input ref={searchInputRef} aria-label="Song, artist, or Spotify link" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Dancing Queen ABBA" required maxLength={300} />
              {input && <button className="clear-search" type="button" aria-label="Clear search" onClick={clearSearch} />}
            </div>
            <button disabled={busy}>{busy ? "Working…" : "Find track"}</button>
          </form>
          <ErrorBanner message={error} />
          {results?.kind === "candidates" && <div className="results">{results.tracks.map((track) => <button className="result" key={track.providerTrackId} disabled={busy} onClick={() => void enqueue(results, track.providerTrackId)}>
            {track.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <span className="thumb-placeholder">♪</span>}<span><strong>{track.title}</strong><small>{track.artists.join(", ")} · {track.album}</small></span><b>＋</b>
          </button>)}</div>}
        </section>
      </div>
      <aside><section className="card"><div className="section-heading"><div><span className="kicker">Up next</span><h2>{state.queue.items.length} in queue</h2></div></div><QueueList queue={state.queue} /></section>
        <section className="card identity"><span className="kicker">You are</span><div className="inline-form"><input aria-label="Guest name" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={32} /><button className="secondary" onClick={() => void saveName()}>Save</button></div></section>
        <Link className="admin-link" to="/admin">Admin controls →</Link>
      </aside>
    </div>
  </Shell>;
}
