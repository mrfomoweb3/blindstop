"use client";

import { Code, ExternalLink, Mono, Notice, Panel, Pill, Stat } from "@/components/ui";
import { CONTRACT, EXPLORER, KEEPER_URL, NEAR_NETWORK, OUTLAYER_API, OUTLAYER_PROJECT } from "@/lib/config";
import { ago } from "@/lib/format";
import { useEnclaveKeys, useHeartbeat, useNow, usePoll } from "@/lib/hooks";
import { views } from "@/lib/near";

interface KeeperHealth {
  ok: boolean;
  last_ok_tick_at: number | null;
  last_error: string | null;
  last_call_id: string | null;
  last_attestation: string | null;
  outlayer_latency_ms: number | null;
  enclave_compute_ms: number | null;
  tick_interval_ms: number;
  block_height: number | null;
}

export default function WatcherPage() {
  const keys = useEnclaveKeys();
  const hb = useHeartbeat();
  const active = usePoll<number>("active", () => views.getActiveCount(), 5000);
  const keeper = usePoll<KeeperHealth>(KEEPER_URL ? "keeper" : null, async () => {
    const r = await fetch(`${KEEPER_URL}/health`);
    return (await r.json()) as KeeperHealth;
  }, 5000);
  const now = useNow(1000);
  const t = hb.data ? Number(hb.data.tick_ms) : null;
  const age = t ? now - t : null;
  const tone = age === null ? "neutral" : age < 15_000 ? "good" : age < 60_000 ? "warn" : "bad";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">The watcher</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          An OutLayer project running in an Intel TDX enclave. It signs every report with a key the contract pins; this page reads
          everything from NEAR and the keeper, so you can check it without trusting this site.
        </p>
      </div>

      <div className="grid sm:grid-cols-4 gap-4 border border-line rounded-[8px] bg-panel p-4 sm:p-5">
        <Stat label="Last heartbeat" value={<Pill tone={tone} dot>{t ? ago(t, now) : hb.error ? "unreachable" : "none yet"}</Pill>} sub="signed by the enclave, recorded on NEAR" />
        <Stat label="Active sealed orders" value={active.data ?? "…"} />
        <Stat label="Orders seen at last heartbeat" value={hb.data?.orders_seen ?? "—"} />
        <Stat label="Key epoch" value={keys.data?.key_epoch ?? "…"} sub="bumps on every key rotation" />
      </div>

      <Panel title="Keys pinned in the contract" aside={<ExternalLink href={`${EXPLORER}/address/${CONTRACT}`}>{CONTRACT}</ExternalLink>}>
        <dl className="grid sm:grid-cols-[13rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted">Sealing key (x25519)</dt>
          <dd><Mono>{keys.data?.enclave_x25519 ?? "…"}</Mono><div className="text-xs text-muted">your browser encrypts stops to this</div></dd>
          <dt className="text-muted">Report key (ed25519)</dt>
          <dd><Mono>{keys.data?.enclave_ed25519 ?? "…"}</Mono><div className="text-xs text-muted">record_fire and heartbeat must verify against it</div></dd>
          <dt className="text-muted">Hyperliquid agent</dt>
          <dd><Mono>{keys.data?.agent_address ?? "…"}</Mono><div className="text-xs text-muted">secp256k1 key held by the TEE host; one agent for all users</div></dd>
          <dt className="text-muted">OutLayer project</dt>
          <dd><Mono>{OUTLAYER_PROJECT}</Mono></dd>
        </dl>
      </Panel>

      {KEEPER_URL && (
        <Panel title="Keeper" aside={keeper.data ? <Pill tone={keeper.data.ok ? "good" : "bad"} dot>{keeper.data.ok ? "healthy" : "unhealthy"}</Pill> : null}>
          {keeper.error ? (
            <Notice tone="bad">The keeper is unreachable: {keeper.error}. Stops do not fire while no keeper runs; anyone can start one (see the README).</Notice>
          ) : (
            <div className="grid sm:grid-cols-4 gap-4">
              <Stat label="Tick interval" value={keeper.data ? `${keeper.data.tick_interval_ms / 1000}s` : "…"} />
              <Stat label="Round trip" value={keeper.data?.outlayer_latency_ms ? `${keeper.data.outlayer_latency_ms} ms` : "—"} />
              <Stat label="TEE compute" value={keeper.data?.enclave_compute_ms ? `${keeper.data.enclave_compute_ms} ms` : "—"} />
              <Stat label="NEAR block read" value={keeper.data?.block_height ?? "—"} />
              {keeper.data?.last_attestation && (
                <div className="sm:col-span-4 text-sm">
                  Attestation of the last run: <ExternalLink href={keeper.data.last_attestation}>{keeper.data.last_call_id}</ExternalLink>
                </div>
              )}
              {keeper.data?.last_error && <div className="sm:col-span-4"><Notice tone="warn">Last error: {keeper.data.last_error}</Notice></div>}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Check it yourself">
        <div className="grid gap-3 text-sm">
          <p className="text-fg/75">The keys above are what the contract trusts. Ask the contract directly:</p>
          <Code>{`near contract call-function as-read-only ${CONTRACT} get_enclave_keys json-args {} network-config ${NEAR_NETWORK} now`}</Code>
          <p className="text-fg/75">
            Every enclave run has a TDX attestation that names the exact wasm sha256 it ran. Fetch one by call id (the keeper exposes the
            last one) and compare the hash with the release build:
          </p>
          <Code>{`curl ${OUTLAYER_API}/attestations/by-call/<call_id>
cd enclave/room && BLINDSTOP_CONTRACT=${CONTRACT} cargo build --release --target wasm32-wasip2
shasum -a 256 target/wasm32-wasip2/release/blindstop-room.wasm`}</Code>
          <p className="text-fg/75">
            The enclave answers <Mono>{`{"op":"pubkeys"}`}</Mono> with the same three keys on every run (see <Mono>docs/spikes.md</Mono>, S3).
          </p>
        </div>
      </Panel>
    </div>
  );
}
