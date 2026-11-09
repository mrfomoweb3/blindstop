/**
 * The keeper loop. Stateless by design: everything it submits was signed by the enclave and
 * is re-checked by the contract, so a second keeper (or a restarted one) is always safe.
 *
 *  every TICK_INTERVAL_MS (never overlapping):
 *    enclave.tick() ─▶ for each fire report: record_fire  (deduped for DEDUPE_MS)
 *                    └▶ every Nth tick, or when it settled something: heartbeat
 */
import type { Enclave, EnclaveCall, SignedReport } from "./outlayer.ts";
import { log } from "./log.ts";

export interface Chain {
  recordFire(r: SignedReport): Promise<{ hash: string; ok: boolean; failure?: string }>;
  heartbeat(r: SignedReport): Promise<{ hash: string; ok: boolean; failure?: string }>;
}

export interface KeeperOptions {
  intervalMs: number;
  heartbeatEvery: number;
  dedupeMs?: number;
  now?: () => number;
}

export class Metrics {
  ticks = 0;
  tickErrors = 0;
  enclaveRefusals = 0;
  reportsSubmitted = 0;
  reportsAlreadySettled = 0;
  reportSubmitErrors = 0;
  heartbeatsSubmitted = 0;
  heartbeatErrors = 0;
  lastTickAt: number | null = null;
  lastOkTickAt: number | null = null;
  lastError: string | null = null;
  lastCallId: string | null = null;
  lastLatencyMs: number | null = null;
  lastComputeMs: number | null = null;
  lastOrdersSeen: number | null = null;
  lastBlockHeight: number | null = null;
  lastHeartbeatTx: string | null = null;

  prometheus(contract: string): string {
    const l = `{contract="${contract}"}`;
    const g = (name: string, help: string, type: "counter" | "gauge", v: number | null) =>
      `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}${l} ${v ?? "NaN"}\n`;
    return [
      g("blindstop_ticks_total", "Enclave ticks attempted", "counter", this.ticks),
      g("blindstop_tick_errors_total", "Ticks that failed (transport or enclave refusal)", "counter", this.tickErrors),
      g("blindstop_enclave_refusals_total", "Ticks the enclave refused (e.g. NEAR RPCs disagreed)", "counter", this.enclaveRefusals),
      g("blindstop_reports_submitted_total", "Fire reports recorded on NEAR by this keeper", "counter", this.reportsSubmitted),
      g("blindstop_reports_already_settled_total", "Fire reports another keeper settled first", "counter", this.reportsAlreadySettled),
      g("blindstop_report_submit_errors_total", "Fire report submissions that failed", "counter", this.reportSubmitErrors),
      g("blindstop_heartbeats_submitted_total", "Heartbeats recorded on NEAR", "counter", this.heartbeatsSubmitted),
      g("blindstop_last_tick_timestamp_seconds", "Unix time of the last tick", "gauge", this.lastTickAt && this.lastTickAt / 1000),
      g("blindstop_last_ok_tick_timestamp_seconds", "Unix time of the last successful tick", "gauge", this.lastOkTickAt && this.lastOkTickAt / 1000),
      g("blindstop_outlayer_latency_ms", "Round trip of the last enclave call", "gauge", this.lastLatencyMs),
      g("blindstop_enclave_compute_ms", "TEE compute time of the last enclave call", "gauge", this.lastComputeMs),
      g("blindstop_active_orders", "Active sealed orders the enclave saw", "gauge", this.lastOrdersSeen),
    ].join("");
  }
}

export class Keeper {
  readonly metrics = new Metrics();
  private readonly enclave: Enclave;
  private readonly chain: Chain;
  private readonly opts: Required<KeeperOptions>;
  private readonly recent = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private tickCount = 0;

  constructor(enclave: Enclave, chain: Chain, opts: KeeperOptions) {
    this.enclave = enclave;
    this.chain = chain;
    this.opts = { dedupeMs: 60_000, now: () => Date.now(), ...opts };
  }

  start() {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      const started = this.opts.now();
      await this.tickOnce();
      if (this.stopped) return;
      const wait = Math.max(0, this.opts.intervalMs - (this.opts.now() - started));
      this.timer = setTimeout(loop, wait);
    };
    void loop();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  /** One full step. Never runs concurrently with itself. */
  async tickOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const m = this.metrics;
    m.ticks++;
    m.lastTickAt = this.opts.now();
    this.tickCount++;
    try {
      let call: EnclaveCall;
      try {
        call = await this.enclave.tick();
      } catch (e) {
        m.tickErrors++;
        m.lastError = String((e as Error).message ?? e).slice(0, 300);
        log("warn", "enclave call failed", { error: m.lastError });
        return;
      }
      m.lastCallId = call.callId;
      m.lastLatencyMs = call.latencyMs;
      m.lastComputeMs = call.computeMs;
      const out = call.output;
      if (!out.ok) {
        m.tickErrors++;
        m.enclaveRefusals++;
        m.lastError = out.error;
        log("warn", "enclave refused the tick", { error: out.error, call_id: call.callId });
        return;
      }
      m.lastOkTickAt = this.opts.now();
      m.lastError = null;
      m.lastOrdersSeen = out.stats.orders_seen;
      m.lastBlockHeight = out.block_height;
      if (out.stats.errors.length) log("info", "enclave notes", { notes: out.stats.errors, call_id: call.callId });

      this.prune();
      let settled = 0;
      for (const r of out.reports) {
        const id = r.order_id ?? "?";
        if (this.recent.has(id)) continue;
        try {
          const res = await this.chain.recordFire(r);
          this.recent.set(id, this.opts.now());
          if (res.ok) {
            m.reportsSubmitted++;
            settled++;
            log("info", "order settled on NEAR", { order_id: id, tx: res.hash, call_id: call.callId });
          } else if (/not active/.test(res.failure ?? "")) {
            m.reportsAlreadySettled++;
            log("info", "order already settled", { order_id: id, tx: res.hash });
          } else {
            m.reportSubmitErrors++;
            log("error", "record_fire refused", { order_id: id, tx: res.hash, failure: res.failure });
          }
        } catch (e) {
          m.reportSubmitErrors++;
          log("error", "record_fire failed to send", { order_id: id, error: String((e as Error).message ?? e).slice(0, 300) });
        }
      }

      if (settled > 0 || this.tickCount % this.opts.heartbeatEvery === 0) {
        try {
          const res = await this.chain.heartbeat(out.heartbeat);
          if (res.ok) {
            m.heartbeatsSubmitted++;
            m.lastHeartbeatTx = res.hash;
            log("debug", "heartbeat recorded", { tx: res.hash, orders_seen: out.stats.orders_seen });
          } else {
            m.heartbeatErrors++;
            log("warn", "heartbeat refused", { failure: res.failure });
          }
        } catch (e) {
          m.heartbeatErrors++;
          log("warn", "heartbeat failed to send", { error: String((e as Error).message ?? e).slice(0, 300) });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private prune() {
    const now = this.opts.now();
    for (const [id, at] of this.recent) if (now - at > this.opts.dedupeMs) this.recent.delete(id);
  }
}
