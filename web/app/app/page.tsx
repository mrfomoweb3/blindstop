"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApproveStep, useAgentApproved } from "@/components/app/ApproveStep";
import { ExitPanel } from "@/components/app/ExitPanel";
import { TradePanel } from "@/components/app/TradePanel";
import { FundStep } from "@/components/app/FundStep";
import { PositionCard } from "@/components/app/PositionCard";
import { Step } from "@/components/app/Step";
import { WalletStep } from "@/components/app/WalletStep";
import { Button, Mono, Notice, Panel, Pill, Stat } from "@/components/ui";
import { HL_APP, HL_NETWORK, NEAR_NETWORK } from "@/lib/config";
import { short, usd } from "@/lib/format";
import { useClearinghouse, useEnclaveKeys, useMyOrders, useOpenOrders, usePerps } from "@/lib/hooks";
import { useLocalOrders } from "@/lib/local-orders";
import { useNear } from "@/lib/near";
import { useTrading } from "@/lib/trading";
import * as vault from "@/lib/vault";

export default function AppPage() {
  const near = useNear();
  const t = useTrading();
  const keys = useEnclaveKeys();
  const perps = usePerps();
  const ch = useClearinghouse(t.status === "unlocked" ? t.address : null);
  const oo = useOpenOrders(t.status === "unlocked" ? t.address : null);
  const chain = useMyOrders(near.accountId);
  const local = useLocalOrders(chain.data);
  const agent = useAgentApproved();

  const [backedUp, setBackedUp] = useState(false);
  const [backstopOn, setBackstopOn] = useState(true);

  useEffect(() => {
    if (!t.address) return;
    void vault.getPref<boolean>(`backup:${t.address.toLowerCase()}`).then((v) => setBackedUp(!!v));
    void vault.getPref<boolean>("backstop").then((v) => setBackstopOn(v ?? true));
  }, [t.address]);

  const positions = ch.data?.assetPositions.map((p) => p.position).filter((p) => p.szi !== "0" && p.szi !== "0.0") ?? [];
  const funded = positions.length > 0 || Number(ch.data?.marginSummary.accountValue ?? 0) > 0;

  const s1 = !!near.accountId;
  const s2 = t.status === "unlocked" && backedUp;
  const s3 = s2 && funded;
  const s4 = s2 && agent.approved;
  const open = !s1 ? 1 : !s2 ? 2 : !s3 ? 3 : !s4 ? 4 : 0;
  const ready = s1 && s2 && s4;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 grid grid-cols-1 gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em] leading-tight">My positions</h1>
          <p className="text-sm text-muted mt-1">
            {ready ? "Your open trades, and the hidden stops protecting them." : "Four quick steps and your stops are hidden."}
            {HL_NETWORK === "testnet" && " Test version: no real money."}
          </p>
        </div>
        {ready && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{near.accountId}</span>
            <span>·</span>
            <Mono>{short(t.address ?? "", 6, 4)}</Mono>
            <Button variant="ghost" className="h-7 px-2" onClick={t.lock}>Lock wallet</Button>
          </div>
        )}
      </div>

      {!ready || open ? (
        <ol className="grid gap-2">
          <Step n={1} title="Sign in" done={s1} open={open === 1} summary={near.accountId}>
            <div className="grid gap-3 pt-3 max-w-xl">
              <p className="text-sm text-soft">
                Sign in with a NEAR wallet such as Meteor or MyNearWallet. This is your Blindstop account: it&rsquo;s where your hidden
                stops are kept. Tip: use an account that isn&rsquo;t linked to your name.
              </p>
              <div>
                <Button variant="primary" busy={!near.ready} onClick={near.connect}>Sign in</Button>
              </div>
            </div>
          </Step>
          <Step n={2} title="Create your trading wallet" done={s2} open={open === 2} summary={t.address && <Mono>{short(t.address)}</Mono>}>
            <WalletStep
              onBackedUp={() => {
                setBackedUp(true);
                if (t.address) void vault.setPref(`backup:${t.address.toLowerCase()}`, true);
              }}
            />
          </Step>
          <Step n={3} title="Add funds" done={s3} open={open === 3} summary={ch.data && usd(ch.data.marginSummary.accountValue)}>
            <FundStep />
          </Step>
          <Step n={4} title="Turn on protection" done={s4} open={open === 4} summary={agent.approved ? "on" : undefined}>
            <ApproveStep />
          </Step>
        </ol>
      ) : null}

      {ready && (
        <>
          <div className="grid sm:grid-cols-4 gap-4 card p-4 sm:p-5">
            <Stat label="Balance" value={usd(ch.data?.marginSummary.accountValue)} sub={`${usd(ch.data?.withdrawable)} available to withdraw`} />
            <Stat label="Open positions" value={positions.length} />
            <Stat label="Hidden stops" value={chain.data?.filter((o) => o.status === "Active").length ?? "…"} sub={<Link className="underline underline-offset-2" href="/app/orders">see history</Link>} />
            <Stat
              label="Orders anyone can see"
              value={oo.data?.length ?? "…"}
              sub={oo.data?.length ? "your safety net, or orders you placed yourself" : "nothing for anyone to aim at"}
            />
          </div>

          <label className="flex items-start gap-3 text-sm max-w-3xl">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={backstopOn}
              onChange={(e) => {
                setBackstopOn(e.target.checked);
                void vault.setPref("backstop", e.target.checked);
              }}
            />
            <span>
              <span className="font-medium">Add a safety net</span>
              <span className="block text-muted text-[13px] leading-relaxed">
                Also place a backup stop just before your liquidation price. If Blindstop is ever offline, this still saves you from being
                liquidated. This backup is visible to others, but it sits far away from your real, hidden stop.
              </span>
            </span>
          </label>

          {keys.data && local.orders.some((o) => o.keyEpoch !== keys.data!.key_epoch && o.orderId) && (
            <Notice tone="warn" title="Some of your stops need to be set again">
              Blindstop upgraded its security, and a few of your older stops can no longer be read. Cancel them in History and set them again.
            </Notice>
          )}

          {ch.error && <Notice tone="bad">We can&rsquo;t reach Hyperliquid right now. Your hidden stops are still being watched; this only affects this page.</Notice>}
          <TradePanel
            perps={perps.data}
            available={Number(ch.data?.withdrawable ?? 0)}
            onTraded={() => {
              ch.reload();
              oo.reload();
            }}
          />
          {positions.length === 0 && ch.data && (
            <p className="text-sm text-muted text-center">Open a trade above, then hide its stop-loss here. It takes a few seconds.</p>
          )}
          <div className="grid lg:grid-cols-2 gap-4">
            {positions.map((p) => (
              <PositionCard
                key={p.coin}
                position={p}
                asset={perps.data?.get(p.coin)}
                keys={keys.data}
                locals={local.orders}
                chain={chain.data ?? []}
                openOrders={oo.data ?? []}
                backstopOn={backstopOn}
                onPlaced={() => {
                  void local.reload();
                  chain.reload();
                  oo.reload();
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Pill tone="neutral">Your stop triggers within a few seconds of the price reaching it. In very fast moves, the fill price can slip.</Pill>
          </div>
          <ExitPanel />
        </>
      )}
    </div>
  );
}
