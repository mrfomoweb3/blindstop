/** One HTTPS run of the enclave: POST {api}/call/{owner}/{project} with a payment key. */
import { z } from "zod";

const Report = z.object({
  kind: z.number().int(),
  order_id: z.string().optional(),
  report: z.string(),
  sig: z.string(),
});

export const TickOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    contract_id: z.string(),
    block_height: z.number(),
    reports: z.array(Report),
    heartbeat: Report,
    stats: z.object({
      orders_seen: z.number(),
      processed: z.number(),
      triggered: z.number(),
      sent: z.number(),
      pending: z.number(),
      reports: z.number(),
      invalid: z.number(),
      errors: z.array(z.string()),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TickOutput = z.infer<typeof TickOutput>;
export type SignedReport = z.infer<typeof Report>;

export interface EnclaveCall {
  callId: string | null;
  output: TickOutput;
  latencyMs: number;
  computeMs: number | null;
}

export interface Enclave {
  tick(): Promise<EnclaveCall>;
}

export class OutLayerEnclave implements Enclave {
  private readonly url: string;
  private readonly paymentKey: string;
  private readonly timeoutMs: number;

  constructor(api: string, project: string, paymentKey: string, timeoutMs: number) {
    const [owner, name] = project.split("/");
    this.url = `${api}/call/${owner}/${name}`;
    this.paymentKey = paymentKey;
    this.timeoutMs = timeoutMs;
  }

  async tick(): Promise<EnclaveCall> {
    const t0 = performance.now();
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-payment-key": this.paymentKey },
      // The enclave reads only `op`; everything it acts on comes from NEAR and Hyperliquid.
      body: JSON.stringify({ input: { op: "tick" } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(`outlayer HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { call_id?: string; status?: string; output?: unknown; error?: string | null; time_ms?: number };
    if (body.status !== "completed" || body.error) throw new Error(`outlayer run ${body.status ?? "?"}: ${body.error ?? "no output"}`);
    const raw = typeof body.output === "string" ? JSON.parse(body.output) : body.output;
    return { callId: body.call_id ?? null, output: TickOutput.parse(raw), latencyMs, computeMs: body.time_ms ?? null };
  }
}
