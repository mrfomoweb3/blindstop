"use client";

import { friendly } from "@/lib/errors";
import { useMemo, useState } from "react";
import { formatDec, marketOrderAction, mulRatio, normalizeDecimalInput, parseDec, parseSignedDec, readFill, roundPerpPx, sendL1, type EnclaveKeys, type OpenOrder, type OrderView, type PerpAsset, type Position } from "@blindstop/shared";
import { HL_NETWORK } from "@/lib/config";
import { absSize, distancePct, px, usd } from "@/lib/format";
import { useNear } from "@/lib/near";
import { backstopFor, placePublicBackstop, sealAndPlace, type Draft } from "@/lib/orders";
import { useTrading } from "@/lib/trading";
import type { LocalOrder } from "@/lib/vault";
import { Button, cx, Input, Label, Notice, Pill, SealButton } from "../ui";

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
        <CloseButton position={position} asset={asset} isLong={isLong} onDone={onPlaced} />
      </header>

      <div className="grid grid-cols-3 gap-3 px-4 sm:px-5 py-3 border-b border-line text-sm">
        <Field k="Price now" v={px(mark)} />
        <Field k="Entry" v={px(position.entryPx)} />
        <Field k="Liquidation" v={px(position.liquidationPx)} warn />
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-line">
        <div className="flex items-center justify-between text-xs text-muted mb-2">
          <span>Your hidden orders · only you can see these</span>
          <span>
            Visible to others: <span className={cx("font-mono", publicTriggers.length ? "text-warn" : "text-good")}>{publicTriggers.length}</span>
          </span>
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-muted">No hidden stop yet. Set one below.</p>
        ) : (
          <ul className="grid gap-1.5">
            {active.map((l) => (
              <li key={l.commitment} className="flex items-center gap-3 font-mono text-[13px] tabular">
                <span className={cx("w-[78px] text-xs font-sans", l.kind === "stop_loss" ? "text-accent-text" : "text-soft")}>{l.kind === "stop_loss" ? "Stop-loss" : "Take-profit"}</span>
                <span className="w-28">{px(l.triggerPx)}</span>
                <span className="w-20 text-muted">{distancePct(mark, l.triggerPx)}</span>
                <span className="text-muted text-xs truncate">{l.size === "ALL" ? "full position" : l.size}</span>
                <span className="ml-auto">
                  <Pill tone={status(l) === "Active" ? "accent" : "neutral"} dot>
                    {status(l) === "Active" ? "Hidden" : "Saving…"}
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

function CloseButton({ position, asset, isLong, onDone }: { position: Position; asset: PerpAsset | undefined; isLong: boolean; onDone: () => void }) {
  const t = useTrading();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = async () => {
    if (!t.account || !asset?.markPx) return;
    if (!window.confirm(`Close your whole ${position.coin} position now, at the market price?`)) return;
    setErr(null);
    setBusy(true);
    try {
      const mark = parseDec(asset.markPx);
      const isBuy = !isLong;
      const limit = roundPerpPx(mulRatio(mark, isBuy ? 10_200n : 9_800n, 10_000n, isBuy ? "up" : "down"), asset.szDecimals, isBuy ? "up" : "down");
      const answer = await sendL1(
        t.account,
        HL_NETWORK,
        marketOrderAction({ asset: asset.index, isBuy, limitPx: formatDec(limit), size: absSize(position.szi), reduceOnly: true }),
      );
      if (!readFill(answer).filled) throw new Error("Couldn't close right now: not enough on offer near the price. Try again.");
      onDone();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-xs text-bad max-w-[16rem] truncate" title={err}>{err}</span>}
      <Button variant="secondary" className="h-8 px-3 text-xs" busy={busy} onClick={close}>
        Close trade
      </Button>
    </span>
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
  const [slip, setSlip] = useState("1");
  const [confirm, setConfirm] = useState(false);
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
    if (slV === undefined) notes.push({ tone: "bad", text: "Enter the stop-loss as a price, like 91500." });
    if (tpV === undefined) notes.push({ tone: "bad", text: "Enter the take-profit as a price, like 103000." });
    if (slV && liq && (isLong ? slV <= liq : slV >= liq))
      notes.push({ tone: "bad", text: "This stop-loss is past your liquidation price, so you would be liquidated before it could help. Move it closer." });
    if (slV && mark && (isLong ? mark <= slV : mark >= slV)) notes.push({ tone: "warn", text: "The price is already past this stop-loss, so it will close your trade right away." });
    if (tpV && mark && (isLong ? mark >= tpV : mark <= tpV)) notes.push({ tone: "warn", text: "The price is already past this take-profit, so it will close your trade right away." });
    if (slV && tpV && (isLong ? slV >= tpV : slV <= tpV)) notes.push({ tone: "bad", text: "Your stop-loss and take-profit are the wrong way round." });
    return { notes, slV, tpV, blocked: notes.some((n) => n.tone === "bad") };
  }, [sl, tp, asset?.markPx, position.liquidationPx, isLong]);

  const submit = async () => {
    setErr(null);
    setDone(null);
    if (!t.account || !t.vaultKey || !near.accountId || !keys) return;
    try {
      const sizeStr = size.trim() ? normalizeDecimalInput(size) : "ALL";
      const slipPct = Number(slip);
      if (!Number.isFinite(slipPct) || slipPct <= 0 || slipPct > 10) throw new Error("Max price slip must be between 0.01% and 10%.");
      const slipBps = Math.round(slipPct * 100);
      const confirmTicks = confirm ? 2 : 1;
      const base = { coin: position.coin, side: (isLong ? "long" : "short") as Draft["side"], size: sizeStr, slippageBps: slipBps, confirmTicks };
      const drafts: Draft[] = [];
      if (sl.trim()) drafts.push({ ...base, kind: "stop_loss", triggerPx: normalizeDecimalInput(sl) });
      if (tp.trim()) drafts.push({ ...base, kind: "take_profit", triggerPx: normalizeDecimalInput(tp) });
      if (!drafts.length) throw new Error("enter a stop-loss, a take-profit, or both");
      setBusy(true);
      const res = await sealAndPlace({ drafts, account: t.account, vaultKey: t.vaultKey, owner: near.accountId, network: HL_NETWORK, keys, callBatch: near.callBatch });
      let msg = `Done. ${drafts.length === 2 ? "Your stop-loss and take-profit are" : drafts[0]!.kind === "stop_loss" ? "Your stop-loss is" : "Your take-profit is"} hidden and being watched.`;
      if (backstopOn && asset) {
        const b = backstopFor(position, asset);
        if (b) {
          await placePublicBackstop(t.account, HL_NETWORK, b);
          msg += ` Safety net placed at ${px(b.triggerPx)}.`;
        }
      }
      void res;
      setDone(msg);
      setSl("");
      setTp("");
      onPlaced();
    } catch (e) {
      setErr(friendly(e));
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
          <Input mono inputMode="decimal" placeholder={isLong ? "below the current price" : "above the current price"} value={sl} onChange={(e) => setSl(e.target.value)} />
        </label>
        <label>
          <Label hint={tp && asset?.markPx ? distancePct(asset.markPx, safe(tp)) : undefined}>Take-profit</Label>
          <Input mono inputMode="decimal" placeholder={isLong ? "above the current price" : "below the current price"} value={tp} onChange={(e) => setTp(e.target.value)} />
        </label>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">More options</summary>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <label>
            <Label hint="leave empty to close it all">Amount to close</Label>
            <Input mono inputMode="decimal" placeholder={`all ${position.coin}`} value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          <label>
            <Label hint="how far the price may move as it closes">Max price slip (%)</Label>
            <Input mono inputMode="decimal" value={slip} onChange={(e) => setSlip(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2.5 text-[13px] text-soft">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>
            Ignore quick spikes
            <span className="block text-muted text-xs">Only close if the price stays past your level for a few seconds. Safer against sudden wicks, a little slower.</span>
          </span>
        </label>
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
          Hide my stop
        </SealButton>
        <span className="text-xs text-muted">
          Nobody else will see this price.{backstopOn ? " A safety net is added near liquidation." : ""}
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

