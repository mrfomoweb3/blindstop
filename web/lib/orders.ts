"use client";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  formatDec,
  hexToBytes,
  mulRatio,
  parseDec,
  parseSignedDec,
  PLACE_ORDER_DEPOSIT_YOCTO,
  placeBackstop,
  roundPerpPx,
  roundSizeDown,
  sealOrder,
  walletBindingMessage,
  type EnclaveKeys,
  type HlNetwork,
  type OrderKind,
  type OrderView,
  type PerpAsset,
  type PositionSide,
  type SealedOrder,
} from "@blindstop/shared";
import type { PrivateKeyAccount } from "viem/accounts";
import { CONTRACT } from "./config";
import type { CallResult } from "./near";
import * as vault from "./vault";

/** The trading wallet's signature letting `owner`'s sealed orders act on it. Signed once, cached. */
export async function bindingSignature(account: PrivateKeyAccount, owner: string, network: HlNetwork): Promise<Uint8Array> {
  const pref = `binding:${CONTRACT}:${owner}:${network}:${account.address.toLowerCase()}`;
  const cached = await vault.getPref<string>(pref);
  if (cached) return hexToBytes(cached);
  const sig = await account.signMessage({ message: walletBindingMessage(CONTRACT, owner, network) });
  await vault.setPref(pref, sig);
  return hexToBytes(sig);
}

export interface Draft {
  coin: string;
  side: PositionSide;
  kind: OrderKind;
  triggerPx: string;
  size: string;
  slippageBps: number;
  confirmTicks: number;
}

export async function sealAndPlace(p: {
  drafts: Draft[];
  account: PrivateKeyAccount;
  vaultKey: CryptoKey;
  owner: string;
  network: HlNetwork;
  keys: EnclaveKeys;
  callBatch: (calls: { method: string; args: Record<string, unknown>; depositYocto?: bigint }[]) => Promise<CallResult>;
}): Promise<{ txHash: string | null; commitments: string[] }> {
  const walletSig = await bindingSignature(p.account, p.owner, p.network);
  const enclavePub = hexToBytes(p.keys.enclave_x25519);
  const sealed = p.drafts.map((d) => {
    const order: SealedOrder = {
      network: p.network,
      hlAddress: p.account.address,
      coin: d.coin,
      side: d.side,
      kind: d.kind,
      triggerPx: d.triggerPx,
      size: d.size,
      slippageBps: d.slippageBps,
      confirmTicks: d.confirmTicks,
      createdMs: BigInt(Date.now()),
      salt: crypto.getRandomValues(new Uint8Array(32)),
      walletSig,
    };
    return { d, ...sealOrder(order, enclavePub, CONTRACT, p.owner) };
  });

  // The plaintext is written down BEFORE the transaction: a wallet that redirects away must not
  // lose the only copy needed to reveal later.
  for (const s of sealed) {
    await vault.saveOrder(p.vaultKey, {
      contract: CONTRACT,
      owner: p.owner,
      commitment: bytesToHex(s.commitment),
      plaintext: bytesToBase64(s.plaintext),
      orderId: null,
      network: p.network,
      coin: s.d.coin,
      side: s.d.side,
      kind: s.d.kind,
      triggerPx: s.d.triggerPx,
      size: s.d.size,
      slippageBps: s.d.slippageBps,
      createdAt: Date.now(),
      keyEpoch: p.keys.key_epoch,
      placeTx: null,
    });
  }

  const res = await p.callBatch(
    sealed.map((s) => ({
      method: "place_order",
      args: { ciphertext: bytesToBase64(s.envelope), commitment: bytesToHex(s.commitment) },
      depositYocto: PLACE_ORDER_DEPOSIT_YOCTO,
    })),
  );
  return { txHash: res.txHash, commitments: sealed.map((s) => bytesToHex(s.commitment)) };
}

/** Attach on-chain ids (and the place tx, when known) to local records, matched by commitment. */
export async function reconcile(vaultKey: CryptoKey, locals: vault.LocalOrder[], chain: OrderView[], txHash?: string | null): Promise<boolean> {
  let changed = false;
  for (const l of locals) {
    if (l.orderId) continue;
    const c = chain.find((o) => o.commitment === l.commitment);
    if (!c) continue;
    await vault.saveOrder(vaultKey, { ...l, orderId: c.id, placeTx: l.placeTx ?? txHash ?? null });
    changed = true;
  }
  return changed;
}

/** The public backstop: a reduce-only stop-market near liquidation, with the user's own key. */
export function backstopFor(position: { szi: string; liquidationPx: string | null }, asset: PerpAsset) {
  if (!position.liquidationPx || !asset.markPx) return null;
  const szi = parseSignedDec(position.szi);
  const isLong = szi > 0n;
  const size = roundSizeDown(isLong ? szi : -szi, asset.szDecimals);
  if (size === 0n) return null;
  const liq = parseDec(position.liquidationPx);
  const mark = parseDec(asset.markPx);
  // 15% of the way from liquidation back toward the mark: fires just before liquidation would.
  const dist = isLong ? mark - liq : liq - mark;
  if (dist <= 0n) return null;
  const off = (dist * 15n) / 100n;
  const trigger = roundPerpPx(isLong ? liq + off : liq - off, asset.szDecimals, isLong ? "up" : "down");
  const limit = roundPerpPx(
    isLong ? mulRatio(trigger, 9000n, 10_000n, "down") : mulRatio(trigger, 11_000n, 10_000n, "up"),
    asset.szDecimals,
    isLong ? "down" : "up",
  );
  return { asset: asset.index, closeIsBuy: !isLong, triggerPx: formatDec(trigger), limitPx: formatDec(limit), size: formatDec(size) };
}

export async function placePublicBackstop(account: PrivateKeyAccount, network: HlNetwork, b: NonNullable<ReturnType<typeof backstopFor>>) {
  return placeBackstop(account, network, b);
}

export const plaintextBytes = (o: vault.LocalOrder) => base64ToBytes(o.plaintext);
