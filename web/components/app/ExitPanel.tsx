"use client";

import { friendly } from "@/lib/errors";
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
      if (ch.data && parseDec(a) > parseDec(Number(ch.data.withdrawable).toFixed(6))) throw new Error("That\u2019s more than you can withdraw right now.");
      setBusy(true);
      await withdraw(t.account, t.account.address, a, HL_NETWORK);
      setMsg({ tone: "good", text: `Your $${a} is on its way back to your trading wallet. It usually arrives within a few minutes (Hyperliquid charges a $1 fee).` });
      setAmount("");
    } catch (e) {
      setMsg({ tone: "bad", text: friendly(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Withdraw" aside={`${usd(ch.data?.withdrawable)} available`}>
      <div className="grid gap-3 max-w-xl">
        <p className="text-sm text-soft">
          Take money out of Hyperliquid back to your trading wallet. Only you can do this; Blindstop can&rsquo;t. Want it private? Move it
          into <ExternalLink href="https://gloam.trade">Gloam</ExternalLink> afterwards.
        </p>
        <form
          className="flex gap-2 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <label className="flex-1">
            <Label>Amount (USDC)</Label>
            <Input mono inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </label>
          <Button type="submit" busy={busy} disabled={!amount || !t.account}>Withdraw</Button>
        </form>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </div>
    </Panel>
  );
}
