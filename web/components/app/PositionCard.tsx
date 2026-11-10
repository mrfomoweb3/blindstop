"use client";

import { useMemo, useState } from "react";
import { normalizeDecimalInput, parseDec, parseSignedDec, type EnclaveKeys, type OpenOrder, type OrderView, type PerpAsset, type Position } from "@blindstop/shared";
import { HL_NETWORK } from "@/lib/config";
import { absSize, distancePct, px, usd } from "@/lib/format";
import { useNear } from "@/lib/near";
import { backstopFor, placePublicBackstop, sealAndPlace, type Draft } from "@/lib/orders";
import { useTrading } from "@/lib/trading";
import type { LocalOrder } from "@/lib/vault";
import { cx, Input, Label, Notice, Pill, SealButton } from "../ui";

export function PositionCard({
  position,
  asset,
  keys,
  locals,
  chain,
  openOrders,
  backstopOn,
  onPlaced,
}: {
  position: Position;
  asset: PerpAsset | undefined;
  keys: EnclaveKeys | undefined;
  locals: LocalOrder[];
  chain: OrderView[];
  openOrders: OpenOrder[];
  backstopOn: boolean;
  onPlaced: () => void;
}) {
  const isLong = parseSignedDec(position.szi) > 0n;
  const mark = asset?.markPx ?? null;
  const pnl = Number(position.unrealizedPnl);
  const status = (l: LocalOrder) => chain.find((c) => c.commitment === l.commitment)?.status ?? (l.orderId ? "…" : "pending");
  const mine = locals.filter((l) => l.coin === position.coin && l.network === HL_NETWORK && (l.side === "long") === isLong);
  const active = mine.filter((l) => status(l) === "Active" || status(l) === "pending");
  const publicTriggers = openOrders.filter((o) => o.coin === position.coin && o.isTrigger);

  return (
    <article className="card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-3 border-b border-line">
        <h3 className="font-semibold tracking-tight">{position.coin}-PERP</h3>
        <Pill tone={isLong ? "good" : "bad"}>
          {isLong ? "LONG" : "SHORT"} {absSize(position.szi)}
        </Pill>
        <span className="text-xs text-muted">{position.leverage.value}× {position.leverage.type}</span>
        <span className={cx("ml-auto font-mono tabular text-sm", pnl >= 0 ? "text-good" : "text-bad")}>
          {pnl >= 0 ? "+" : ""}
          {usd(position.unrealizedPnl)}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-3 px-4 sm:px-5 py-3 border-b border-line text-sm">
        <Field k="Mark" v={px(mark)} />
        <Field k="Entry" v={px(position.entryPx)} />
        <Field k="Liquidation" v={px(position.liquidationPx)} warn />
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-line">
        <div className="flex items-center justify-between text-xs text-muted mb-2">
          <span>Sealed levels (decrypted from this browser only)</span>
          <span>
            Public orders on Hyperliquid&rsquo;s book: <span className={cx("font-mono", publicTriggers.length ? "text-warn" : "text-good")}>{publicTriggers.length}</span>
          </span>
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No sealed stop yet.</p>
        ) : (
          <ul className="grid gap-1.5">
            {active.map((l) => (
              <li key={l.commitment} className="flex items-center gap-3 font-mono text-[13px] tabular">
                <span className={cx("w-8 text-xs", l.kind === "stop_loss" ? "text-accent-text" : "text-soft")}>{l.kind === "stop_loss" ? "SL" : "TP"}</span>
                <span className="w-28">{px(l.triggerPx)}</span>
                <span className="w-20 text-muted">{distancePct(mark, l.triggerPx)}</span>
                <span className="text-muted text-xs truncate">{l.size === "ALL" ? "full position" : l.size}</span>
                <span className="ml-auto">
                  <Pill tone={status(l) === "Active" ? "accent" : "neutral"} dot>
                    {status(l) === "Active" ? "sealed" : status(l)}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SealForm position={position} asset={asset} keys={keys} isLong={isLong} backstopOn={backstopOn && publicTriggers.length === 0} onPlaced={onPlaced} />
    </article>
  );
}

function Field({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{k}</div>
      <div className={cx("font-mono tabular truncate", warn && "text-warn")}>{v}</div>
    </div>
  );
}

function SealForm({
  position,
  asset,
  keys,
  isLong,
  backstopOn,
  onPlaced,
}: {
  position: Position;
  asset: PerpAsset | undefined;
  keys: EnclaveKeys | undefined;
  isLong: boolean;
  backstopOn: boolean;
  onPlaced: () => void;
}) {
  const near = useNear();
  const t = useTrading();
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [size, setSize] = useState("");
  const [slip, setSlip] = useState("100");
  const [confirm, setConfirm] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const checks = useMemo(() => {
    const notes: { tone: "warn" | "bad"; text: string }[] = [];
    const parse = (s: string) => {
      try {
        return s.trim() ? parseDec(normalizeDecimalInput(s)) : null;
      } catch {
        return undefined;
      }
    };
    const slV = parse(sl);
    const tpV = parse(tp);
    const mark = asset?.markPx ? parseDec(asset.markPx) : null;
    const liq = position.liquidationPx ? parseDec(position.liquidationPx) : null;
    if (slV === undefined) notes.push({ tone: "bad", text: "Stop-loss is not a number." });
    if (tpV === undefined) notes.push({ tone: "bad", text: "Take-profit is not a number." });
    if (slV && liq && (isLong ? slV <= liq : slV >= liq))
      notes.push({ tone: "bad", text: "The stop-loss is beyond your liquidation price: you would be liquidated before it fires." });
    if (slV && mark && (isLong ? mark <= slV : mark >= slV)) notes.push({ tone: "warn", text: "Mark is already past this stop-loss: it fires on the next tick." });
    if (tpV && mark && (isLong ? mark >= tpV : mark <= tpV)) notes.push({ tone: "warn", text: "Mark is already past this take-profit: it fires on the next tick." });
    if (slV && tpV && (isLong ? slV >= tpV : slV <= tpV)) notes.push({ tone: "bad", text: "The stop-loss must sit on the losing side of the take-profit." });
    return { notes, slV, tpV, blocked: notes.some((n) => n.tone === "bad") };
  }, [sl, tp, asset?.markPx, position.liquidationPx, isLong]);

  const submit = async () => {
    setErr(null);
    setDone(null);
    if (!t.account || !t.vaultKey || !near.accountId || !keys) return;
    try {
      const sizeStr = size.trim() ? normalizeDecimalInput(size) : "ALL";
      const slipBps = Number(slip);
      const confirmTicks = Number(confirm);
      const base = { coin: position.coin, side: (isLong ? "long" : "short") as Draft["side"], size: sizeStr, slippageBps: slipBps, confirmTicks };
      const drafts: Draft[] = [];
      if (sl.trim()) drafts.push({ ...base, kind: "stop_loss", triggerPx: normalizeDecimalInput(sl) });
      if (tp.trim()) drafts.push({ ...base, kind: "take_profit", triggerPx: normalizeDecimalInput(tp) });
      if (!drafts.length) throw new Error("enter a stop-loss, a take-profit, or both");
      setBusy(true);
      const res = await sealAndPlace({ drafts, account: t.account, vaultKey: t.vaultKey, owner: near.accountId, network: HL_NETWORK, keys, callBatch: near.callBatch });
      let msg = `Sealed ${drafts.length === 2 ? "both levels" : drafts[0]!.kind === "stop_loss" ? "your stop-loss" : "your take-profit"}.`;
      if (backstopOn && asset) {
        const b = backstopFor(position, asset);
        if (b) {
          await placePublicBackstop(t.account, HL_NETWORK, b);
          msg += ` Public backstop placed at ${px(b.triggerPx)}.`;
        }
      }
      setDone(res.txHash ? `${msg} Tx ${res.txHash.slice(0, 10)}…` : msg);
      setSl("");
      setTp("");
      onPlaced();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="px-4 sm:px-5 py-4 grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label>
          <Label hint={sl && asset?.markPx ? distancePct(asset.markPx, safe(sl)) : undefined}>Stop-loss</Label>
          <Input mono inputMode="decimal" placeholder={isLong ? "below mark" : "above mark"} value={sl} onChange={(e) => setSl(e.target.value)} />
        </label>
        <label>
          <Label hint={tp && asset?.markPx ? distancePct(asset.markPx, safe(tp)) : undefined}>Take-profit</Label>
          <Input mono inputMode="decimal" placeholder={isLong ? "above mark" : "below mark"} value={tp} onChange={(e) => setTp(e.target.value)} />
        </label>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Size, slippage, confirmation</summary>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <label>
            <Label>Size</Label>
            <Input mono inputMode="decimal" placeholder="all" value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          <label>
            <Label>Slippage bps</Label>
            <Input mono inputMode="numeric" value={slip} onChange={(e) => setSlip(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label>
            <Label>Confirm ticks</Label>
            <Input mono inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        <p className="mt-2 text-muted leading-relaxed">
          The close is a reduce-only IOC at mark ± slippage. With confirm ticks above 1, the level must stay crossed for that many
          consecutive checks (about 3 s each) before it fires, which filters one-tick wicks at the cost of speed.
        </p>
      </details>
      {checks.notes.map((n) => (
        <Notice key={n.text} tone={n.tone}>
          {n.text}
        </Notice>
      ))}
      {err && <Notice tone="bad">{err}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SealButton type="submit" busy={busy} disabled={!keys || checks.blocked || (!sl.trim() && !tp.trim())}>
          Seal to the enclave
        </SealButton>
        <span className="text-xs text-muted">
          Nothing is sent to Hyperliquid. {backstopOn ? "A wide public backstop is added near liquidation." : ""}
        </span>
      </div>
    </form>
  );
}

function safe(s: string): string {
  try {
    return normalizeDecimalInput(s);
  } catch {
    return "0";
  }
}

