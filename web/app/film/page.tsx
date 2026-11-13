"use client";

// Development-only stage for filming the demo video. It mounts the real app
// components with sample numbers: a throwaway key that is never funded and is
// never used to send anything (the buttons are pressed only on camera, not here).
// In production builds this page is a 404.

import { notFound } from "next/navigation";
import { useMemo } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { PositionCard } from "@/components/app/PositionCard";
import { TradePanel } from "@/components/app/TradePanel";
import { Stat } from "@/components/ui";
import { usd } from "@/lib/format";
import { useEnclaveKeys, usePerps } from "@/lib/hooks";
import { TradingContext, type TradingCtx } from "@/lib/trading";
import type { Position } from "@blindstop/shared";

export default function FilmPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <FilmStage />;
}

function FilmStage() {
  const perps = usePerps();
  const keys = useEnclaveKeys();

  const ctx = useMemo<TradingCtx>(() => {
    const account = privateKeyToAccount(generatePrivateKey());
    const noop = async () => {};
    return { status: "unlocked", address: account.address, account, vaultKey: null, create: noop, importKey: noop, unlock: noop, lock: () => {}, refresh: noop };
  }, []);

  const btc = perps.data?.get("BTC");
  const position = useMemo<Position | null>(() => {
    if (!btc?.markPx) return null;
    const mark = Number(btc.markPx);
    const entry = Math.round(mark * 0.996);
    const size = 0.002;
    return {
      coin: "BTC",
      szi: String(size),
      entryPx: String(entry),
      liquidationPx: String(Math.round(entry * 0.69)),
      unrealizedPnl: ((mark - entry) * size).toFixed(2),
      positionValue: (mark * size).toFixed(2),
      leverage: { type: "isolated", value: 3 },
    };
  }, [btc?.markPx]);

  return (
    <TradingContext.Provider value={ctx}>
      <div className="mx-auto max-w-6xl px-6 py-10 grid gap-8">
        <div id="stats" className="grid sm:grid-cols-4 gap-4 card p-4 sm:p-5">
          <Stat label="Balance" value={usd("1000")} sub={`${usd("982.40")} available to withdraw`} />
          <Stat label="Open positions" value={1} />
          <Stat label="Hidden stops" value={2} sub="see history" />
          <Stat label="Orders anyone can see" value={0} sub="nothing for anyone to aim at" />
        </div>
        <div id="trade">
          <TradePanel perps={perps.data} available={982.4} onTraded={() => {}} />
        </div>
        <div id="position" className="max-w-xl">
          {position && <PositionCard position={position} asset={btc} keys={keys.data} locals={[]} chain={[]} openOrders={[]} backstopOn={false} onPlaced={() => {}} />}
        </div>
      </div>
    </TradingContext.Provider>
  );
}
