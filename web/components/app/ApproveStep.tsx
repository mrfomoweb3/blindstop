"use client";

import { useState } from "react";
import { approveAgent } from "@blindstop/shared";
import { AGENT_NAME, HL_NETWORK } from "@/lib/config";
import { useEnclaveKeys, useExtraAgents } from "@/lib/hooks";
import { useTrading } from "@/lib/trading";
import { Button, Check, Details, Mono, Notice } from "../ui";

export function useAgentApproved(): { approved: boolean; agent: string | null; loading: boolean } {
  const { address } = useTrading();
  const keys = useEnclaveKeys();
  const agents = useExtraAgents(address);
  const agent = keys.data?.agent_address ?? null;
  const approved =
    !!agent && !!agents.data?.some((a) => a.address.toLowerCase() === agent.toLowerCase() && (a.validUntil ?? Infinity) > Date.now());
  return { approved, agent, loading: keys.loading || agents.loading };
}

export function ApproveStep() {
  const { account } = useTrading();
  const keys = useEnclaveKeys();
  const agents = useExtraAgents(account?.address ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const agent = keys.data?.agent_address;

  const approve = async () => {
    if (!account || !agent) return;
    setErr(null);
    setBusy(true);
    try {
      await approveAgent(account, agent, AGENT_NAME, HL_NETWORK);
      agents.reload();
    } catch (e) {
      console.error(e);
      setErr("Hyperliquid didn\u2019t accept that. Make sure the wallet has funds, then try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 pt-3 max-w-2xl">
      <p className="text-sm text-soft">Give Blindstop permission to close your trades when your stop price is reached.</p>
      <ul className="grid gap-2">
        <Check>Blindstop can close your positions when your stop is hit.</Check>
        <Check>Blindstop can never withdraw, send or move your money.</Check>
        <Check>You can switch it off any time from Hyperliquid.</Check>
      </ul>
      {err && <Notice tone="bad">{err}</Notice>}
      <div>
        <Button variant="primary" busy={busy} disabled={!account || !agent} onClick={approve}>
          Turn on protection
        </Button>
      </div>
      <Details>
        <p>
          This approves Blindstop as a Hyperliquid &ldquo;agent&rdquo; named <Mono>{AGENT_NAME}</Mono> at <Mono>{agent ?? "loading…"}</Mono>.
          Hyperliquid agents can trade but can&rsquo;t withdraw. Its key is held inside a secure enclave and is shared by every Blindstop user.
        </p>
      </Details>
    </div>
  );
}
