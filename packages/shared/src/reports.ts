/** Enclave reports (borsh) and their signatures, mirroring `enclave/core/src/report.rs`. */
import { ed25519 } from "@noble/curves/ed25519";
import { BorshReader, bytesToHex, concatBytes, utf8 } from "./bytes.ts";

export const REPORT_DOMAIN = utf8("blindstop:v1:report");
export const REPORT_KIND_FIRE = 0;
export const REPORT_KIND_HEARTBEAT = 1;

export const OUTCOMES = ["filled", "no_position", "rejected", "invalid"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface FireReport {
  contractId: string;
  orderId: bigint;
  commitment: string;
  hlCloid: string;
  hlOid: bigint;
  avgPx: string;
  filledSz: string;
  outcome: Outcome;
  tsMs: bigint;
}

export interface Heartbeat {
  contractId: string;
  tickMs: bigint;
  ordersSeen: number;
  codeHash: string;
}

export function decodeFireReport(b: Uint8Array): FireReport {
  const r = new BorshReader(b);
  const out: FireReport = {
    contractId: r.string(),
    orderId: r.u64(),
    commitment: bytesToHex(r.fixed(32)),
    hlCloid: bytesToHex(r.fixed(16)),
    hlOid: r.u64(),
    avgPx: r.string(),
    filledSz: r.string(),
    outcome: OUTCOMES[r.u8()] ?? (() => { throw new Error("unknown outcome"); })(),
    tsMs: r.u64(),
  };
  r.end();
  return out;
}

export function decodeHeartbeat(b: Uint8Array): Heartbeat {
  const r = new BorshReader(b);
  const out: Heartbeat = { contractId: r.string(), tickMs: r.u64(), ordersSeen: r.u32(), codeHash: bytesToHex(r.fixed(32)) };
  r.end();
  return out;
}

export function reportSignedBytes(kind: number, borsh: Uint8Array): Uint8Array {
  return concatBytes(REPORT_DOMAIN, Uint8Array.of(kind), borsh);
}

export function verifyReport(kind: number, borsh: Uint8Array, sig: Uint8Array, enclaveEd25519: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, reportSignedBytes(kind, borsh), enclaveEd25519);
  } catch {
    return false;
  }
}
