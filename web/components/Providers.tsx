"use client";

import "@near-wallet-selector/modal-ui/styles.css";
import type { ReactNode } from "react";
import { NearProvider } from "@/lib/near";
import { TradingProvider } from "@/lib/trading";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NearProvider>
      <TradingProvider>{children}</TradingProvider>
    </NearProvider>
  );
}
