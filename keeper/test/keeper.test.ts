import { describe, expect, it } from "vitest";
import { Keeper, type Chain } from "../src/keeper.ts";
import type { Enclave, EnclaveCall, SignedReport, TickOutput } from "../src/outlayer.ts";

const hb: SignedReport = { kind: 1, report: "aGI=", sig: "c2ln" };
const fire = (id: string): SignedReport => ({ kind: 0, order_id: id, report: `r${id}`, sig: `s${id}` });

function ok(reports: SignedReport[]): TickOutput {
  return {
    ok: true,
    contract_id: "c",
    block_height: 1,
    reports,
    heartbeat: hb,
    stats: { orders_seen: reports.length, processed: 0, triggered: 0, sent: 0, pending: 0, reports: reports.length, invalid: 0, errors: [] },
  };
}

class FakeEnclave implements Enclave {
  outputs: (TickOutput | Error)[] = [];
  calls = 0;
  delayMs = 0;
  async tick(): Promise<EnclaveCall> {
    this.calls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const o = this.outputs.shift() ?? ok([]);
    if (o instanceof Error) throw o;
    return { callId: `call-${this.calls}`, output: o, latencyMs: 1, computeMs: 1 };
  }
}

class FakeChain implements Chain {
  fires: string[] = [];
  heartbeats = 0;
  settled = new Set<string>();
  async recordFire(r: SignedReport) {
    this.fires.push(r.order_id!);
    if (this.settled.has(r.order_id!)) return { hash: "h", ok: false, failure: "order is not active (already settled or cancelled)" };
    this.settled.add(r.order_id!);
    return { hash: "h", ok: true };
  }
  async heartbeat() {
    this.heartbeats++;
    return { hash: "hb", ok: true };
  }
}

describe("keeper", () => {
  it("settles each report once and heartbeats when it settled something", async () => {
    const e = new FakeEnclave();
    const c = new FakeChain();
    const k = new Keeper(e, c, { intervalMs: 1000, heartbeatEvery: 10 });
    e.outputs.push(ok([fire("1"), fire("2")]), ok([fire("1")]));
    await k.tickOnce();
    expect(c.fires).toEqual(["1", "2"]);
    expect(c.heartbeats).toBe(1);
    await k.tickOnce(); // the enclave re-emits order 1 until NEAR drops it: deduped
    expect(c.fires).toEqual(["1", "2"]);
    expect(k.metrics.reportsSubmitted).toBe(2);
  });

  it("treats a report another keeper settled first as done, not as an error", async () => {
    const e = new FakeEnclave();
    const c = new FakeChain();
    c.settled.add("7");
    const k = new Keeper(e, c, { intervalMs: 1000, heartbeatEvery: 10 });
    e.outputs.push(ok([fire("7")]));
    await k.tickOnce();
    expect(k.metrics.reportsAlreadySettled).toBe(1);
    expect(k.metrics.reportSubmitErrors).toBe(0);
  });

  it("heartbeats every Nth tick when idle", async () => {
    const e = new FakeEnclave();
    const c = new FakeChain();
    const k = new Keeper(e, c, { intervalMs: 1000, heartbeatEvery: 3 });
    for (let i = 0; i < 7; i++) await k.tickOnce();
    expect(c.heartbeats).toBe(2);
  });

  it("never overlaps ticks", async () => {
    const e = new FakeEnclave();
    e.delayMs = 50;
    const k = new Keeper(e, new FakeChain(), { intervalMs: 1000, heartbeatEvery: 10 });
    await Promise.all([k.tickOnce(), k.tickOnce(), k.tickOnce()]);
    expect(e.calls).toBe(1);
  });

  it("records enclave refusals and transport errors without crashing", async () => {
    const e = new FakeEnclave();
    const c = new FakeChain();
    const k = new Keeper(e, c, { intervalMs: 1000, heartbeatEvery: 1 });
    e.outputs.push({ ok: false, error: "near rpcs disagree" }, new Error("timeout"));
    await k.tickOnce();
    await k.tickOnce();
    expect(k.metrics.tickErrors).toBe(2);
    expect(k.metrics.enclaveRefusals).toBe(1);
    expect(c.heartbeats).toBe(0);
    await k.tickOnce();
    expect(k.metrics.lastError).toBeNull();
    expect(k.metrics.prometheus("c")).toContain('blindstop_tick_errors_total{contract="c"} 2');
  });
});
