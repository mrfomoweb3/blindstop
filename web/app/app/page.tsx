"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApproveStep, useAgentApproved } from "@/components/app/ApproveStep";
import { ExitPanel } from "@/components/app/ExitPanel";
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
  const [fundSkipped, setFundSkipped] = useState(false);
  const [backstopOn, setBackstopOn] = useState(true);

  useEffect(() => {
    if (!t.address) return;
    void vault.getPref<boolean>(`backup:${t.address.toLowerCase()}`).then((v) => setBackedUp(!!v));
    void vault.getPref<boolean>("backstop").then((v) => setBackstopOn(v ?? true));
  }, [t.address]);

  const positions = ch.data?.assetPositions.map((p) => p.position).filter((p) => p.szi !== "0" && p.szi !== "0.0") ?? [];
  const funded = fundSkipped || positions.length > 0 || Number(ch.data?.marginSummary.accountValue ?? 0) > 0;

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
          <h1 className="text-2xl font-semibold tracking-tight">Your sealed stops</h1>
          <p className="text-sm text-muted mt-1">
            Hyperliquid {HL_NETWORK} · NEAR {NEAR_NETWORK}
          </p>
        </div>
        {ready && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{near.accountId}</span>
            <span>·</span>
            <Mono>{short(t.address ?? "", 6, 4)}</Mono>
            <Button variant="ghost" className="h-7 px-2" onClick={t.lock}>Lock</Button>
          </div>
        )}
      </div>

      {!ready || open ? (
        <ol className="grid gap-2">
          <Step n={1} title="Connect a NEAR account" done={s1} open={open === 1} summary={near.accountId}>
            <div className="grid gap-3 pt-3 max-w-xl">
              <p className="text-sm text-fg/75">
                This account places and cancels your sealed orders. It is public which account placed them and when, so prefer a fresh account
                that is not your main identity.
              </p>
              <div>
                <Button variant="primary" busy={!near.ready} onClick={near.connect}>Connect wallet</Button>
              </div>
            </div>
          </Step>
          <Step n={2} title="Trading wallet" done={s2} open={open === 2} summary={t.address && <Mono>{short(t.address)}</Mono>}>
            <WalletStep
              onBackedUp={() => {
                setBackedUp(true);
                if (t.address) void vault.setPref(`backup:${t.address.toLowerCase()}`, true);
              }}
            />
          </Step>
          <Step n={3} title="Fund it" done={s3} open={open === 3} summary={ch.data && usd(ch.data.marginSummary.accountValue)}>
            <FundStep onSkip={() => setFundSkipped(true)} />
          </Step>
          <Step n={4} title="Approve the watcher" done={s4} open={open === 4} summary={agent.approved ? "agent approved" : undefined}>
            <ApproveStep />
          </Step>
        </ol>
      ) : null}

      {ready && (
        <>
          <div className="grid sm:grid-cols-4 gap-4 border border-line rounded-[8px] bg-panel p-4 sm:p-5">
            <Stat label="Account value" value={usd(ch.data?.marginSummary.accountValue)} sub={`withdrawable ${usd(ch.data?.withdrawable)}`} />
            <Stat label="Positions" value={positions.length} />
            <Stat label="Sealed & active" value={chain.data?.filter((o) => o.status === "Active").length ?? "…"} sub={<Link className="underline underline-offset-2" href="/app/orders">all orders</Link>} />
            <Stat
              label="Public orders on the book"
              value={oo.data?.length ?? "…"}
              sub={oo.data?.length ? "includes your backstop or manual orders" : "nothing for anyone to hunt"}
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
              <span className="font-medium">Public backstop near liquidation</span>
              <span className="block text-muted text-[13px] leading-relaxed">
                When you seal a stop, also place a wide reduce-only stop just before your liquidation price, with your own key, on the public book.
                If the watcher ever goes down, this still saves you from liquidation. It is visible, but far from where your real stop sits.
              </span>
            </span>
          </label>

          {keys.data && local.orders.some((o) => o.keyEpoch !== keys.data!.key_epoch && o.orderId) && (
            <Notice tone="warn" title="The enclave keys were rotated">
              Some of your active orders were sealed to the previous enclave key and can no longer be opened. Cancel and seal them again.
            </Notice>
          )}

          {ch.error && <Notice tone="bad">Hyperliquid is unreachable: {ch.error}</Notice>}
          {positions.length === 0 && ch.data && (
            <Panel title="No open positions">
              <p className="text-sm text-fg/75">
                Open a position with this wallet on <a className="underline" href={`${HL_APP}/trade`} target="_blank" rel="noreferrer">Hyperliquid {HL_NETWORK}</a>, then
                seal its stop here. Blindstop protects positions; it never opens them.
              </p>
            </Panel>
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
            <Pill tone="neutral">Fires within about 3–6 s of the cross. Fast wicks can fill worse than a native stop.</Pill>
          </div>
          <ExitPanel />
        </>
      )}
    </div>
  );
}
