"use client";

import { HL_APP, HL_NETWORK } from "@/lib/config";
import { useClearinghouse } from "@/lib/hooks";
import { usd } from "@/lib/format";
import { useTrading } from "@/lib/trading";
import { Button, ExternalLink, Mono, Notice, Stat } from "../ui";

export function FundStep({ onSkip }: { onSkip: () => void }) {
  const { address } = useTrading();
  const ch = useClearinghouse(address);
  const value = ch.data?.marginSummary.accountValue;
  return (
    <div className="grid gap-4 pt-3">
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Trading wallet" value={<Mono>{address}</Mono>} />
        <Stat label={`Hyperliquid ${HL_NETWORK} account value`} value={ch.data ? usd(value) : ch.error ? "unreachable" : "…"} sub="updates every 5s" />
        <Stat label="Open positions" value={ch.data ? ch.data.assetPositions.length : "…"} />
      </div>

      {HL_NETWORK === "testnet" ? (
        <Notice title="Fund on Hyperliquid testnet">
          Send test USDC to this address from another testnet account (Hyperliquid&rsquo;s <em>Send</em> to an address), or use the{" "}
          <ExternalLink href={`${HL_APP}/drip`}>testnet faucet</ExternalLink>. Hyperliquid only lets an address claim from the faucet if
          it has deposited on mainnet before. Then open a small position in the{" "}
          <ExternalLink href={`${HL_APP}/trade`}>testnet app</ExternalLink> with this wallet&rsquo;s key, or with any wallet that sends
          it funds.
        </Notice>
      ) : (
        <Notice title="Fund privately with Gloam (manual for now)">
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              In the <ExternalLink href="https://gloam.trade">Gloam app</ExternalLink>, cash out from your private balance to this trading
              wallet, then bridge or deposit the USDC to Hyperliquid from it.
            </li>
            <li>Cash out a different amount than you shielded, and wait before you do it. Amount and timing can still link the two sides.</li>
          </ol>
          <p className="mt-2">
            Gloam&rsquo;s SDK cashes out on the chain the money is on (Base, Ethereum, Tempo, Robinhood Chain); it has no one-step cash out
            to Arbitrum, so Blindstop does not automate this step.
          </p>
        </Notice>
      )}
      <div>
        <Button variant="ghost" onClick={onSkip}>Skip: this wallet is already funded</Button>
      </div>
    </div>
  );
}
