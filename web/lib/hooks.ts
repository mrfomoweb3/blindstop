"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchClearinghouse,
  fetchExtraAgents,
  fetchOpenOrders,
  fetchPerps,
  type ClearinghouseState,
  type EnclaveKeys,
  type ExtraAgent,
  type HeartbeatView,
  type OpenOrder,
  type OrderView,
  type PerpAsset,
} from "@blindstop/shared";
import { HL_NETWORK } from "./config";
import { views } from "./near";

export interface Polled<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  at: number | null;
  reload: () => void;
}

/** Polls `f` every `ms` while the tab is visible. `key` null pauses it. */
export function usePoll<T>(key: string | null, f: () => Promise<T>, ms: number): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const fn = useRef(f);
  fn.current = f;

  useEffect(() => {
    if (key === null) {
      setData(undefined);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const v = await fn.current();
          if (!alive) return;
          setData(v);
          setError(null);
          setAt(Date.now());
        } catch (e) {
          if (alive) setError((e as Error).message ?? String(e));
        }
      }
      if (alive) timer = setTimeout(run, ms);
    };
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, ms, nonce]);

  return { data, error, loading: data === undefined && error === null && key !== null, at, reload: () => setNonce((n) => n + 1) };
}

export const usePerps = () => usePoll<Map<string, PerpAsset>>(`perps:${HL_NETWORK}`, () => fetchPerps(HL_NETWORK), 3000);
export const useClearinghouse = (addr: string | null) =>
  usePoll<ClearinghouseState>(addr && `ch:${addr}`, () => fetchClearinghouse(HL_NETWORK, addr!), 5000);
export const useOpenOrders = (addr: string | null) =>
  usePoll<OpenOrder[]>(addr && `oo:${addr}`, () => fetchOpenOrders(HL_NETWORK, addr!), 5000);
export const useExtraAgents = (addr: string | null) =>
  usePoll<ExtraAgent[]>(addr && `ag:${addr}`, () => fetchExtraAgents(HL_NETWORK, addr!), 10_000);
export const useEnclaveKeys = () => usePoll<EnclaveKeys>("keys", () => views.getEnclaveKeys(), 60_000);
export const useHeartbeat = () => usePoll<HeartbeatView | null>("hb", () => views.getHeartbeat(), 4000);
export const useMyOrders = (owner: string | null) =>
  usePoll<OrderView[]>(owner && `orders:${owner}`, () => views.getOrdersByOwner(owner!, 0, 100), 4000);

/** Re-render every `ms` (for "3s ago" labels). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
