/**
 * Hyperliquid from the browser: read-only `/info`, and the user-signed actions the trading
 * wallet makes itself (approve the watcher, withdraw, an optional public backstop stop).
 * Signing mirrors hyperliquid-python-sdk 0.24.0; `test/hl.test.ts` checks it against the
 * SDK's own outputs (`enclave/core/tests/hl_vectors.json`).
 */
import { keccak256, type Hex, type LocalAccount } from "viem";
import { concatBytes, hexToBytes, utf8 } from "./bytes.ts";
import type { HlNetwork } from "./order.ts";

export const HL_API: Record<HlNetwork, string> = {
  mainnet: "https://api.hyperliquid.xyz",
  testnet: "https://api.hyperliquid-testnet.xyz",
};

/** Arbitrum Sepolia; what the Python SDK signs user actions under. Any chain id works. */
export const SIGNATURE_CHAIN_ID = "0x66eee";

// ─────────────── msgpack (Python msgpack.packb encodings) ───────────────

export type MsgValue = null | boolean | number | string | MsgValue[] | { [k: string]: MsgValue };

function packStr(s: string, out: number[]) {
  const b = utf8(s);
  const n = b.length;
  if (n < 32) out.push(0xa0 | n);
  else if (n <= 0xff) out.push(0xd9, n);
  else if (n <= 0xffff) out.push(0xda, n >> 8, n & 0xff);
  else throw new Error("string too long");
  for (const x of b) out.push(x);
}

function packUint(n: number, out: number[]) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`only non-negative safe integers are packed: ${n}`);
  if (n < 0x80) out.push(n);
  else if (n <= 0xff) out.push(0xcc, n);
  else if (n <= 0xffff) out.push(0xcd, n >> 8, n & 0xff);
  else if (n <= 0xffffffff) out.push(0xce, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  else {
    const big = BigInt(n);
    out.push(0xcf);
    for (let i = 7; i >= 0; i--) out.push(Number((big >> BigInt(i * 8)) & 0xffn));
  }
}

function packLen(n: number, fix: number, tag16: number, out: number[]) {
  if (n <= 15) out.push(fix | n);
  else if (n <= 0xffff) out.push(tag16, n >> 8, n & 0xff);
  else throw new Error("collection too large");
}

export function msgpack(v: MsgValue, out: number[] = []): number[] {
  if (v === null) out.push(0xc0);
  else if (v === true) out.push(0xc3);
  else if (v === false) out.push(0xc2);
  else if (typeof v === "number") packUint(v, out);
  else if (typeof v === "string") packStr(v, out);
  else if (Array.isArray(v)) {
    packLen(v.length, 0x90, 0xdc, out);
    for (const x of v) msgpack(x, out);
  } else {
    const entries = Object.entries(v);
    packLen(entries.length, 0x80, 0xde, out);
    for (const [k, x] of entries) {
      packStr(k, out);
      msgpack(x, out);
    }
  }
  return out;
}

export function actionHash(action: MsgValue, nonce: number): Uint8Array {
  const n = new Uint8Array(8);
  new DataView(n.buffer).setBigUint64(0, BigInt(nonce));
  return hexToBytes(keccak256(concatBytes(Uint8Array.from(msgpack(action)), n, Uint8Array.of(0))));
}

export interface HlSignature {
  r: Hex;
  s: Hex;
  v: number;
}

function splitSig(sig: Hex): HlSignature {
  const b = hexToBytes(sig);
  if (b.length !== 65) throw new Error("signature must be 65 bytes");
  const hex = (x: Uint8Array) => `0x${[...x].map((y) => y.toString(16).padStart(2, "0")).join("")}` as Hex;
  const v = b[64]! < 27 ? b[64]! + 27 : b[64]!;
  return { r: hex(b.subarray(0, 32)), s: hex(b.subarray(32, 64)), v };
}

export async function signL1Action(account: LocalAccount, action: MsgValue, nonce: number, network: HlNetwork): Promise<HlSignature> {
  const connectionId = `0x${[...actionHash(action, nonce)].map((y) => y.toString(16).padStart(2, "0")).join("")}` as Hex;
  const sig = await account.signTypedData({
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
    primaryType: "Agent",
    message: { source: network === "mainnet" ? "a" : "b", connectionId },
  });
  return splitSig(sig);
}

const USER_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: parseInt(SIGNATURE_CHAIN_ID, 16),
  verifyingContract: "0x0000000000000000000000000000000000000000",
} as const;

const chainName = (n: HlNetwork) => (n === "mainnet" ? "Mainnet" : "Testnet");

export async function signApproveAgent(
  account: LocalAccount,
  agentAddress: `0x${string}`,
  agentName: string,
  nonce: number,
  network: HlNetwork,
): Promise<{ action: Record<string, MsgValue>; signature: HlSignature }> {
  const action = {
    type: "approveAgent",
    signatureChainId: SIGNATURE_CHAIN_ID,
    hyperliquidChain: chainName(network),
    agentAddress,
    agentName,
    nonce,
  };
  const sig = await account.signTypedData({
    domain: USER_DOMAIN,
    types: {
      "HyperliquidTransaction:ApproveAgent": [
        { name: "hyperliquidChain", type: "string" },
        { name: "agentAddress", type: "address" },
        { name: "agentName", type: "string" },
        { name: "nonce", type: "uint64" },
      ],
    },
    primaryType: "HyperliquidTransaction:ApproveAgent",
    message: { hyperliquidChain: chainName(network), agentAddress, agentName, nonce: BigInt(nonce) },
  });
  return { action, signature: splitSig(sig) };
}

export async function signWithdraw(
  account: LocalAccount,
  destination: `0x${string}`,
  amount: string,
  time: number,
  network: HlNetwork,
): Promise<{ action: Record<string, MsgValue>; signature: HlSignature }> {
  const action = { type: "withdraw3", signatureChainId: SIGNATURE_CHAIN_ID, hyperliquidChain: chainName(network), destination, amount, time };
  const sig = await account.signTypedData({
    domain: USER_DOMAIN,
    types: {
      "HyperliquidTransaction:Withdraw": [
        { name: "hyperliquidChain", type: "string" },
        { name: "destination", type: "string" },
        { name: "amount", type: "string" },
        { name: "time", type: "uint64" },
      ],
    },
    primaryType: "HyperliquidTransaction:Withdraw",
    message: { hyperliquidChain: chainName(network), destination, amount, time: BigInt(time) },
  });
  return { action, signature: splitSig(sig) };
}

// ─────────────── HTTP ───────────────

export async function hlInfo<T>(network: HlNetwork, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${HL_API[network]}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Hyperliquid /info ${res.status}`);
  return (await res.json()) as T;
}

export interface ExchangeAnswer {
  status: "ok" | "err";
  response: unknown;
}

export async function hlExchange(
  network: HlNetwork,
  action: MsgValue,
  nonce: number,
  signature: HlSignature,
): Promise<ExchangeAnswer> {
  const res = await fetch(`${HL_API[network]}/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
  });
  const text = await res.text();
  let parsed: ExchangeAnswer;
  try {
    parsed = JSON.parse(text) as ExchangeAnswer;
  } catch {
    throw new Error(`Hyperliquid /exchange ${res.status}: ${text.slice(0, 200)}`);
  }
  if (parsed.status !== "ok") throw new Error(typeof parsed.response === "string" ? parsed.response : JSON.stringify(parsed.response));
  return parsed;
}

// ─────────────── reads ───────────────

export interface PerpAsset {
  index: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
  markPx: string | null;
  isDelisted: boolean;
}

export async function fetchPerps(network: HlNetwork): Promise<Map<string, PerpAsset>> {
  type Raw = [{ universe: { name: string; szDecimals: number; maxLeverage: number; isDelisted?: boolean }[] }, { markPx: string | null }[]];
  const [meta, ctxs] = await hlInfo<Raw>(network, { type: "metaAndAssetCtxs" });
  const out = new Map<string, PerpAsset>();
  meta.universe.forEach((u, i) =>
    out.set(u.name, {
      index: i,
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage,
      markPx: ctxs[i]?.markPx ?? null,
      isDelisted: !!u.isDelisted,
    }),
  );
  return out;
}

export interface Position {
  coin: string;
  szi: string;
  entryPx: string | null;
  liquidationPx: string | null;
  unrealizedPnl: string;
  positionValue: string;
  leverage: { type: string; value: number };
}

export interface ClearinghouseState {
  assetPositions: { position: Position; type: string }[];
  marginSummary: { accountValue: string; totalNtlPos: string; totalMarginUsed: string };
  withdrawable: string;
}

export const fetchClearinghouse = (network: HlNetwork, user: string) =>
  hlInfo<ClearinghouseState>(network, { type: "clearinghouseState", user });

export interface OpenOrder {
  coin: string;
  side: "A" | "B";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  isTrigger?: boolean;
  triggerPx?: string;
  orderType?: string;
}

export const fetchOpenOrders = (network: HlNetwork, user: string) => hlInfo<OpenOrder[]>(network, { type: "frontendOpenOrders", user });

export interface ExtraAgent {
  address: string;
  name: string;
  validUntil: number;
}

export const fetchExtraAgents = (network: HlNetwork, user: string) => hlInfo<ExtraAgent[]>(network, { type: "extraAgents", user });

// ─────────────── actions ───────────────

export async function approveAgent(account: LocalAccount, agent: `0x${string}`, name: string, network: HlNetwork) {
  const nonce = Date.now();
  const { action, signature } = await signApproveAgent(account, agent, name, nonce, network);
  return hlExchange(network, action, nonce, signature);
}

export async function withdraw(account: LocalAccount, destination: `0x${string}`, amount: string, network: HlNetwork) {
  const time = Date.now();
  const { action, signature } = await signWithdraw(account, destination, amount, time, network);
  return hlExchange(network, action, time, signature);
}

/**
 * The optional public backstop: a reduce-only stop-market trigger the user places with their
 * OWN key, far away (near liquidation), so a dead watcher still leaves some protection.
 * It is visible on the book; that is the trade-off the user opts into.
 */
export function backstopAction(p: {
  asset: number;
  closeIsBuy: boolean;
  triggerPx: string;
  limitPx: string;
  size: string;
}): Record<string, MsgValue> {
  return {
    type: "order",
    orders: [
      {
        a: p.asset,
        b: p.closeIsBuy,
        p: p.limitPx,
        s: p.size,
        r: true,
        t: { trigger: { isMarket: true, triggerPx: p.triggerPx, tpsl: "sl" } },
      },
    ],
    grouping: "na",
  };
}

export async function placeBackstop(account: LocalAccount, network: HlNetwork, p: Parameters<typeof backstopAction>[0]) {
  const nonce = Date.now();
  const action = backstopAction(p);
  const signature = await signL1Action(account, action, nonce, network);
  return hlExchange(network, action, nonce, signature);
}

// ─────────────── trading from the app (the user's own key) ───────────────

/**
 * A market order the way the official SDK sends one: an IOC limit order priced through the
 * book by a slippage bound, so it fills now or not at all.
 */
export function marketOrderAction(p: { asset: number; isBuy: boolean; limitPx: string; size: string; reduceOnly: boolean }): Record<string, MsgValue> {
  return {
    type: "order",
    orders: [{ a: p.asset, b: p.isBuy, p: p.limitPx, s: p.size, r: p.reduceOnly, t: { limit: { tif: "Ioc" } } }],
    grouping: "na",
  };
}

/** Key order as in the SDK's `update_leverage`: type, asset, isCross, leverage. */
export function updateLeverageAction(asset: number, isCross: boolean, leverage: number): Record<string, MsgValue> {
  if (!Number.isInteger(leverage) || leverage < 1) throw new Error("leverage must be a whole number of at least 1");
  return { type: "updateLeverage", asset, isCross, leverage };
}

export type FillResult = { filled: true; size: string; avgPx: string } | { filled: false; reason: string };

/** Reads the first status of an order answer. */
export function readFill(answer: ExchangeAnswer): FillResult {
  const st = (answer.response as { data?: { statuses?: Record<string, unknown>[] } })?.data?.statuses?.[0];
  if (st && "filled" in st) {
    const f = st.filled as { totalSz: string; avgPx: string };
    return { filled: true, size: f.totalSz, avgPx: f.avgPx };
  }
  if (st && "error" in st) return { filled: false, reason: String(st.error) };
  return { filled: false, reason: "no fill" };
}

export async function sendL1(account: LocalAccount, network: HlNetwork, action: Record<string, MsgValue>): Promise<ExchangeAnswer> {
  const nonce = Date.now();
  return hlExchange(network, action, nonce, await signL1Action(account, action, nonce, network));
}
