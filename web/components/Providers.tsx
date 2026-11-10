"use client";

import "@/app/wallet-modal.css";
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
