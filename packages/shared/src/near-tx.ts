/**
 * Minimal NEAR transaction signing for server-side callers (keeper, scripts): FunctionCall
 * only, ed25519 keys only. Layout per nearcore `Transaction` (V0) borsh:
 *   signer_id ‖ public_key(0 ‖ 32) ‖ nonce u64 ‖ receiver_id ‖ block_hash[32] ‖ actions
 *   Action::FunctionCall = 2 ‖ method_name ‖ args(Vec<u8>) ‖ gas u64 ‖ deposit u128
 *   SignedTransaction = transaction ‖ signature(0 ‖ 64), signed over sha256(transaction)
 */
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { BorshWriter, bytesToBase64, concatBytes, utf8 } from "./bytes.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("invalid base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = "1" + s;
  }
  return s;
}

export interface NearKey {
  accountId: string;
  /** 32-byte ed25519 seed */
  seed: Uint8Array;
  publicKey: Uint8Array;
}

/** Parses `ed25519:<base58 64-byte secret>` (near-cli format: seed ‖ public key). */
export function parseNearSecretKey(accountId: string, secret: string): NearKey {
  const [curve, data] = secret.split(":");
  if (curve !== "ed25519" || !data) throw new Error("only ed25519:<base58> keys are supported");
  const raw = base58Decode(data);
  if (raw.length !== 64 && raw.length !== 32) throw new Error("ed25519 secret must be 32 or 64 bytes");
  const seed = raw.slice(0, 32);
  const publicKey = ed25519.getPublicKey(seed);
  if (raw.length === 64 && bytesToBase64(raw.slice(32)) !== bytesToBase64(publicKey)) throw new Error("secret key and public key disagree");
  return { accountId, seed, publicKey };
}

export const publicKeyString = (k: NearKey) => `ed25519:${base58Encode(k.publicKey)}`;

export interface FunctionCall {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  depositYocto: bigint;
}

export function u128le(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}

export function serializeTransaction(p: {
  signerId: string;
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  actions: FunctionCall[];
}): Uint8Array {
  const w = new BorshWriter()
    .string(p.signerId)
    .u8(0)
    .fixed(p.publicKey, 32)
    .u64(p.nonce)
    .string(p.receiverId)
    .fixed(p.blockHash, 32)
    .u32(p.actions.length);
  const parts = [w.bytes()];
  for (const a of p.actions) {
    const head = new BorshWriter().u8(2).string(a.methodName).u32(a.args.length).bytes();
    parts.push(head, a.args, new BorshWriter().u64(a.gas).bytes(), u128le(a.depositYocto));
  }
  return concatBytes(...parts);
}

export function signTransaction(key: NearKey, tx: Uint8Array): { signed: Uint8Array; hash: Uint8Array } {
  const hash = sha256(tx);
  const sig = ed25519.sign(hash, key.seed);
  return { signed: concatBytes(tx, Uint8Array.of(0), sig), hash };
}

export class NearRpcError extends Error {
  readonly data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.data = data;
  }
}

export async function rpc<T>(url: string, method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "blindstop", method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new NearRpcError(`${url}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown; cause?: unknown } };
  if (j.error) throw new NearRpcError(JSON.stringify(j.error).slice(0, 500), j.error);
  return j.result as T;
}

export interface TxOutcome {
  hash: string;
  ok: boolean;
  /** Contract panic message when the call failed. */
  failure?: string;
  logs: string[];
}

/** Signs and sends function calls with a locally tracked nonce; refreshes it when NEAR says so. */
export class NearSigner {
  private nonce: bigint | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  readonly key: NearKey;
  readonly rpcs: string[];

  constructor(key: NearKey, rpcs: string[]) {
    this.key = key;
    this.rpcs = rpcs;
  }

  private async withRpc<T>(f: (url: string) => Promise<T>): Promise<T> {
    let last: unknown;
    for (const url of this.rpcs) {
      try {
        return await f(url);
      } catch (e) {
        last = e;
        // A contract-level failure is an answer, not a transport problem.
        if (e instanceof NearRpcError && /InvalidNonce|InvalidTxError|ActionError/.test(e.message)) throw e;
      }
    }
    throw last;
  }

  private async refreshNonce(): Promise<void> {
    const ak = await this.withRpc((url) =>
      rpc<{ nonce: number | string }>(url, "query", {
        request_type: "view_access_key",
        finality: "final",
        account_id: this.key.accountId,
        public_key: publicKeyString(this.key),
      }),
    );
    this.nonce = BigInt(ak.nonce);
  }

  /** Serialized per signer so nonces never race. */
  call(receiverId: string, methodName: string, args: unknown, gas = 30_000_000_000_000n, depositYocto = 0n): Promise<TxOutcome> {
    const run = this.queue.then(() => this.send(receiverId, { methodName, args: utf8(JSON.stringify(args)), gas, depositYocto }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(receiverId: string, action: FunctionCall, retried = false): Promise<TxOutcome> {
    if (this.nonce === null) await this.refreshNonce();
    const block = await this.withRpc((url) => rpc<{ header: { hash: string } }>(url, "block", { finality: "final" }));
    this.nonce = this.nonce! + 1n;
    const tx = serializeTransaction({
      signerId: this.key.accountId,
      publicKey: this.key.publicKey,
      nonce: this.nonce,
      receiverId,
      blockHash: base58Decode(block.header.hash),
      actions: [action],
    });
    const { signed, hash } = signTransaction(this.key, tx);
    try {
      type Outcome = {
        status: { SuccessValue?: string; Failure?: unknown };
        receipts_outcome: { outcome: { logs: string[]; status: { Failure?: unknown } } }[];
        transaction_outcome: { outcome: { logs: string[] } };
      };
      const r = await this.withRpc((url) =>
        rpc<Outcome>(url, "send_tx", { signed_tx_base64: bytesToBase64(signed), wait_until: "EXECUTED_OPTIMISTIC" }, 60_000),
      );
      const logs = [...r.transaction_outcome.outcome.logs, ...r.receipts_outcome.flatMap((x) => x.outcome.logs)];
      const failure = r.status.Failure ?? r.receipts_outcome.find((x) => x.outcome.status.Failure)?.outcome.status.Failure;
      return { hash: base58Encode(hash), ok: !failure, failure: failure ? panicMessage(failure) : undefined, logs };
    } catch (e) {
      if (!retried && e instanceof NearRpcError && /InvalidNonce/.test(e.message)) {
        await this.refreshNonce();
        return this.send(receiverId, action, true);
      }
      throw e;
    }
  }
}

function panicMessage(failure: unknown): string {
  const s = JSON.stringify(failure);
  const m = /"ExecutionError":"((?:[^"\\]|\\.)*)"/.exec(s);
  return m ? m[1]!.replace(/^Smart contract panicked: /, "") : s.slice(0, 300);
}
