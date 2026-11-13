"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import * as vault from "./vault";

type Status = "loading" | "none" | "locked" | "unlocked";

export interface TradingCtx {
  status: Status;
  address: `0x${string}` | null;
  account: PrivateKeyAccount | null;
  /** AES key for this browser's encrypted records; only while unlocked. */
  vaultKey: CryptoKey | null;
  create: (passphrase: string) => Promise<void>;
  importKey: (privateKey: string, passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  refresh: () => Promise<void>;
}

export const TradingContext = createContext<TradingCtx | null>(null);
const Ctx = TradingContext;

export function TradingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);

  const refresh = useCallback(async () => {
    const rec = await vault.loadWalletRecord();
    setAddress(rec?.address ?? null);
    setStatus((s) => (rec ? (s === "unlocked" ? s : "locked") : "none"));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const adopt = (pk: `0x${string}`, key: CryptoKey) => {
    const a = privateKeyToAccount(pk);
    setAccount(a);
    setAddress(a.address);
    setVaultKey(key);
    setStatus("unlocked");
  };

  const value = useMemo<TradingCtx>(
    () => ({
      status,
      address,
      account,
      vaultKey,
      refresh,
      create: async (passphrase) => {
        const pk = generatePrivateKey();
        const a = privateKeyToAccount(pk);
        adopt(pk, await vault.createWallet(pk, a.address, passphrase));
      },
      importKey: async (raw, passphrase) => {
        const pk = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`;
        if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("a private key is 32 bytes of hex");
        const a = privateKeyToAccount(pk);
        adopt(pk, await vault.createWallet(pk, a.address, passphrase));
      },
      unlock: async (passphrase) => {
        const r = await vault.unlockWallet(passphrase);
        adopt(r.privateKey, r.key);
      },
      lock: () => {
        setAccount(null);
        setVaultKey(null);
        setStatus(address ? "locked" : "none");
      },
    }),
    [status, address, account, vaultKey, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTrading(): TradingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTrading outside TradingProvider");
  return c;
}
