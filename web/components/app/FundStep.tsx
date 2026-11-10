"use client";

import { Address } from "@/components/Address";
import { HL_APP, HL_NETWORK } from "@/lib/config";
import { useClearinghouse } from "@/lib/hooks";
import { usd } from "@/lib/format";
import { useTrading } from "@/lib/trading";
import { Button, Details, ExternalLink, Stat } from "../ui";

export function FundStep({ onSkip }: { onSkip: () => void }) {
  const { address } = useTrading();
  const ch = useClearinghouse(address);
  return (
    <div className="grid gap-5 pt-3 max-w-2xl">
      <p className="text-sm text-soft">Send USDC to your trading wallet on Hyperliquid. We&rsquo;ll notice as soon as it arrives.</p>
      <div className="grid sm:grid-cols-3 gap-4 items-start">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted">Your trading wallet</div>
          <div className="mt-1.5">{address && <Address value={address} label="Trading wallet" />}</div>
        </div>
        <Stat label="Balance" value={ch.data ? usd(ch.data.marginSummary.accountValue) : ch.error ? "can\u2019t check right now" : "checking…"} />
        <Stat label="Open trades" value={ch.data ? ch.data.assetPositions.length : "…"} />
      </div>
      {HL_NETWORK === "testnet" ? (
        <Details title="How do I get test money?">
          <p>
            This is the test version, so it uses free test USDC. Ask someone with a Hyperliquid test account to send some to your address
            above, or use the <ExternalLink href={`${HL_APP}/drip`}>test faucet</ExternalLink> (Hyperliquid only allows wallets that have
            used the real app before).
          </p>
        </Details>
      ) : (
        <Details title="Want to fund it privately?">
          <p>
            Move money from your <ExternalLink href="https://gloam.trade">Gloam</ExternalLink> private balance to this wallet, then deposit it
            on Hyperliquid. Send a different amount than you put into Gloam, and wait a while first, so the two can&rsquo;t be matched up.
          </p>
        </Details>
      )}
      <div>
        <Button variant="ghost" onClick={onSkip}>My wallet already has funds</Button>
      </div>
    </div>
  );
}
