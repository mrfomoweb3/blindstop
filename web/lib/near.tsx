"use client";

import { actionCreators } from "@near-js/transactions";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { blindstopViews } from "@blindstop/shared";
import { CONTRACT, NEAR_NETWORK, NEAR_RPCS } from "./config";

export const views = blindstopViews(NEAR_RPCS, CONTRACT);

export interface CallResult {
  txHash: string | null;
  /** Decoded JSON return value, when the wallet hands the outcome back. */
  value: unknown;
}

interface NearCtx {
  ready: boolean;
  accountId: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  call: (method: string, args: Record<string, unknown>, depositYocto?: bigint, gasTgas?: number) => Promise<CallResult>;
  /** Several calls in ONE transaction (one wallet prompt). Returns the last call's value. */
  callBatch: (calls: { method: string; args: Record<string, unknown>; depositYocto?: bigint; gasTgas?: number }[]) => Promise<CallResult>;
}

const Ctx = createContext<NearCtx | null>(null);

export function NearProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }, { setupIntearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/intear-wallet"),
      ]);
      const s = await setupWalletSelector({
        network: NEAR_NETWORK,
        modules: [setupMeteorWallet(), setupIntearWallet(), setupMyNearWallet()],
      });
      const m = setupModal(s, { contractId: CONTRACT, description: "Blindstop seals your stops on NEAR." });
      const sub = s.store.observable.subscribe((state) => {
        setAccountId(state.accounts.find((a) => a.active)?.accountId ?? null);
      });
      unsub = () => sub.unsubscribe();
      setSelector(s);
      setModal(m);
    })().catch((e) => console.error("wallet selector failed to start", e));
    return () => unsub?.();
  }, []);

  const callBatch = useCallback(
    async (calls: { method: string; args: Record<string, unknown>; depositYocto?: bigint; gasTgas?: number }[]): Promise<CallResult> => {
      if (!selector) throw new Error("wallets are still loading");
      if (calls.length === 0) throw new Error("nothing to send");
      const wallet = await selector.wallet();
      const per = BigInt(Math.min(100, Math.floor(280 / calls.length)));
      const outcome = await wallet.signAndSendTransaction({
        receiverId: CONTRACT,
        actions: calls.map((c) =>
          actionCreators.functionCall(c.method, c.args, BigInt(c.gasTgas ?? Number(per)) * 1_000_000_000_000n, c.depositYocto ?? 0n),
        ),
      });
      if (!outcome) return { txHash: null, value: null };
      const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
      if (status.Failure) throw new Error(panicText(status.Failure));
      let value: unknown = null;
      if (status.SuccessValue) {
        try {
          value = JSON.parse(atob(status.SuccessValue));
        } catch {
          value = null;
        }
      }
      return { txHash: outcome.transaction_outcome?.id ?? outcome.transaction?.hash ?? null, value };
    },
    [selector],
  );

  const call = useCallback(
    (method: string, args: Record<string, unknown>, depositYocto = 0n, gasTgas = 50) =>
      callBatch([{ method, args, depositYocto, gasTgas }]),
    [callBatch],
  );

  const value = useMemo<NearCtx>(
    () => ({
      ready: !!selector,
      accountId,
      connect: () => modal?.show(),
      disconnect: async () => {
        if (!selector) return;
        const w = await selector.wallet();
        await w.signOut();
      },
      call,
      callBatch,
    }),
    [selector, modal, accountId, call, callBatch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNear(): NearCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useNear outside NearProvider");
  return c;
}

function panicText(f: unknown): string {
  const s = JSON.stringify(f);
  const m = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(s);
  return m ? m[1]!.replace(/^Smart contract panicked: /, "") : "transaction failed";
}
