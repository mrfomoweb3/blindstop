"use client";

import Link from "next/link";
import { useState } from "react";
import { REVEAL_DEPOSIT_YOCTO, type OrderView } from "@blindstop/shared";
import { Button, cx, Mono, Notice, Pill } from "@/components/ui";
import { EXPLORER } from "@/lib/config";
import { dateTime, nsToDate, px, short } from "@/lib/format";
import { useMyOrders } from "@/lib/hooks";
import { useLocalOrders } from "@/lib/local-orders";
import { useNear } from "@/lib/near";
import { useTrading } from "@/lib/trading";
import type { LocalOrder } from "@/lib/vault";

const TONE: Record<OrderView["status"], "accent" | "good" | "neutral" | "warn" | "bad"> = {
  Active: "accent",
  Fired: "good",
  Cancelled: "neutral",
  Skipped: "neutral",
  Rejected: "warn",
  Invalid: "bad",
};

const MEANING: Record<OrderView["status"], string> = {
  Active: "sealed, watched every tick",
  Fired: "closed on Hyperliquid",
  Cancelled: "cancelled by you",
  Skipped: "triggered with no position left to close",
  Rejected: "Hyperliquid refused the close on every attempt",
  Invalid: "the enclave could not open it",
};

export default function OrdersPage() {
  const near = useNear();
  const t = useTrading();
  const chain = useMyOrders(near.accountId);
  const local = useLocalOrders(chain.data);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const act = async (id: string, f: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await f();
      setMsg({ tone: "good", text: ok });
      chain.reload();
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!near.accountId) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Notice title="Connect a NEAR account">
          Your orders are listed by the NEAR account that placed them. <Button variant="ghost" onClick={near.connect}>Connect</Button>
        </Notice>
      </div>
    );
  }

  const byCommit = new Map(local.orders.map((l) => [l.commitment, l]));
  const rows = chain.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-muted mt-1">
            Placed by <span className="font-mono">{near.accountId}</span>. Levels appear only where this browser holds the plaintext
            {t.status !== "unlocked" && <> — unlock your trading wallet on <Link className="underline" href="/app">App</Link> to see them</>}.
          </p>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {chain.error && <Notice tone="bad">NEAR RPC: {chain.error}</Notice>}

      <div className="border border-line rounded-[8px] bg-panel overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-muted border-b border-line">
              <th className="font-medium px-4 h-10">#</th>
              <th className="font-medium px-3">Order</th>
              <th className="font-medium px-3">Status</th>
              <th className="font-medium px-3">Set (block time)</th>
              <th className="font-medium px-3">Result</th>
              <th className="font-medium px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  {chain.loading ? "Loading…" : "No orders yet."}
                </td>
              </tr>
            )}
            {rows.map((o) => {
              const l = byCommit.get(o.commitment);
              return (
                <tr key={o.id} className="border-b border-line last:border-0 align-top">
                  <td className="px-4 py-3 font-mono">{o.id}</td>
                  <td className="px-3 py-3">
                    <OrderCell o={o} l={l} />
                  </td>
                  <td className="px-3 py-3">
                    <Pill tone={TONE[o.status]} dot>
                      {o.status}
                    </Pill>
                    <div className="text-xs text-muted mt-1">{MEANING[o.status]}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs tabular">
                    {dateTime(nsToDate(o.created_ns))}
                    <div className="text-muted">block {o.created_height}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs tabular">
                    {o.fire && o.status === "Fired" ? (
                      <>
                        {o.fire.filled_sz} @ {px(o.fire.avg_px)}
                        <div className="text-muted">oid {o.fire.hl_oid}</div>
                      </>
                    ) : o.closed_ns ? (
                      <span className="text-muted">{dateTime(nsToDate(o.closed_ns))}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {o.status === "Active" && (
                        <Button
                          variant="danger"
                          className="h-8 px-3 text-xs"
                          busy={busy === o.id}
                          onClick={() => act(o.id, () => near.call("cancel_order", { order_id: o.id }), `Order ${o.id} cancelled.`)}
                        >
                          Cancel
                        </Button>
                      )}
                      {o.status !== "Active" && !o.revealed && l && (
                        <Button
                          className="h-8 px-3 text-xs"
                          busy={busy === o.id}
                          onClick={() =>
                            act(o.id, () => near.call("reveal", { order_id: o.id, plaintext: l.plaintext }, REVEAL_DEPOSIT_YOCTO), `Order ${o.id} revealed on NEAR.`)
                          }
                        >
                          Reveal
                        </Button>
                      )}
                      <Link href={`/verify?id=${o.id}`} className="inline-flex items-center h-8 px-3 text-xs rounded-[6px] border border-line-strong hover:border-fg/40">
                        Proof
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Revealing publishes the order&rsquo;s plaintext on NEAR so anyone can check, on <Link className="underline" href="/verify">Verify</Link>,
        that the level was committed before the price moved. Only closed orders can be revealed. Contract events:{" "}
        <a className="underline" href={`${EXPLORER}/address/${near.accountId}`} target="_blank" rel="noreferrer">
          {short(near.accountId, 14, 8)}
        </a>
        .
      </p>
    </div>
  );
}

function OrderCell({ o, l }: { o: OrderView; l: LocalOrder | undefined }) {
  const r = o.revealed_order;
  if (l || r) {
    const coin = l?.coin ?? r!.coin;
    const kind = (l?.kind ?? r!.kind) === "stop_loss" ? "SL" : "TP";
    const side = l?.side ?? r!.position_side;
    const level = l?.triggerPx ?? r!.trigger_px;
    const size = l?.size ?? r!.size;
    return (
      <div>
        <div className="font-mono">
          <span className={cx(kind === "SL" ? "text-accent" : "")}>{kind}</span> {coin} {side} @ {px(level)}
        </div>
        <div className="text-xs text-muted">
          {size === "ALL" ? "full position" : `size ${size}`}
          {r && " · revealed"}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-muted">sealed</div>
      <Mono className="text-xs text-faint">{short(o.commitment, 10, 6)}</Mono>
    </div>
  );
}
