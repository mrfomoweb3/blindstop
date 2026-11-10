"use client";

import { Code, cx, Details, ExternalLink, Mono, Stat } from "@/components/ui";
import { useWatcherState } from "@/components/WatcherPill";
import { CONTRACT, EXPLORER, KEEPER_URL, NEAR_NETWORK, OUTLAYER_API, OUTLAYER_PROJECT } from "@/lib/config";
import { useEnclaveKeys, usePoll } from "@/lib/hooks";
import { views } from "@/lib/near";

interface KeeperHealth {
  ok: boolean;
  last_call_id: string | null;
  last_attestation: string | null;
  outlayer_latency_ms: number | null;
  tick_interval_ms: number;
}

const HEADLINE = {
  live: { title: "Protection is on", text: "Blindstop is watching prices and will close positions the moment a stop is reached.", tone: "text-good", dot: "bg-good" },
  slow: { title: "Running slower than usual", text: "Checks are still happening, just less often than normal. Stops will still trigger, a little later.", tone: "text-warn", dot: "bg-warn" },
  offline: {
    title: "Protection is paused",
    text: "Blindstop hasn't checked prices recently, so stops won't trigger until it's back. If you added a safety net, it still protects you from liquidation.",
    tone: "text-bad",
    dot: "bg-bad",
  },
  unknown: { title: "Checking…", text: "Looking up the latest status.", tone: "text-muted", dot: "bg-faint" },
};

export default function StatusPage() {
  const w = useWatcherState();
  const keys = useEnclaveKeys();
  const active = usePoll<number>("active", () => views.getActiveCount(), 5000);
  const keeper = usePoll<KeeperHealth>(KEEPER_URL ? "keeper" : null, async () => (await fetch(`${KEEPER_URL}/health`)).json(), 5000);
  const h = HEADLINE[w.state];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em] leading-tight">Status</h1>
        <p className="text-sm text-muted mt-1">Is Blindstop protecting stops right now? This page checks for you, live.</p>
      </div>

      <section className={cx("card p-6 sm:p-8 grid gap-6", w.state === "live" && "lime-glow")}>
        <div className="flex items-start gap-4">
          <span className="relative mt-2 flex size-3.5 shrink-0">
            {w.state === "live" && <span className={cx("absolute inset-0 rounded-full pulse", h.dot)} />}
            <span className={cx("relative size-3.5 rounded-full", h.dot)} />
          </span>
          <div>
            <h2 className={cx("text-2xl font-light tracking-tight", h.tone)}>{h.title}</h2>
            <p className="mt-1.5 text-sm text-soft max-w-xl">{h.text}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-5 border-t border-line pt-5">
          <Stat label="Last price check" value={w.lastCheck ?? "—"} />
          <Stat label="Stops being protected" value={active.data ?? "…"} />
          <Stat label="Checks the price every" value={keeper.data ? `${keeper.data.tick_interval_ms / 1000} seconds` : "few seconds"} />
        </div>
      </section>

      <section className="card p-6 sm:p-8 grid gap-3">
        <h2 className="text-lg font-light tracking-tight">Why you can trust this</h2>
        <ul className="grid gap-2 text-[13.5px] text-soft list-disc pl-5">
          <li>The watcher runs inside a sealed computer (a secure enclave) that not even the people running it can look into.</li>
          <li>Every check it makes is signed and recorded on the NEAR blockchain, so the status above can&rsquo;t be faked by this website.</li>
          <li>It can only close positions. It has no way to withdraw or send anyone&rsquo;s money.</li>
        </ul>
      </section>

      <Details>
        <dl className="grid sm:grid-cols-[11rem_1fr] gap-x-4 gap-y-2.5">
          <dt className="text-muted">Contract</dt>
          <dd>
            <ExternalLink href={`${EXPLORER}/address/${CONTRACT}`}>{CONTRACT}</ExternalLink> ({NEAR_NETWORK})
          </dd>
          <dt className="text-muted">OutLayer project</dt>
          <dd><Mono>{OUTLAYER_PROJECT}</Mono></dd>
          <dt className="text-muted">Sealing key (x25519)</dt>
          <dd><Mono>{keys.data?.enclave_x25519 ?? "…"}</Mono></dd>
          <dt className="text-muted">Report key (ed25519)</dt>
          <dd><Mono>{keys.data?.enclave_ed25519 ?? "…"}</Mono></dd>
          <dt className="text-muted">Hyperliquid agent</dt>
          <dd><Mono>{keys.data?.agent_address ?? "…"}</Mono></dd>
          {keeper.data?.last_attestation && (
            <>
              <dt className="text-muted">Latest attestation</dt>
              <dd><ExternalLink href={keeper.data.last_attestation}>{keeper.data.last_call_id}</ExternalLink></dd>
            </>
          )}
          {keeper.data?.outlayer_latency_ms && (
            <>
              <dt className="text-muted">Round trip</dt>
              <dd>{keeper.data.outlayer_latency_ms} ms</dd>
            </>
          )}
        </dl>
        <p>Check the keys yourself, and compare the attested build with the source:</p>
        <Code>{`near contract call-function as-read-only ${CONTRACT} get_enclave_keys json-args {} network-config ${NEAR_NETWORK} now
curl ${OUTLAYER_API}/attestations/by-call/<call_id>`}</Code>
      </Details>
    </div>
  );
}
