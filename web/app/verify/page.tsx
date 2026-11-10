"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { base64ToBytes, bytesToHex, commitmentOf, decodeOrder, hexToBytes, type OrderView, type SealedOrder } from "@blindstop/shared";
import { Button, cx, Input, Label, Mono, Notice, Panel, Pill } from "@/components/ui";
import { CONTRACT } from "@/lib/config";
import { dateTime, nsToDate, px } from "@/lib/format";
import { views } from "@/lib/near";
import { useTrading } from "@/lib/trading";
import * as vault from "@/lib/vault";

function parsePreimage(s: string): Uint8Array {
  const t = s.trim();
  if (/^(0x)?[0-9a-fA-F]+$/.test(t)) return hexToBytes(t);
  return base64ToBytes(t);
}

interface Result {
  order: OrderView;
  preimage: Uint8Array;
  recomputed: string;
  match: boolean;
  decoded: SealedOrder | null;
  source: "revealed on NEAR" | "this browser" | "pasted";
}

function VerifyInner() {
  const params = useSearchParams();
  const t = useTrading();
  const [id, setId] = useState(params.get("id") ?? "");
  const [paste, setPaste] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (tamper = false) => {
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      const order = await views.getOrder(id.trim());
      if (!order) throw new Error(`order ${id} does not exist on ${CONTRACT}`);
      let preimage: Uint8Array | null = null;
      let source: Result["source"] = "pasted";
      if (paste.trim()) preimage = parsePreimage(paste);
      else if (order.revealed) {
        preimage = base64ToBytes(order.revealed);
        source = "revealed on NEAR";
      } else if (t.vaultKey) {
        const mine = (await vault.listOrders(t.vaultKey, CONTRACT)).find((l) => l.commitment === order.commitment);
        if (mine) {
          preimage = base64ToBytes(mine.plaintext);
          source = "this browser";
        }
      }
      if (!preimage) throw new Error("this order is not revealed; paste its preimage (hex or base64) or unlock the wallet that sealed it");
      if (tamper) {
        preimage = preimage.slice();
        const i = Math.min(preimage.length - 1, 30);
        preimage[i] = preimage[i]! ^ 0x01;
      }
      const recomputed = bytesToHex(commitmentOf(preimage));
      let decoded: SealedOrder | null = null;
      try {
        decoded = decodeOrder(preimage);
      } catch {
        decoded = null;
      }
      setRes({ order, preimage, recomputed, match: recomputed === order.commitment, decoded, source });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get("id")) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placed = res ? nsToDate(res.order.created_ns) : null;
  const firedMs = res?.order.fire ? Number(res.order.fire.ts_ms) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em] leading-tight">Verify a sealed order</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          NEAR stored a commitment, <Mono>sha256(&quot;blindstop:v1:order&quot; ‖ order)</Mono>, the moment the order was placed. Hash the
          preimage here, in your browser, and compare. A match proves the level existed, exactly, before the price moved.
        </p>
      </div>
      <Panel>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <div className="grid sm:grid-cols-[10rem_1fr] gap-3">
            <label>
              <Label>Order id</Label>
              <Input mono inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label>
              <Label hint="optional if revealed">Preimage (hex or base64 borsh)</Label>
              <Input mono value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="loaded from NEAR or this browser when empty" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" type="submit" busy={busy} disabled={!id}>Verify</Button>
            <Button type="button" disabled={!id || busy} onClick={() => void check(true)} title="Flip one byte of the preimage and check again">
              Tamper one byte
            </Button>
          </div>
        </form>
      </Panel>
      {err && <Notice tone="bad">{err}</Notice>}
      {res && (
        <Panel
          title={`Order ${res.order.id}`}
          aside={<Pill tone={res.match ? "good" : "bad"} dot>{res.match ? "commitment matches" : "does not match"}</Pill>}
        >
          <div className="grid gap-4 text-sm">
            <dl className="grid sm:grid-cols-[11rem_1fr] gap-x-4 gap-y-2 font-mono text-[12.5px]">
              <dt className="text-muted">on NEAR</dt>
              <dd className="break-all">{res.order.commitment}</dd>
              <dt className="text-muted">recomputed</dt>
              <dd className={cx("break-all", res.match ? "text-good" : "text-bad")}>{res.recomputed}</dd>
              <dt className="text-muted">preimage from</dt>
              <dd>{res.source}</dd>
              <dt className="text-muted">placed</dt>
              <dd>
                {dateTime(placed)} · block {res.order.created_height}
              </dd>
              {firedMs && (
                <>
                  <dt className="text-muted">fired</dt>
                  <dd>
                    {dateTime(new Date(firedMs))}
                    {placed && <span className="text-muted"> · {formatGap(firedMs - placed.getTime())} after it was committed</span>}
                  </dd>
                </>
              )}
              <dt className="text-muted">status</dt>
              <dd>{res.order.status}</dd>
            </dl>
            {res.match && res.decoded && (
              <div className="border-t border-line pt-4 grid sm:grid-cols-4 gap-3 font-mono text-[13px]">
                <KV k="market" v={`${res.decoded.coin} (${res.decoded.network})`} />
                <KV k="protects" v={`${res.decoded.side} position`} />
                <KV k="kind" v={res.decoded.kind === "stop_loss" ? "stop-loss" : "take-profit"} />
                <KV k="level" v={px(res.decoded.triggerPx)} />
                <KV k="size" v={res.decoded.size === "ALL" ? "full position" : res.decoded.size} />
                <KV k="slippage" v={`${res.decoded.slippageBps} bps`} />
                <KV k="wallet" v={`${res.decoded.hlAddress.slice(0, 10)}…`} />
                {res.order.fire && res.order.status === "Fired" && <KV k="filled" v={`${res.order.fire.filled_sz} @ ${px(res.order.fire.avg_px)}`} />}
              </div>
            )}
            {!res.match && (
              <Notice tone="bad">
                This preimage is not what was committed. Either it was altered or it belongs to another order. A level cannot be changed after
                it is placed.
              </Notice>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted font-sans">{k}</div>
      <div className="truncate">{v}</div>
    </div>
  );
}

function formatGap(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
