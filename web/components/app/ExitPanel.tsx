"use client";

import { useState } from "react";
import { normalizeDecimalInput, parseDec, withdraw } from "@blindstop/shared";
import { HL_NETWORK } from "@/lib/config";
import { useClearinghouse } from "@/lib/hooks";
import { usd } from "@/lib/format";
import { useTrading } from "@/lib/trading";
import { Button, ExternalLink, Input, Label, Notice, Panel } from "../ui";

export function ExitPanel() {
  const t = useTrading();
  const ch = useClearinghouse(t.address);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const go = async () => {
    if (!t.account) return;
    setMsg(null);
    try {
      const a = normalizeDecimalInput(amount);
      if (ch.data && parseDec(a) > parseDec(Number(ch.data.withdrawable).toFixed(6))) throw new Error("more than is withdrawable");
      setBusy(true);
      await withdraw(t.account, t.account.address, a, HL_NETWORK);
      setMsg({ tone: "good", text: `Withdrawal of $${a} requested to ${t.account.address} on Arbitrum. Hyperliquid charges a $1 fee and settles in a few minutes.` });
      setAmount("");
    } catch (e) {
      setMsg({ tone: "bad", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Exit" aside={`withdrawable ${usd(ch.data?.withdrawable)}`}>
      <div className="grid gap-3 max-w-xl">
        <p className="text-sm text-soft">
          Withdraw from Hyperliquid back to this trading wallet on Arbitrum, signed by its own key (the watcher cannot do this). To make the
          exit private, deposit from there into <ExternalLink href="https://gloam.trade">Gloam</ExternalLink> with &ldquo;deposit from another
          chain&rdquo;; the wallet needs a little ETH on Arbitrum for that transaction.
        </p>
        <form
          className="flex gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <label className="flex-1">
            <Label>USDC</Label>
            <Input mono inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <Button type="submit" busy={busy} disabled={!amount || !t.account}>Withdraw</Button>
        </form>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Panel>
  );
}
