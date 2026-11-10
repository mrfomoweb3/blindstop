"use client";

import { Address } from "@/components/Address";
import { HL_APP, HL_NETWORK } from "@/lib/config";
import { useClearinghouse } from "@/lib/hooks";
import { usd } from "@/lib/format";
import { useTrading } from "@/lib/trading";
import { ExternalLink, Notice, Stat } from "../ui";

export function FundStep() {
  const { address } = useTrading();
  const ch = useClearinghouse(address);
  const empty = ch.data && Number(ch.data.marginSummary.accountValue) <= 0;
  return (
    <div className="grid gap-5 pt-3 max-w-2xl">
      <p className="text-sm text-soft">
        Hyperliquid won&rsquo;t let a wallet do anything until it holds some USDC. Send some to your trading wallet below; this step
        completes by itself as soon as it arrives.
      </p>
      <div className="grid sm:grid-cols-3 gap-4 items-start">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted">Send to this address</div>
          <div className="mt-1.5">{address && <Address value={address} label="Trading wallet" />}</div>
        </div>
        <Stat label="Balance" value={ch.data ? usd(ch.data.marginSummary.accountValue) : ch.error ? "can\u2019t check right now" : "checking…"} sub="updates every few seconds" />
        <Stat label="Open trades" value={ch.data ? ch.data.assetPositions.length : "…"} />
      </div>

      {HL_NETWORK === "testnet" ? (
        <div className="grid gap-3">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted">How to get free test USDC</div>
          <ol className="grid gap-3 text-[13.5px] text-soft">
            <li className="card p-4">
              <span className="font-medium text-fg">1. Claim test USDC with a wallet you already use on Hyperliquid.</span>{" "}
              Open the <ExternalLink href={`${HL_APP}/drip`}>Hyperliquid test faucet</ExternalLink>, connect your usual wallet (MetaMask,
              Rabby…) and claim. Hyperliquid only gives test money to wallets that have deposited on the real Hyperliquid at least once.
            </li>
            <li className="card p-4">
              <span className="font-medium text-fg">2. Send some to your Blindstop trading wallet.</span> Still in the{" "}
              <ExternalLink href={`${HL_APP}/portfolio`}>test app</ExternalLink>, open <em>Portfolio → Send</em>, paste the address above,
              and send 50–100 USDC.
            </li>
            <li className="card p-4">
              <span className="font-medium text-fg">Never used the real Hyperliquid?</span> Make one small deposit there first (about $5
              of USDC) with your usual wallet; after that the faucet works for it.
            </li>
          </ol>
        </div>
      ) : (
        <Notice title="Want to fund it privately?">
          Move money from your <ExternalLink href="https://gloam.trade">Gloam</ExternalLink> private balance to this wallet, then deposit it on
          Hyperliquid. Send a different amount than you put into Gloam, and wait a while first, so the two can&rsquo;t be matched up.
        </Notice>
      )}
      {empty && <p className="text-xs text-muted">Waiting for funds… keep this page open.</p>}
    </div>
  );
}
