"use client";

import Link from "next/link";
import { useHeartbeat, useNow } from "@/lib/hooks";
import { ago } from "@/lib/format";
import { Pill } from "./ui";

/** Green under 15s, amber under 60s, red otherwise. Based on the last heartbeat NEAR recorded. */
export function WatcherPill() {
  const hb = useHeartbeat();
  const now = useNow(1000);
  const t = hb.data ? Number(hb.data.tick_ms) : null;
  const age = t ? now - t : null;
  const tone = age === null ? "neutral" : age < 15_000 ? "good" : age < 60_000 ? "warn" : "bad";
  return (
    <Link href="/watcher" className="shrink-0" title="Last heartbeat the enclave signed and NEAR recorded">
      <Pill tone={tone} dot>
        <span className="hidden sm:inline">watcher&nbsp;</span>
        {t ? ago(t, now) : hb.error ? "unreachable" : "…"}
      </Pill>
    </Link>
  );
}
