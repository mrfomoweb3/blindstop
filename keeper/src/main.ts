import { createServer } from "node:http";
import { NearSigner, parseNearSecretKey, publicKeyString } from "@blindstop/shared";
import { loadConfig } from "./config.ts";
import { Keeper, type Chain } from "./keeper.ts";
import { log, setLogLevel } from "./log.ts";
import { OutLayerEnclave } from "./outlayer.ts";

const cfg = loadConfig();
setLogLevel(cfg.logLevel);

const key = parseNearSecretKey(cfg.keeperAccount, cfg.keeperSecret);
const signer = new NearSigner(key, cfg.rpcs);
const chain: Chain = {
  recordFire: (r) => signer.call(cfg.contract, "record_fire", { report: r.report, sig: r.sig }, 50_000_000_000_000n),
  heartbeat: (r) => signer.call(cfg.contract, "heartbeat", { report: r.report, sig: r.sig }, 20_000_000_000_000n),
};
const enclave = new OutLayerEnclave(cfg.outlayerApi, cfg.outlayerProject, cfg.paymentKey, cfg.callTimeoutMs);
const keeper = new Keeper(enclave, chain, { intervalMs: cfg.tickIntervalMs, heartbeatEvery: cfg.heartbeatEvery, heartbeatMaxGapMs: cfg.heartbeatMaxGapMs });

const server = createServer((req, res) => {
  const m = keeper.metrics;
  if (req.url === "/health") {
    const now = Date.now();
    const healthy = m.lastOkTickAt !== null && now - m.lastOkTickAt < Math.max(30_000, cfg.tickIntervalMs * 10);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(
      JSON.stringify({
        ok: healthy,
        network: cfg.network,
        contract: cfg.contract,
        project: cfg.outlayerProject,
        keeper: cfg.keeperAccount,
        tick_interval_ms: cfg.tickIntervalMs,
        last_tick_at: m.lastTickAt,
        last_ok_tick_at: m.lastOkTickAt,
        last_error: m.lastError,
        last_call_id: m.lastCallId,
        last_attestation: m.lastCallId ? `${cfg.outlayerApi}/attestations/by-call/${m.lastCallId}` : null,
        outlayer_latency_ms: m.lastLatencyMs,
        enclave_compute_ms: m.lastComputeMs,
        orders_seen: m.lastOrdersSeen,
        block_height: m.lastBlockHeight,
        last_heartbeat_tx: m.lastHeartbeatTx,
        reports_submitted: m.reportsSubmitted,
      }),
    );
    return;
  }
  if (req.url === "/metrics") {
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    res.end(m.prometheus(cfg.contract));
    return;
  }
  res.writeHead(404).end();
});

server.listen(cfg.port, () => {
  log("info", "keeper started", {
    network: cfg.network,
    contract: cfg.contract,
    project: cfg.outlayerProject,
    keeper: cfg.keeperAccount,
    keeper_key: publicKeyString(key),
    interval_ms: cfg.tickIntervalMs,
    port: cfg.port,
  });
  keeper.start();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log("info", "shutting down", { signal: sig });
    await keeper.stop();
    server.close(() => process.exit(0));
  });
}
