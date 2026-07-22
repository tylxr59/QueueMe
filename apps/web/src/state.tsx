import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import type { BootstrapResponse, PlaybackSnapshot, QueueSnapshot } from "@queueme/contracts";
import { api } from "./api";

type AppState = {
  state: BootstrapResponse | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  setQueue(queue: QueueSnapshot): void;
  setPlayback(playback: PlaybackSnapshot): void;
};

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setState(await api<BootstrapResponse>("/api/v1/bootstrap"));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load QueueMe.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!state) return;
    const socket = io({ transports: ["websocket", "polling"] });
    socket.on("state:snapshot", setState);
    socket.on("queue:updated", (queue) => setState((current) => current ? { ...current, queue } : current));
    socket.on("playback:updated", (playback) => setState((current) => current ? { ...current, playback } : current));
    socket.on("connect", () => { if (!socket.recovered) void refresh(); });
    return () => { socket.close(); };
  }, [Boolean(state)]);

  const value = useMemo<AppState>(() => ({
    state,
    loading,
    error,
    refresh,
    setQueue: (queue) => setState((current) => current ? { ...current, queue } : current),
    setPlayback: (playback) => setState((current) => current ? { ...current, playback } : current),
  }), [state, loading, error]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAppState() {
  const context = useContext(Context);
  if (!context) throw new Error("AppStateProvider is missing");
  return context;
}

