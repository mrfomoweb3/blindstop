"use client";

import { useMemo, useState } from "react";
import {
  formatDec,
  marketOrderAction,
  mulRatio,
  normalizeDecimalInput,
  parseDec,
  readFill,
  roundPerpPx,
  roundSizeDown,
  sendL1,
  updateLeverageAction,
  type PerpAsset,
} from "@blindstop/shared";
import { HL_NETWORK } from "@/lib/config";
import { friendly } from "@/lib/errors";
import { px, usd } from "@/lib/format";
import { useTrading } from "@/lib/trading";
import { Button, cx, Input, Label, Notice } from "../ui";

const POPULAR = ["BTC", "ETH", "SOL", "HYPE"];
const LEVERAGE = [1, 2, 3, 5, 10];
const SCALE = 10n ** 12n;
const MIN_ORDER_USD = 10;

export function TradePanel({ perps, available, onTraded }: { perps: Map<string, PerpAsset> | undefined; available: number; onTraded: () => void }) {
  const t = useTrading();
  const [coin, setCoin] = useState("BTC");
  const [side, setSide] = useState<"long" | "short">("long");
  const [amount, setAmount] = useState("50");
  const [lev, setLev] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const coins = useMemo(() => {
    const all = [...(perps?.values() ?? [])].filter((a) => !a.isDelisted && a.markPx).map((a) => a.name);
    const rest = all.filter((c) => !POPULAR.includes(c)).sort();
    return [...POPULAR.filter((c) => all.includes(c)), ...rest];
  }, [perps]);
  const asset = perps?.get(coin);
  const maxLev = asset?.maxLeverage ?? 10;
  const levChoices = LEVERAGE.filter((l) => l <= maxLev);
  const leverage = Math.min(lev, maxLev);

  const calc = useMemo(() => {
    if (!asset?.markPx) return null;
    let usdScaled: bigint;
    try {
      usdScaled = parseDec(normalizeDecimalInput(amount || "0"));
    } catch {
      return { error: "Enter an amount in dollars, like 50." };
    }
    const mark = parseDec(asset.markPx);
    const size = roundSizeDown((usdScaled * SCALE) / mark, asset.szDecimals);
    const notional = Number(formatDec(usdScaled));
    const margin = notional / leverage;
    if (notional < MIN_ORDER_USD) return { error: `Hyperliquid's minimum trade is $${MIN_ORDER_USD}.`, size, margin };
    if (size === 0n) return { error: "That amount is too small for this coin.", size, margin };
    if (margin > available) return { error: `That needs ${usd(String(margin))} of your money, but you have ${usd(String(available))} available.`, size, margin };
    const isBuy = side === "long";
    const limit = roundPerpPx(mulRatio(mark, isBuy ? 10_100n : 9_900n, 10_000n, isBuy ? "up" : "down"), asset.szDecimals, isBuy ? "up" : "down");
    return { size, margin, limit, error: null as string | null };
  }, [asset, amount, leverage, available, side]);

  const open = async () => {
    if (!t.account || !asset || !calc || calc.error || !calc.limit) return;
    setMsg(null);
    setBusy(true);
    try {
      await sendL1(t.account, HL_NETWORK, updateLeverageAction(asset.index, false, leverage));
      const answer = await sendL1(
        t.account,
        HL_NETWORK,
        marketOrderAction({ asset: asset.index, isBuy: side === "long", limitPx: formatDec(calc.limit), size: formatDec(calc.size!), reduceOnly: false }),
      );
      const fill = readFill(answer);
      if (!fill.filled) {
        setMsg({ tone: "bad", text: "The trade didn't go through: there wasn't enough on offer near the current price. Try again or use a smaller amount." });
        return;
      }
      setMsg({ tone: "good", text: `Opened a ${side} of ${fill.size} ${coin} at $${px(fill.avgPx)}. Now hide its stop-loss below.` });
      onTraded();
    } catch (e) {
      setMsg({ tone: "bad", text: friendly(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5 sm:p-6 grid gap-5 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-light tracking-tight">Open a trade</h2>
        <span className="text-xs text-muted">{usd(String(available))} available</span>
      </div>

      <div className="grid sm:grid-cols-[1fr_auto] gap-4 items-end">
        <label className="min-w-0">
          <Label hint={asset?.markPx ? `price now $${px(asset.markPx)}` : undefined}>Coin</Label>
          <select
            value={coin}
            onChange={(e) => setCoin(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-line-strong bg-sunken text-sm outline-none focus:border-accent/60"
          >
            {coins.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 rounded-full border border-line-strong p-1 h-11">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={cx(
                "px-5 rounded-full text-[13px] font-medium capitalize transition",
                side === s ? (s === "long" ? "bg-good/15 text-good" : "bg-bad/15 text-bad") : "text-muted hover:text-fg",
              )}
            >
              {s === "long" ? "Long ↑" : "Short ↓"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label>
          <Label hint="trade size">Amount (USD)</Label>
          <Input mono inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div>
          <Label hint="isolated: you can't lose more than you put in">Leverage</Label>
          <div className="flex gap-1.5">
            {levChoices.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLev(l)}
                className={cx(
                  "flex-1 h-11 rounded-xl border text-[13px] font-mono transition",
                  leverage === l ? "border-accent/60 bg-accent/10 text-accent-text" : "border-line-strong text-muted hover:text-fg",
                )}
              >
                {l}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {calc && !calc.error && (
        <p className="text-[13px] text-muted">
          You&rsquo;ll {side === "long" ? "buy" : "sell"} about <span className="text-fg">{formatDec(calc.size!)} {coin}</span>, using{" "}
          <span className="text-fg">{usd(String(calc.margin))}</span> of your money.
        </p>
      )}
      {calc?.error && amount && <p className="text-[13px] text-warn">{calc.error}</p>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div>
        <Button variant="primary" className="h-11 px-7" busy={busy} disabled={!t.account || !calc || !!calc.error} onClick={open}>
          {side === "long" ? "Open long" : "Open short"}
        </Button>
      </div>
    </section>
  );
}
