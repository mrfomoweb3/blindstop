"use client";

import { useState } from "react";
import { approveAgent } from "@blindstop/shared";
import { AGENT_NAME, HL_NETWORK } from "@/lib/config";
import { useEnclaveKeys, useExtraAgents } from "@/lib/hooks";
import { useTrading } from "@/lib/trading";
import { Button, Mono, Notice } from "../ui";

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
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 pt-3 max-w-2xl">
      <p className="text-sm text-soft">
        Approve the enclave&rsquo;s agent for your trading wallet. Its address comes from the Blindstop contract, which pins the enclave
        keys.
      </p>
      <div className="font-mono text-[12.5px] grid gap-1">
        <div>
          <span className="text-muted">agent&nbsp;&nbsp;</span>
          <Mono>{agent ?? "loading…"}</Mono>
        </div>
        <div>
          <span className="text-muted">name&nbsp;&nbsp;&nbsp;</span>
          {AGENT_NAME}
        </div>
      </div>
      <Notice tone="neutral" title="This agent can open, close and cancel orders. It cannot withdraw.">
        The enclave only ever sends reduce-only closes, and only for orders sealed by your NEAR account with this wallet&rsquo;s signature.
        You can revoke it at any time by approving a different agent under the same name in Hyperliquid.
      </Notice>
      {err && <Notice tone="bad">{err}</Notice>}
      <div>
        <Button variant="primary" busy={busy} disabled={!account || !agent} onClick={approve}>
          Approve the watcher
        </Button>
      </div>
    </div>
  );
}
