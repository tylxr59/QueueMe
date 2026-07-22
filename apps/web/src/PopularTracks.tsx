import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PublicTrack, TopTrack, TopTracksResponse } from "@queueme/contracts";
import { api } from "./api";

const PREVIEW_SIZE = 10;
const PAGE_SIZE = 20;

export function PopularTracks({ revision, onAdd }: { revision: number; onAdd(track: PublicTrack): Promise<void> }) {
  const [preview, setPreview] = useState<TopTracksResponse>({ items: [], nextOffset: null });
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [modalItems, setModalItems] = useState<TopTrack[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreviewLoading(true);
    void api<TopTracksResponse>(`/api/v1/tracks/top?limit=${PREVIEW_SIZE}&offset=0`, { signal: controller.signal })
      .then((page) => {
        setPreview(page);
        setPreviewError(null);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setPreviewError(reason instanceof Error ? reason.message : "Unable to load the most-played songs.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      viewButtonRef.current?.focus();
    };
  }, [close, open]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setModalError(null);
    try {
      const page = await api<TopTracksResponse>(`/api/v1/tracks/top?limit=${PAGE_SIZE}&offset=${nextOffset}`);
      setModalItems((current) => {
        const existing = new Set(current.map((item) => item.track.providerTrackId));
        return [...current, ...page.items.filter((item) => !existing.has(item.track.providerTrackId))];
      });
      setNextOffset(page.nextOffset);
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "Unable to load more songs.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [nextOffset]);

  const showModal = () => {
    setModalItems(preview.items);
    setNextOffset(preview.nextOffset);
    setModalError(null);
    setOpen(true);
  };

  const addTrack = async (track: PublicTrack) => {
    if (addingTrackId) return;
    setAddingTrackId(track.providerTrackId);
    setAddedTrackId(null);
    setActionError(null);
    try {
      await onAdd(track);
      setAddedTrackId(track.providerTrackId);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Unable to add that song to the queue.");
    } finally {
      setAddingTrackId(null);
    }
  };

  const modal = open ? createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="popular-modal" role="dialog" aria-modal="true" aria-labelledby="popular-modal-title">
      <header className="popular-modal-header">
        <div><span className="kicker">All-time favorites</span><h2 id="popular-modal-title">Most-played songs</h2></div>
        <button ref={closeButtonRef} className="modal-close" type="button" aria-label="Close most-played songs" onClick={close}>×</button>
      </header>
      <div className="popular-modal-scroll" onScroll={(event) => {
        const container = event.currentTarget;
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 180) void loadMore();
      }}>
        <PopularTrackList items={modalItems} onAdd={addTrack} addingTrackId={addingTrackId} addedTrackId={addedTrackId} />
        {actionError && <p className="popular-action-error" role="alert">{actionError}</p>}
        {loadingMore && <p className="popular-status" role="status">Loading more songs…</p>}
        {modalError && <div className="load-error"><span>{modalError}</span><button className="small-button" type="button" onClick={() => void loadMore()}>Try again</button></div>}
        {nextOffset === null && modalItems.length > 0 && <p className="popular-list-end">You’ve reached the end.</p>}
      </div>
    </section>
  </div>, document.body) : null;

  return <section className="card popular-card">
    <div className="section-heading">
      <div><span className="kicker">Guest picks</span><h2>Most played</h2></div>
      {preview.items.length > 0 && <button ref={viewButtonRef} className="small-button" type="button" onClick={showModal}>View more</button>}
    </div>
    {previewLoading
      ? <p className="popular-status">Loading favorites…</p>
      : previewError
        ? <p className="popular-status error-copy">{previewError}</p>
        : preview.items.length > 0
          ? <><PopularTrackList items={preview.items} onAdd={addTrack} addingTrackId={addingTrackId} addedTrackId={addedTrackId} />
            {!open && actionError && <p className="popular-action-error" role="alert">{actionError}</p>}</>
          : <p className="popular-status">Played songs will appear here.</p>}

    {modal}
  </section>;
}

export function PopularTrackList({
  items,
  onAdd,
  addingTrackId = null,
  addedTrackId = null,
}: {
  items: TopTrack[];
  onAdd?: (track: PublicTrack) => void;
  addingTrackId?: string | null;
  addedTrackId?: string | null;
}) {
  return <ol className="popular-track-list">
    {items.map((item, index) => <li key={item.track.providerTrackId}>
      <span className="popular-rank">{index + 1}</span>
      {item.track.artworkUrl ? <img src={item.track.artworkUrl} alt="" /> : <span className="popular-art-placeholder">♪</span>}
      <span className="track-copy"><strong>{item.track.title}</strong><span>{item.track.artists.join(", ")}</span><small>{item.track.album}</small></span>
      <span className="play-count"><strong>{item.playCount}</strong>{item.playCount === 1 ? " play" : " plays"}</span>
      {onAdd && <button className={`popular-play${addedTrackId === item.track.providerTrackId ? " added" : ""}`} type="button"
        aria-label={`Add ${item.track.title} to queue`} title="Add to queue" disabled={addingTrackId !== null}
        onClick={() => onAdd(item.track)}><span aria-hidden="true">{addingTrackId === item.track.providerTrackId ? "…" : addedTrackId === item.track.providerTrackId ? "✓" : "▶"}</span></button>}
    </li>)}
  </ol>;
}
