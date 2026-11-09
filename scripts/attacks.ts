/**
 * Live attacks against the DEPLOYED contract and the REAL enclave on OutLayer.
 *
 *   OUTLAYER_PAYMENT_KEY=… node scripts/attacks.ts            (from the repo root)
 *
 * Needs two funded testnet accounts with keys in ~/.near-credentials/testnet/
 * (ALICE, default blindstop-alice.testnet; MALLORY, default blindstop-mallory.testnet) and an
 * OutLayer payment key owned by the project's operator. Prints `ok` per attack and
 * `ALL ATTACKS REFUSED` at the end; exits non-zero on the first attack that is not refused.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519";
import {
  base64ToBytes,
  blindstopViews,
  bytesToBase64,
  bytesToHex,
  decodeFireReport,
  encodeFireReport,
  hexToBytes,
  NearSigner,
  parseNearSecretKey,
  PLACE_ORDER_DEPOSIT_YOCTO,
  REVEAL_DEPOSIT_YOCTO,
  reportSignedBytes,
  sealOrder,
  verifyReport,
  walletBindingMessage,
  type EnclaveKeys,
  type SealedOrder,
} from "@blindstop/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NETWORK = "testnet";
const CONTRACT = process.env.BLINDSTOP_CONTRACT ?? "blindstop.testnet";
const PROJECT = process.env.OUTLAYER_PROJECT ?? "blindstop-watch.testnet/blindstop-watcher";
const OUTLAYER_API = process.env.OUTLAYER_API ?? "https://testnet-api.outlayer.ai";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
const PAYMENT_KEY = process.env.OUTLAYER_PAYMENT_KEY;
if (!PAYMENT_KEY) throw new Error("set OUTLAYER_PAYMENT_KEY (owner:nonce:secret, owned by the operator account)");

const signerFor = (account: string) => {
  const f = join(homedir(), ".near-credentials", NETWORK, `${account}.json`);
  const sk = (JSON.parse(readFileSync(f, "utf8")) as { private_key: string }).private_key;
  return new NearSigner(parseNearSecretKey(account, sk), RPCS);
};

const ALICE = process.env.ALICE ?? "blindstop-alice.testnet";
const MALLORY = process.env.MALLORY ?? "blindstop-mallory.testnet";
const alice = signerFor(ALICE);
const mallory = signerFor(MALLORY);
const views = blindstopViews(RPCS, CONTRACT);

let passed = 0;
function ok(n: number, what: string, evidence: string) {
  passed++;
  console.log(`ok  ${n}. ${what}\n      ${evidence}`);
}
function fail(n: number, what: string, detail: string): never {
  console.log(`FAIL ${n}. ${what}\n      ${detail}`);
  process.exit(1);
}

type Report = { kind: number; order_id?: string; report: string; sig: string };
async function tick(input: Record<string, unknown>): Promise<{ ok: boolean; reports?: Report[]; error?: string; call_id?: string }> {
  const [owner, name] = PROJECT.split("/");
  const res = await fetch(`${OUTLAYER_API}/call/${owner}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment-key": PAYMENT_KEY! },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = (await res.json()) as { output?: unknown; call_id?: string; error?: string };
  if (!res.ok || body.error) throw new Error(`outlayer: ${res.status} ${body.error ?? ""}`);
  const out = (typeof body.output === "string" ? JSON.parse(body.output) : body.output) as { ok: boolean; reports?: Report[]; error?: string };
  return { ...out, call_id: body.call_id };
}

async function place(signer: NearSigner, envelope: Uint8Array, commitment: Uint8Array): Promise<string> {
  const r = await signer.call(CONTRACT, "place_order", { ciphertext: bytesToBase64(envelope), commitment: bytesToHex(commitment) }, 50_000_000_000_000n, PLACE_ORDER_DEPOSIT_YOCTO);
  if (!r.ok) throw new Error(`place_order failed: ${r.failure}`);
  const ev = r.logs.find((l) => l.includes('"order_placed"'));
  const id = ev && (JSON.parse(ev.slice("EVENT_JSON:".length)) as { data: { order_id: string }[] }).data[0]!.order_id;
  if (!id) throw new Error("no order_placed event");
  return id;
}

async function draft(wallet: ReturnType<typeof privateKeyToAccount>, owner: string, signer: ReturnType<typeof privateKeyToAccount>, kind: SealedOrder["kind"], trigger: string): Promise<SealedOrder> {
  return {
    network: NETWORK,
    hlAddress: wallet.address,
    coin: "BTC",
    side: "long",
    kind,
    triggerPx: trigger,
    size: "ALL",
    slippageBps: 100,
    confirmTicks: 1,
    createdMs: BigInt(Date.now()),
    salt: crypto.getRandomValues(new Uint8Array(32)),
    walletSig: hexToBytes(await signer.signMessage({ message: walletBindingMessage(CONTRACT, owner, NETWORK) })),
  };
}

async function main() {
  const keys: EnclaveKeys = await views.getEnclaveKeys();
  const xpub = hexToBytes(keys.enclave_x25519);
  const edpub = hexToBytes(keys.enclave_ed25519);
  console.log(`# contract ${CONTRACT} · enclave ${PROJECT} · ed25519 ${keys.enclave_ed25519.slice(0, 16)}…\n`);

  // Throwaway Hyperliquid testnet wallets with no positions: nothing real can be closed.
  const aliceWallet = privateKeyToAccount(generatePrivateKey());
  const malloryWallet = privateKeyToAccount(generatePrivateKey());

  // P: Alice's armed stop that never fires (long BTC stop-loss at 1).
  const P = sealOrder(await draft(aliceWallet, ALICE, aliceWallet, "stop_loss", "1"), xpub, CONTRACT, ALICE);
  const pId = await place(alice, P.envelope, P.commitment);
  // Q: Alice's take-profit at 1 (always crossed); her wallet has no position → enclave reports no_position.
  const Q = sealOrder(await draft(aliceWallet, ALICE, aliceWallet, "take_profit", "1"), xpub, CONTRACT, ALICE);
  const qId = await place(alice, Q.envelope, Q.commitment);
  // M: Mallory copies Alice's ciphertext and commitment into an order of her own.
  const mId = await place(mallory, P.envelope, P.commitment);
  // V: Mallory names Alice's trading wallet, signing the binding with her own key.
  const V = sealOrder(await draft(aliceWallet, MALLORY, malloryWallet, "take_profit", "1"), xpub, CONTRACT, MALLORY);
  const vId = await place(mallory, V.envelope, V.commitment);
  console.log(`# placed P=${pId} (Alice, armed) Q=${qId} (Alice, crossed) M=${mId} (Mallory's copy of P) V=${vId} (Mallory → Alice's wallet)\n`);

  // Ticks carry fake prices and orders; the enclave must act on NEAR + Hyperliquid only.
  const fake = { op: "tick", marks: { BTC: "0.5" }, prices: { BTC: "0.5" }, orders: [{ id: pId, coin: "BTC", trigger_px: "999999999" }] };
  const want = new Set([qId, mId, vId]);
  const got = new Map<string, Report>();
  let lastCall = "";
  for (let i = 0; i < 15 && [...want].some((w) => !got.has(w)); i++) {
    const t = await tick(fake);
    if (!t.ok) throw new Error(`enclave refused: ${t.error}`);
    lastCall = t.call_id ?? "";
    for (const r of t.reports ?? []) if (r.order_id) got.set(r.order_id, r);
    if (got.has(pId)) fail(4, "fake prices in the keeper's input are ignored", `the enclave reported on order ${pId}, which only fake prices could trigger`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  for (const w of want) if (!got.has(w)) throw new Error(`no report for order ${w} after 15 ticks`);
  const outcome = (id: string) => decodeFireReport(base64ToBytes(got.get(id)!.report)).outcome;
  for (const id of want) if (!verifyReport(0, base64ToBytes(got.get(id)!.report), base64ToBytes(got.get(id)!.sig), edpub)) throw new Error("enclave report does not verify");
  if (outcome(qId) !== "no_position") throw new Error(`Q: expected no_position, got ${outcome(qId)}`);

  // 1. Forged signature
  const forgedKey = ed25519.utils.randomPrivateKey();
  const forged = encodeFireReport({ contractId: CONTRACT, orderId: BigInt(pId), commitment: bytesToHex(P.commitment), hlCloid: "00".repeat(16), hlOid: 1n, avgPx: "1", filledSz: "1", outcome: "filled", tsMs: BigInt(Date.now()) });
  let r = await mallory.call(CONTRACT, "record_fire", { report: bytesToBase64(forged), sig: bytesToBase64(ed25519.sign(reportSignedBytes(0, forged), forgedKey)) });
  if (r.ok) fail(1, "forged fire report", `accepted! tx ${r.hash}`);
  ok(1, "forged fire report signature → refused", `${r.failure} (tx ${r.hash})`);

  // 3. A valid enclave report for order Q, re-addressed to order P
  const qReport = decodeFireReport(base64ToBytes(got.get(qId)!.report));
  const readdressed = encodeFireReport({ ...qReport, orderId: BigInt(pId) });
  r = await mallory.call(CONTRACT, "record_fire", { report: bytesToBase64(readdressed), sig: got.get(qId)!.sig });
  if (r.ok) fail(3, "report for order Q submitted as order P", `accepted! tx ${r.hash}`);
  ok(3, "valid report for one order submitted as another → refused", `${r.failure} (tx ${r.hash})`);

  // The genuine report settles Q — submitted by Mallory: anyone may relay an enclave report.
  r = await mallory.call(CONTRACT, "record_fire", { report: got.get(qId)!.report, sig: got.get(qId)!.sig });
  if (!r.ok) throw new Error(`genuine report refused: ${r.failure}`);
  console.log(`    (genuine enclave report for Q settled by a third party: tx ${r.hash})`);

  // 2. Replay
  r = await mallory.call(CONTRACT, "record_fire", { report: got.get(qId)!.report, sig: got.get(qId)!.sig });
  if (r.ok) fail(2, "replayed report", `accepted twice! tx ${r.hash}`);
  ok(2, "valid report replayed → refused", `${r.failure} (tx ${r.hash})`);

  // 4. Fake input
  ok(4, "keeper input with fake prices and orders → ignored", `order ${pId} (armed at 1) never reported across every tick; enclave call ${lastCall}`);

  // 5. RPC disagreement (cannot be staged against public RPCs; run against the real wasm)
  if (process.argv.includes("--skip-harness")) console.log("--  5. NEAR RPC disagreement: skipped (--skip-harness)");
  else {
    const h = spawnSync("scripts/harness.sh", [], { cwd: join(import.meta.dirname, ".."), encoding: "utf8" });
    if (!/ok - NEAR RPC B hides an order: the enclave refuses to act at all/.test(h.stdout ?? "")) fail(5, "RPC disagreement", h.stdout + h.stderr);
    ok(5, "NEAR RPCs disagree → enclave refuses to act", "real wasm under enclave/harness with RPC B hiding an order");
  }

  // 6. Tampered AAD: Alice's ciphertext under Mallory's account
  if (outcome(mId) !== "invalid") fail(6, "ciphertext moved to another owner", `enclave reported ${outcome(mId)}`);
  r = await mallory.call(CONTRACT, "record_fire", { report: got.get(mId)!.report, sig: got.get(mId)!.sig });
  ok(6, "Alice's ciphertext replayed under Mallory's account → enclave refuses to decrypt", `order ${mId} retired as invalid (tx ${r.hash})`);

  // 9. Mallory's order naming Alice's wallet
  if (outcome(vId) !== "invalid") fail(9, "order for someone else's wallet", `enclave reported ${outcome(vId)}`);
  r = await mallory.call(CONTRACT, "record_fire", { report: got.get(vId)!.report, sig: got.get(vId)!.sig });
  ok(9, "order naming another user's trading wallet → retired as invalid, never sent", `order ${vId} (tx ${r.hash})`);

  // 7. Non-owner cancel and reveal
  r = await mallory.call(CONTRACT, "cancel_order", { order_id: pId });
  if (r.ok) fail(7, "non-owner cancel", `accepted! tx ${r.hash}`);
  const r2 = await mallory.call(CONTRACT, "reveal", { order_id: qId, plaintext: bytesToBase64(Q.plaintext) }, 50_000_000_000_000n, REVEAL_DEPOSIT_YOCTO);
  if (r2.ok) fail(7, "non-owner reveal", `accepted! tx ${r2.hash}`);
  ok(7, "non-owner cancel and reveal → refused", `${r.failure} / ${r2.failure}`);

  // 8. Wrong preimage, then the right one
  const wrong = Q.plaintext.slice();
  wrong[40] = wrong[40]! ^ 1;
  r = await alice.call(CONTRACT, "reveal", { order_id: qId, plaintext: bytesToBase64(wrong) }, 50_000_000_000_000n, REVEAL_DEPOSIT_YOCTO);
  if (r.ok) fail(8, "wrong preimage", `accepted! tx ${r.hash}`);
  const good = await alice.call(CONTRACT, "reveal", { order_id: qId, plaintext: bytesToBase64(Q.plaintext) }, 50_000_000_000_000n, REVEAL_DEPOSIT_YOCTO);
  if (!good.ok) throw new Error(`owner's correct reveal refused: ${good.failure}`);
  ok(8, "reveal with a wrong preimage → refused (the right one is accepted)", `${r.failure}; correct reveal tx ${good.hash}`);

  // Clean up the armed order.
  await alice.call(CONTRACT, "cancel_order", { order_id: pId });

  console.log(`\n${passed} attacks, all refused. Revealed order ${qId} can be checked on /verify.`);
  console.log("ALL ATTACKS REFUSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
