"use client";

import Link from "next/link";
import { useHeartbeat, useNow } from "@/lib/hooks";
import { ago } from "@/lib/format";
import { Pill } from "./ui";

/** Is Blindstop watching right now? Based on the last check recorded on chain. */
export function useWatcherState() {
  const hb = useHeartbeat();
  const now = useNow(1000);
  const t = hb.data ? Number(hb.data.tick_ms) : null;
  const age = t ? now - t : null;
  const state: "live" | "slow" | "offline" | "unknown" =
    age === null ? (hb.error ? "offline" : "unknown") : age < 30_000 ? "live" : age < 120_000 ? "slow" : "offline";
  return { state, lastCheck: t ? ago(t, now) : null, watching: hb.data?.orders_seen ?? null };
}

export function WatcherPill() {
  const w = useWatcherState();
  const tone = w.state === "live" ? "good" : w.state === "slow" ? "warn" : w.state === "offline" ? "bad" : "neutral";
  const text = w.state === "live" ? "Protection on" : w.state === "slow" ? "Running slow" : w.state === "offline" ? "Protection paused" : "Checking…";
  return (
    <Link href="/watcher" className="shrink-0" title={w.lastCheck ? `Last check ${w.lastCheck}` : undefined}>
      <Pill tone={tone} dot>
        {text}
      </Pill>
    </Link>
  );
}
