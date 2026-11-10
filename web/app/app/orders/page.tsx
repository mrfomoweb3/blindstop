"use client";

import Link from "next/link";
import { useState } from "react";
import { REVEAL_DEPOSIT_YOCTO, type OrderView } from "@blindstop/shared";
import { Button, cx, Notice, Pill } from "@/components/ui";
import { friendly } from "@/lib/errors";
import { nsToDate, px } from "@/lib/format";
import { useMyOrders } from "@/lib/hooks";
import { useLocalOrders } from "@/lib/local-orders";
import { useNear } from "@/lib/near";
import { useTrading } from "@/lib/trading";
import type { LocalOrder } from "@/lib/vault";

const STATUS: Record<OrderView["status"], { label: string; tone: "accent" | "good" | "neutral" | "warn" | "bad"; meaning: string }> = {
  Active: { label: "Protecting", tone: "accent", meaning: "Hidden and being watched right now." },
  Fired: { label: "Triggered", tone: "good", meaning: "The price reached your level and your trade was closed." },
  Cancelled: { label: "Cancelled", tone: "neutral", meaning: "You cancelled this stop." },
  Skipped: { label: "Nothing to close", tone: "neutral", meaning: "The price was reached, but the trade was already closed." },
  Rejected: { label: "Couldn't close", tone: "warn", meaning: "Hyperliquid wouldn't fill the close at your price limit, even after 5 tries." },
  Invalid: { label: "Couldn't be read", tone: "bad", meaning: "Blindstop couldn't open this stop, so it was switched off." },
};

function when(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function HistoryPage() {
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
      setMsg({ tone: "bad", text: friendly(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!near.accountId) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 grid gap-4">
        <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em]">History</h1>
        <div className="card p-6 grid gap-3 justify-items-start">
          <p className="text-sm text-soft">Sign in to see your hidden stops and what happened to them.</p>
          <Button variant="primary" onClick={near.connect}>Sign in</Button>
        </div>
      </div>
    );
  }

  const byCommit = new Map(local.orders.map((l) => [l.commitment, l]));
  const rows = chain.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 grid grid-cols-1 gap-5">
      <div>
        <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em] leading-tight">History</h1>
        <p className="text-sm text-muted mt-1">
          Every stop you&rsquo;ve set, and what happened to it.
          {t.status !== "unlocked" && (
            <>
              {" "}
              <Link className="underline underline-offset-2" href="/app">Unlock your wallet</Link> to see the prices.
            </>
          )}
        </p>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {chain.error && <Notice tone="bad">We couldn&rsquo;t load your history right now. Try again in a moment.</Notice>}

      {rows.length === 0 && !chain.loading && (
        <div className="card p-8 text-center text-sm text-muted">
          No stops yet. <Link href="/app" className="underline underline-offset-2">Set your first hidden stop</Link>.
        </div>
      )}
      {chain.loading && <div className="card p-8 text-center text-sm text-muted">Loading…</div>}

      <ul className="grid gap-3">
        {rows.map((o) => {
          const l = byCommit.get(o.commitment);
          const st = STATUS[o.status];
          return (
            <li key={o.id} className="card p-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0 grid gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Title o={o} l={l} />
                  <Pill tone={st.tone} dot>
                    {st.label}
                  </Pill>
                </div>
                <p className="text-[13px] text-muted">{st.meaning}</p>
                <p className="text-xs text-faint">
                  Set {when(nsToDate(o.created_ns))}
                  {o.status === "Fired" && o.fire && ` · closed ${o.fire.filled_sz} at $${px(o.fire.avg_px)}`}
                  {o.status !== "Fired" && o.closed_ns && ` · ended ${when(nsToDate(o.closed_ns))}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {o.status === "Active" && (
                  <Button
                    variant="danger"
                    className="h-9"
                    busy={busy === o.id}
                    onClick={() => act(o.id, () => near.call("cancel_order", { order_id: o.id }), "Stop cancelled.")}
                  >
                    Cancel stop
                  </Button>
                )}
                {o.status !== "Active" && !o.revealed && l && (
                  <Button
                    className="h-9"
                    busy={busy === o.id}
                    title="Publish this stop's price so anyone can check it was set before the market moved"
                    onClick={() =>
                      act(o.id, () => near.call("reveal", { order_id: o.id, plaintext: l.plaintext }, REVEAL_DEPOSIT_YOCTO), "Proof published. Anyone can now check this stop.")
                    }
                  >
                    Publish proof
                  </Button>
                )}
                {o.status !== "Active" && (
                  <Link href={`/verify?id=${o.id}`} className="inline-flex items-center h-9 px-4 text-[13px] rounded-full border border-line-strong hover:border-accent/50">
                    View proof
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        &ldquo;Publish proof&rdquo; makes a finished stop&rsquo;s price public, so anyone can check it was set before the market moved. Stops
        that are still protecting you stay private.
      </p>
    </div>
  );
}

function Title({ o, l }: { o: OrderView; l: LocalOrder | undefined }) {
  const r = o.revealed_order;
  if (!l && !r) return <span className="text-[15px] font-medium">Hidden stop #{o.id}</span>;
  const coin = l?.coin ?? r!.coin;
  const isSl = (l?.kind ?? r!.kind) === "stop_loss";
  const level = l?.triggerPx ?? r!.trigger_px;
  return (
    <span className="text-[15px] font-medium">
      <span className={cx(isSl && "text-accent-text")}>{isSl ? "Stop-loss" : "Take-profit"}</span> · {coin} at ${px(level)}
    </span>
  );
}
