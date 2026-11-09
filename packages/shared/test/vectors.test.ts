import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import vectors from "./vectors.json";
import {
  aad, bytesToHex, encodeFireReport, commitmentOf, decodeFireReport, decodeHeartbeat, decodeOrder, encodeOrder, hexToBytes,
  openEnvelope, pad, reportSignedBytes, sealPadded, unpad, verifyReport, walletBindingMessage, type SealedOrder,
} from "../src/index.ts";

function toOrder(o: (typeof vectors.orders)[number]["order"]): SealedOrder {
  return {
    network: o.hl_network === 0 ? "mainnet" : "testnet",
    hlAddress: o.hl_address as `0x${string}`,
    coin: o.coin,
    side: o.position_side === 0 ? "long" : "short",
    kind: o.kind === 0 ? "stop_loss" : "take_profit",
    triggerPx: o.trigger_px,
    size: o.size,
    slippageBps: o.slippage_bps,
    confirmTicks: o.confirm_ticks,
    createdMs: BigInt(o.created_ms),
    salt: hexToBytes(o.salt),
    walletSig: hexToBytes(o.wallet_sig),
  };
}

describe("shared vectors (Rust ⇄ TypeScript)", () => {
  for (const c of vectors.orders) {
    it(`${c.name}: borsh, commitment, padding, envelope`, () => {
      const order = toOrder(c.order);
      const borsh = encodeOrder(order);
      expect(bytesToHex(borsh)).toBe(c.borsh);
      expect(decodeOrder(borsh)).toEqual(order);
      expect(bytesToHex(commitmentOf(borsh))).toBe(c.commitment);
      const padded = pad(borsh);
      expect(bytesToHex(padded)).toBe(c.padded);
      expect(bytesToHex(unpad(padded))).toBe(c.borsh);
      const a = aad(vectors.contract_id, vectors.owner, hexToBytes(c.commitment));
      expect(bytesToHex(a)).toBe(c.aad);
      const env = sealPadded(hexToBytes(vectors.enclave.x25519_public), padded, a, hexToBytes(vectors.ephemeral_secret), hexToBytes(vectors.nonce));
      expect(bytesToHex(env)).toBe(c.envelope);
      expect(bytesToHex(openEnvelope(hexToBytes(vectors.enclave.x25519_seed), env, a))).toBe(c.padded);
    });
  }

  it("the envelope does not open under another owner", () => {
    const c = vectors.orders[0]!;
    const wrong = aad(vectors.contract_id, "mallory.testnet", hexToBytes(c.commitment));
    expect(() => openEnvelope(hexToBytes(vectors.enclave.x25519_seed), hexToBytes(c.envelope), wrong)).toThrow();
  });

  it("wallet binding message and signature match Rust", async () => {
    const account = privateKeyToAccount(`0x${vectors.wallet.key}`);
    expect(account.address.toLowerCase()).toBe(vectors.wallet.address);
    for (const net of ["testnet", "mainnet"] as const) {
      const msg = walletBindingMessage(vectors.contract_id, vectors.owner, net);
      expect(msg).toBe(vectors.wallet[`binding_message_${net}`]);
      const sig = await account.signMessage({ message: msg });
      expect(sig.slice(2)).toBe(vectors.wallet[`binding_sig_${net}`]);
      expect((await recoverMessageAddress({ message: msg, signature: sig })).toLowerCase()).toBe(vectors.wallet.address);
    }
  });

  it("decodes and verifies enclave reports", () => {
    const pub = hexToBytes(vectors.enclave.ed25519_public);
    const f = vectors.reports.fire;
    const fb = hexToBytes(f.borsh);
    expect(bytesToHex(reportSignedBytes(0, fb))).toBe(f.signed_bytes);
    expect(verifyReport(0, fb, hexToBytes(f.sig), pub)).toBe(true);
    expect(verifyReport(1, fb, hexToBytes(f.sig), pub)).toBe(false);
    const fire = decodeFireReport(fb);
    expect(fire.orderId).toBe(BigInt(f.report.order_id));
    expect(fire.avgPx).toBe(f.report.avg_px);
    expect(fire.outcome).toBe("filled");
    expect(bytesToHex(encodeFireReport(fire))).toBe(f.borsh);
    const h = vectors.reports.heartbeat;
    expect(verifyReport(1, hexToBytes(h.borsh), hexToBytes(h.sig), pub)).toBe(true);
    expect(decodeHeartbeat(hexToBytes(h.borsh)).ordersSeen).toBe(h.report.orders_seen);
  });
});
