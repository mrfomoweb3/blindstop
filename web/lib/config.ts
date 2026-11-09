import type { HlNetwork } from "@blindstop/shared";

const list = (s: string | undefined, fallback: string[]) =>
  s ? s.split(",").map((x) => x.trim()).filter(Boolean) : fallback;

export const NEAR_NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT = process.env.NEXT_PUBLIC_CONTRACT ?? "blindstop.testnet";
export const NEAR_RPCS = list(process.env.NEXT_PUBLIC_NEAR_RPCS, [
  "https://rpc.testnet.fastnear.com",
  "https://near-testnet.drpc.org",
]);
export const HL_NETWORK = (process.env.NEXT_PUBLIC_HL_NETWORK ?? "testnet") as HlNetwork;
export const OUTLAYER_API = process.env.NEXT_PUBLIC_OUTLAYER_API ?? "https://testnet-api.outlayer.ai";
export const OUTLAYER_PROJECT = process.env.NEXT_PUBLIC_OUTLAYER_PROJECT ?? "blindstop-watch.testnet/blindstop-watcher";
export const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL || null;

export const EXPLORER =
  NEAR_NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const HL_APP = HL_NETWORK === "mainnet" ? "https://app.hyperliquid.xyz" : "https://app.hyperliquid-testnet.xyz";

export const AGENT_NAME = "blindstop";
