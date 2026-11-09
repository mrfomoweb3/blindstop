"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderView } from "@blindstop/shared";
import { CONTRACT } from "./config";
import { reconcile } from "./orders";
import { useTrading } from "./trading";
import * as vault from "./vault";

/** This browser's decrypted order records, kept in step with the chain. */
export function useLocalOrders(chain: OrderView[] | undefined) {
  const { vaultKey } = useTrading();
  const [orders, setOrders] = useState<vault.LocalOrder[]>([]);
  const reload = useCallback(async () => {
    if (!vaultKey) return setOrders([]);
    setOrders(await vault.listOrders(vaultKey, CONTRACT));
  }, [vaultKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!vaultKey || !chain) return;
    void reconcile(vaultKey, orders, chain).then((changed) => {
      if (changed) void reload();
    });
  }, [vaultKey, chain, orders, reload]);

  return { orders, reload };
}
