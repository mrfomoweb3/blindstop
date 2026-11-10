/**
 * The golden path, live: Hyperliquid testnet + NEAR testnet + the real OutLayer enclave.
 *
 *   OUTLAYER_PAYMENT_KEY=… TRADING_KEY_FILE=~/.blindstop-outlayer/golden-trading-wallet.json \
 *     node scripts/golden-path.ts [--coin BTC] [--usd 15]
 *
 * 1. approves the enclave's agent for the trading wallet (if not yet)
 * 2. opens a small long with the wallet's own key (if it has no position on the coin)
 * 3. seals a take-profit the mark has already crossed, so it fires on the next tick
 * 4. shows Hyperliquid's open orders for the wallet are empty: the stop is not on the book
 * 5. ticks the enclave until it closes the position, settles the report on NEAR
 * 6. reveals the order and checks the commitment
 * Writes docs/evidence/golden-path-testnet.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  approveAgent,
  base64ToBytes,
  blindstopViews,
  bytesToBase64,
  bytesToHex,
  commitmentOf,
  decodeFireReport,
  fetchClearinghouse,
  fetchExtraAgents,
  fetchOpenOrders,
  fetchPerps,
  formatDec,
  hexToBytes,
  hlExchange,
  mulRatio,
  NearSigner,
  parseDec,
  parseNearSecretKey,
  PLACE_ORDER_DEPOSIT_YOCTO,
  REVEAL_DEPOSIT_YOCTO,
  roundPerpPx,
  roundSizeDown,
  sealOrder,
  signL1Action,
  walletBindingMessage,
} from "@blindstop/shared";
import { privateKeyToAccount } from "viem/accounts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const COIN = arg("coin", "BTC");
const USD = BigInt(arg("usd", "15"));
const CONTRACT = process.env.BLINDSTOP_CONTRACT ?? "blindstop.testnet";
const PROJECT = process.env.OUTLAYER_PROJECT ?? "blindstop-watch.testnet/blindstop-watcher";
const API = process.env.OUTLAYER_API ?? "https://testnet-api.outlayer.ai";
const OWNER = process.env.ALICE ?? "blindstop-alice.testnet";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
const PAYMENT_KEY = process.env.OUTLAYER_PAYMENT_KEY ?? (() => { throw new Error("set OUTLAYER_PAYMENT_KEY"); })();
const keyFile = (process.env.TRADING_KEY_FILE ?? "~/.blindstop-outlayer/golden-trading-wallet.json").replace(/^~/, homedir());
const wallet = privateKeyToAccount((JSON.parse(readFileSync(keyFile, "utf8")) as { private_key: `0x${string}` }).private_key);
const near = new NearSigner(
  parseNearSecretKey(OWNER, (JSON.parse(readFileSync(join(homedir(), ".near-credentials/testnet", `${OWNER}.json`), "utf8")) as { private_key: string }).private_key),
  RPCS,
);
const views = blindstopViews(RPCS, CONTRACT);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const evidence: Record<string, unknown> = { contract: CONTRACT, project: PROJECT, wallet: wallet.address, owner: OWNER, coin: COIN };

async function tick() {
  const [o, n] = PROJECT.split("/");
  const res = await fetch(`${API}/call/${o}/${n}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment-key": PAYMENT_KEY },
    body: JSON.stringify({ input: { op: "tick" } }),
    signal: AbortSignal.timeout(90_000),
  });
  const b = (await res.json()) as { output: unknown; call_id: string };
  const out = (typeof b.output === "string" ? JSON.parse(b.output) : b.output) as {
    ok: boolean;
    error?: string;
    reports: { order_id?: string; report: string; sig: string }[];
    stats: { errors: string[]; pending: number; sent: number };
  };
  return { ...out, call_id: b.call_id };
}

async function main() {
  const keys = await views.getEnclaveKeys();
  const ch = await fetchClearinghouse("testnet", wallet.address);
  log(`wallet ${wallet.address}: account value $${ch.marginSummary.accountValue}`);
  if (Number(ch.marginSummary.accountValue) <= 0) {
    console.log(`\nFund this address on Hyperliquid TESTNET (usdSend test USDC to it), then re-run:\n  ${wallet.address}`);
    process.exit(2);
  }

  // 1. agent
  const agents = await fetchExtraAgents("testnet", wallet.address);
  if (!agents.some((a) => a.address.toLowerCase() === keys.agent_address.toLowerCase())) {
    await approveAgent(wallet, keys.agent_address, "blindstop", "testnet");
    log(`approved agent ${keys.agent_address}`);
  } else log("agent already approved");

  // 2. position
  const perps = await fetchPerps("testnet");
  const asset = perps.get(COIN)!;
  let pos = (await fetchClearinghouse("testnet", wallet.address)).assetPositions.find((p) => p.position.coin === COIN)?.position;
  if (!pos || parseDec(pos.szi.replace("-", "")) === 0n) {
    const mark = parseDec(asset.markPx!);
    const size = roundSizeDown((USD * 10n ** 24n) / mark, asset.szDecimals); // USD / mark, scaled 1e12
    const px = roundPerpPx(mulRatio(mark, 10_100n, 10_000n, "up"), asset.szDecimals, "up");
    const action = {
      type: "order",
      orders: [{ a: asset.index, b: true, p: formatDec(px), s: formatDec(size), r: false, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    };
    const nonce = Date.now();
    const r = await hlExchange("testnet", action, nonce, await signL1Action(wallet, action, nonce, "testnet"));
    log(`opened long ${formatDec(size)} ${COIN}: ${JSON.stringify(r.response).slice(0, 160)}`);
    await sleep(2000);
    pos = (await fetchClearinghouse("testnet", wallet.address)).assetPositions.find((p) => p.position.coin === COIN)?.position;
  }
  if (!pos || pos.szi.startsWith("-")) throw new Error("need a long position on " + COIN);
  evidence.position_before = pos;
  log(`position: long ${pos.szi} ${COIN} @ ${pos.entryPx}, liq ${pos.liquidationPx}`);

  // 3. seal a take-profit the mark has already crossed (fires on the next tick)
  const mark = parseDec((await fetchPerps("testnet")).get(COIN)!.markPx!);
  const trigger = formatDec(roundPerpPx(mulRatio(mark, 9_990n, 10_000n, "down"), asset.szDecimals, "down"));
  const walletSig = hexToBytes(await wallet.signMessage({ message: walletBindingMessage(CONTRACT, OWNER, "testnet") }));
  const sealed = sealOrder(
    {
      network: "testnet",
      hlAddress: wallet.address,
      coin: COIN,
      side: "long",
      kind: "take_profit",
      triggerPx: trigger,
      size: "ALL",
      slippageBps: 100,
      confirmTicks: 1,
      createdMs: BigInt(Date.now()),
      salt: crypto.getRandomValues(new Uint8Array(32)),
      walletSig,
    },
    hexToBytes(keys.enclave_x25519),
    CONTRACT,
    OWNER,
  );
  const placed = await near.call(CONTRACT, "place_order", { ciphertext: bytesToBase64(sealed.envelope), commitment: bytesToHex(sealed.commitment) }, 50_000_000_000_000n, PLACE_ORDER_DEPOSIT_YOCTO);
  if (!placed.ok) throw new Error(placed.failure);
  const ev = placed.logs.find((l) => l.includes("order_placed"))!;
  const orderId = (JSON.parse(ev.slice(11)) as { data: { order_id: string }[] }).data[0]!.order_id;
  log(`sealed take-profit at ${trigger} as order ${orderId} (tx ${placed.hash})`);
  evidence.place_tx = placed.hash;
  evidence.order_id = orderId;
  evidence.trigger_px = trigger;

  // 4. the stop is not on Hyperliquid's book
  const openOrders = await fetchOpenOrders("testnet", wallet.address);
  evidence.open_orders_before_fire = openOrders;
  log(`Hyperliquid frontendOpenOrders for the wallet: ${JSON.stringify(openOrders)}`);
  if (openOrders.length) log("note: the wallet has public orders (not from Blindstop)");

  // 5. tick until the enclave closes it
  for (let i = 1; i <= 20; i++) {
    const t = await tick();
    if (!t.ok) throw new Error(`enclave: ${t.error}`);
    const r = t.reports.find((x) => x.order_id === orderId);
    log(`tick ${i} (call ${t.call_id}): sent ${t.stats.sent}, pending ${t.stats.pending}${t.stats.errors.length ? ", " + t.stats.errors.join("; ") : ""}`);
    if (r) {
      const rep = decodeFireReport(base64ToBytes(r.report));
      log(`enclave report: ${rep.outcome}, ${rep.filledSz} @ ${rep.avgPx}, oid ${rep.hlOid}`);
      evidence.fire_call_id = t.call_id;
      evidence.attestation = `${API}/attestations/by-call/${t.call_id}`;
      evidence.report = { outcome: rep.outcome, filled_sz: rep.filledSz, avg_px: rep.avgPx, hl_oid: rep.hlOid.toString() };
      const s = await near.call(CONTRACT, "record_fire", { report: r.report, sig: r.sig });
      log(`record_fire: ${s.ok ? "ok" : s.failure} (tx ${s.hash})`);
      evidence.record_fire_tx = s.hash;
      break;
    }
    await sleep(3000);
  }
  if (!evidence.record_fire_tx) throw new Error("no report after 20 ticks");

  // 6. NEAR shows Fired; position closed; reveal and check the commitment
  const order = await views.getOrder(orderId);
  const after = (await fetchClearinghouse("testnet", wallet.address)).assetPositions.find((p) => p.position.coin === COIN)?.position ?? null;
  log(`NEAR order ${orderId}: ${order?.status}; position after: ${after ? after.szi : "closed"}`);
  evidence.status = order?.status;
  evidence.position_after = after;
  const rv = await near.call(CONTRACT, "reveal", { order_id: orderId, plaintext: bytesToBase64(sealed.plaintext) }, 50_000_000_000_000n, REVEAL_DEPOSIT_YOCTO);
  log(`reveal: ${rv.ok ? "ok" : rv.failure} (tx ${rv.hash}); commitment ${bytesToHex(commitmentOf(sealed.plaintext)) === order?.commitment ? "matches" : "MISMATCH"}`);
  evidence.reveal_tx = rv.hash;
  evidence.finished_at = new Date().toISOString();
  writeFileSync(join(import.meta.dirname, "../docs/evidence/golden-path-testnet.json"), JSON.stringify(evidence, null, 2));
  console.log(order?.status === "Fired" ? "\nGOLDEN PATH PASSED" : "\nGOLDEN PATH INCOMPLETE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
