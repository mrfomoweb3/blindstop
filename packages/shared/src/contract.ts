/** The Blindstop NEAR contract: view calls over JSON-RPC, and its JSON shapes. */
import { base64ToBytes, bytesToBase64, utf8 } from "./bytes.ts";

export type Status = "Active" | "Fired" | "Cancelled" | "Skipped" | "Rejected" | "Invalid";

export interface ActiveOrderRow {
  id: string;
  owner: string;
  ciphertext: string;
  commitment: string;
}

export interface FireReportView {
  order_id: string;
  hl_cloid: string;
  hl_oid: string;
  avg_px: string;
  filled_sz: string;
  outcome: number;
  ts_ms: string;
}

export interface RevealedOrderView {
  hl_network: "mainnet" | "testnet";
  hl_address: string;
  coin: string;
  position_side: "long" | "short";
  kind: "stop_loss" | "take_profit";
  trigger_px: string;
  size: string;
  slippage_bps: number;
  confirm_ticks: number;
  created_ms: string;
}

export interface OrderView {
  id: string;
  owner: string;
  commitment: string;
  status: Status;
  created_ns: string;
  created_height: string;
  closed_ns: string | null;
  fire: FireReportView | null;
  revealed: string | null;
  revealed_order: RevealedOrderView | null;
  key_epoch: number;
}

export interface EnclaveKeys {
  enclave_ed25519: string;
  enclave_x25519: string;
  agent_address: `0x${string}`;
  key_epoch: number;
}

export interface HeartbeatView {
  tick_ms: string;
  orders_seen: number;
  code_hash: string;
}

export interface ConfigView {
  owner: string;
  paused: boolean;
  max_active_per_owner: number;
  next_id: string;
  ciphertext_len: number;
  storage_byte_cost: string;
}

export class RpcError extends Error {}

/** Calls the first RPC that answers; rotates on network errors and 429s. */
export async function viewCall<T>(rpcs: string[], contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let last: unknown;
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "blindstop",
          method: "query",
          params: { request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64: bytesToBase64(utf8(JSON.stringify(args))) },
        }),
      });
      if (res.status === 429 || res.status >= 500) throw new RpcError(`${rpc}: HTTP ${res.status}`);
      const j = (await res.json()) as { error?: unknown; result?: { result?: number[]; error?: string } };
      if (j.error) throw new RpcError(`${rpc}: ${JSON.stringify(j.error).slice(0, 300)}`);
      if (j.result?.error) throw new Error(j.result.error);
      const bytes = Uint8Array.from(j.result?.result ?? []);
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch (e) {
      last = e;
      if (!(e instanceof RpcError) && !(e instanceof TypeError)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error("no RPC answered");
}

export function blindstopViews(rpcs: string[], contractId: string) {
  return {
    getEnclaveKeys: () => viewCall<EnclaveKeys>(rpcs, contractId, "get_enclave_keys"),
    getHeartbeat: () => viewCall<HeartbeatView | null>(rpcs, contractId, "get_heartbeat"),
    getConfig: () => viewCall<ConfigView>(rpcs, contractId, "get_config"),
    getOrder: (id: string) => viewCall<OrderView | null>(rpcs, contractId, "get_order", { order_id: id }),
    getOrdersByOwner: (owner: string, from_index = 0, limit = 50) =>
      viewCall<OrderView[]>(rpcs, contractId, "get_orders_by_owner", { owner, from_index, limit }),
    getActive: (from_index = 0, limit = 100) => viewCall<ActiveOrderRow[]>(rpcs, contractId, "get_active", { from_index, limit }),
    getActiveCount: () => viewCall<number>(rpcs, contractId, "get_active_count"),
  };
}

export const ciphertextBytes = (row: ActiveOrderRow) => base64ToBytes(row.ciphertext);

/** Storage the contract charges per order: generous upper bound; the unused part is refunded. */
export const PLACE_ORDER_DEPOSIT_YOCTO = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
export const REVEAL_DEPOSIT_YOCTO = 5_000_000_000_000_000_000_000n; // 0.005 NEAR
