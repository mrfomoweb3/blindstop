import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const csv = z
  .string()
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().url()).min(1));

const Env = z.object({
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC: csv.optional(),
  BLINDSTOP_CONTRACT: z.string().min(2),
  KEEPER_ACCOUNT: z.string().min(2),
  /** ed25519:<base58>. If unset, read from ~/.near-credentials/<network>/<account>.json */
  KEEPER_PRIVATE_KEY: z.string().optional(),
  OUTLAYER_API: z.string().url().optional(),
  /** owner/name, e.g. blindstop-watch.testnet/blindstop-watcher */
  OUTLAYER_PROJECT: z.string().regex(/^[a-z0-9._-]+\/[a-z0-9._-]+$/),
  /** owner:nonce:secret — a payment key owned by the project's operator account */
  OUTLAYER_PAYMENT_KEY: z.string().regex(/^[a-z0-9._-]+:\d+:[0-9a-f]+$/),
  TICK_INTERVAL_MS: z.coerce.number().int().min(500).default(3000),
  HEARTBEAT_EVERY: z.coerce.number().int().min(1).default(10),
  HEARTBEAT_MAX_GAP_MS: z.coerce.number().int().min(0).default(20_000),
  CALL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = {
  network: "testnet" | "mainnet";
  rpcs: string[];
  contract: string;
  keeperAccount: string;
  keeperSecret: string;
  outlayerApi: string;
  outlayerProject: string;
  paymentKey: string;
  tickIntervalMs: number;
  heartbeatEvery: number;
  heartbeatMaxGapMs: number;
  callTimeoutMs: number;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

const DEFAULT_RPCS = {
  testnet: ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"],
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"],
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid keeper configuration — ${fields}`);
  }
  const e = parsed.data;
  let secret = e.KEEPER_PRIVATE_KEY;
  if (!secret) {
    const file = join(homedir(), ".near-credentials", e.NEAR_NETWORK, `${e.KEEPER_ACCOUNT}.json`);
    try {
      secret = (JSON.parse(readFileSync(file, "utf8")) as { private_key: string }).private_key;
    } catch {
      throw new Error(`KEEPER_PRIVATE_KEY is unset and ${file} is unreadable`);
    }
  }
  return {
    network: e.NEAR_NETWORK,
    rpcs: e.NEAR_RPC ?? DEFAULT_RPCS[e.NEAR_NETWORK],
    contract: e.BLINDSTOP_CONTRACT,
    keeperAccount: e.KEEPER_ACCOUNT,
    keeperSecret: secret,
    outlayerApi: e.OUTLAYER_API ?? (e.NEAR_NETWORK === "mainnet" ? "https://api.outlayer.ai" : "https://testnet-api.outlayer.ai"),
    outlayerProject: e.OUTLAYER_PROJECT,
    paymentKey: e.OUTLAYER_PAYMENT_KEY,
    tickIntervalMs: e.TICK_INTERVAL_MS,
    heartbeatEvery: e.HEARTBEAT_EVERY,
    heartbeatMaxGapMs: e.HEARTBEAT_MAX_GAP_MS,
    callTimeoutMs: e.CALL_TIMEOUT_MS,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
  };
}
