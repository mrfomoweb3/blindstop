/**
 * The sealed order (plaintext v1). Byte-identical to `enclave/core/src/order.rs`;
 * `test/vectors.json` pins both.
 */
import { sha256 } from "@noble/hashes/sha2";
import { BorshReader, BorshWriter, bytesToHex, concatBytes, hexToBytes, utf8 } from "./bytes.ts";
import { isPlainDecimal } from "./decimal.ts";

export const ORDER_VERSION = 1;
export const PADDED_LEN = 256;
export const COMMITMENT_DOMAIN = utf8("blindstop:v1:order");
export const MAX_COIN_LEN = 16;
export const MAX_DECIMAL_LEN = 24;
export const MAX_SLIPPAGE_BPS = 1000;
export const MAX_CONFIRM_TICKS = 10;
export const SIZE_ALL = "ALL";

export type HlNetwork = "mainnet" | "testnet";
export type PositionSide = "long" | "short";
export type OrderKind = "stop_loss" | "take_profit";

export interface SealedOrder {
  network: HlNetwork;
  /** 0x-prefixed trading wallet address */
  hlAddress: `0x${string}`;
  coin: string;
  side: PositionSide;
  kind: OrderKind;
  triggerPx: string;
  /** decimal string or "ALL" */
  size: string;
  slippageBps: number;
  confirmTicks: number;
  createdMs: bigint;
  /** 32 bytes */
  salt: Uint8Array;
  /** 65-byte EIP-191 signature by hlAddress over walletBindingMessage(...) */
  walletSig: Uint8Array;
}

export function validateOrder(o: SealedOrder): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(o.hlAddress)) throw new Error("trading wallet address is not a 20-byte hex address");
  if (!o.coin || o.coin.length > MAX_COIN_LEN || !/^[A-Za-z0-9]+$/.test(o.coin)) throw new Error("coin must be a main-dex perp name");
  if (o.triggerPx.length > MAX_DECIMAL_LEN || !isPlainDecimal(o.triggerPx) || /^0*(\.0*)?$/.test(o.triggerPx))
    throw new Error("trigger price must be a positive decimal");
  if (o.size !== SIZE_ALL && (o.size.length > MAX_DECIMAL_LEN || !isPlainDecimal(o.size) || /^0*(\.0*)?$/.test(o.size)))
    throw new Error('size must be a positive decimal or "ALL"');
  if (!Number.isInteger(o.slippageBps) || o.slippageBps < 1 || o.slippageBps > MAX_SLIPPAGE_BPS) throw new Error("slippage must be 1–1000 bps");
  if (!Number.isInteger(o.confirmTicks) || o.confirmTicks < 1 || o.confirmTicks > MAX_CONFIRM_TICKS) throw new Error("confirm ticks must be 1–10");
  if (o.salt.length !== 32) throw new Error("salt must be 32 bytes");
  if (o.walletSig.length !== 65) throw new Error("wallet signature must be 65 bytes");
}

export function encodeOrder(o: SealedOrder): Uint8Array {
  validateOrder(o);
  return new BorshWriter()
    .u8(ORDER_VERSION)
    .u8(o.network === "mainnet" ? 0 : 1)
    .fixed(hexToBytes(o.hlAddress), 20)
    .string(o.coin)
    .u8(o.side === "long" ? 0 : 1)
    .u8(o.kind === "stop_loss" ? 0 : 1)
    .string(o.triggerPx)
    .string(o.size)
    .u16(o.slippageBps)
    .u8(o.confirmTicks)
    .u64(o.createdMs)
    .fixed(o.salt, 32)
    .fixed(o.walletSig, 65)
    .bytes();
}

export function decodeOrder(b: Uint8Array): SealedOrder {
  const r = new BorshReader(b);
  const version = r.u8();
  if (version !== ORDER_VERSION) throw new Error(`unsupported order version ${version}`);
  const net = r.u8();
  const o: SealedOrder = {
    network: net === 0 ? "mainnet" : "testnet",
    hlAddress: `0x${bytesToHex(r.fixed(20))}`,
    coin: r.string(),
    side: r.u8() === 0 ? "long" : "short",
    kind: r.u8() === 0 ? "stop_loss" : "take_profit",
    triggerPx: r.string(),
    size: r.string(),
    slippageBps: r.u16(),
    confirmTicks: r.u8(),
    createdMs: r.u64(),
    salt: r.fixed(32),
    walletSig: r.fixed(65),
  };
  r.end();
  if (net > 1) throw new Error("unknown network");
  return o;
}

export function commitmentOf(orderBorsh: Uint8Array): Uint8Array {
  return sha256(concatBytes(COMMITMENT_DOMAIN, orderBorsh));
}

export function pad(orderBorsh: Uint8Array): Uint8Array {
  if (orderBorsh.length > PADDED_LEN - 2) throw new Error("order too large to seal");
  const out = new Uint8Array(PADDED_LEN);
  out[0] = orderBorsh.length & 0xff;
  out[1] = orderBorsh.length >> 8;
  out.set(orderBorsh, 2);
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length !== PADDED_LEN) throw new Error("padded plaintext has the wrong length");
  const len = padded[0]! | (padded[1]! << 8);
  if (len > PADDED_LEN - 2) throw new Error("length prefix out of range");
  for (let i = 2 + len; i < PADDED_LEN; i++) if (padded[i] !== 0) throw new Error("non-zero padding");
  return padded.slice(2, 2 + len);
}

/** What the trading wallet signs (EIP-191) so this NEAR account's sealed stops may act on it. */
export function walletBindingMessage(contractId: string, owner: string, network: HlNetwork): string {
  return `Blindstop: allow sealed stops placed by NEAR account ${owner} on contract ${contractId} to close positions of this Hyperliquid wallet on ${
    network === "mainnet" ? "Mainnet" : "Testnet"
  }.\n\nThis signature cannot move funds.`;
}
