import type { Metadata } from "next";
import { Code, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const HIDDEN = [
  ["Stop-loss and take-profit levels", "Sealed to the enclave; never on Hyperliquid's book until one fires."],
  ["Order size, slippage, existence", "Inside the ciphertext. Every ciphertext is exactly 316 bytes."],
  ["Which market an order is for", "The coin is inside the ciphertext, not in the NEAR transaction."],
  ["Which Hyperliquid wallet it protects", "The trading wallet is inside the ciphertext too."],
  ["Who owns the trading wallet (with Gloam funding)", "Hidden unless amounts, timing, or your own moves link the two sides."],
];

const PUBLIC = [
  ["Your position", "Size, entry and liquidation price are public on Hyperliquid, as for everyone."],
  ["The close", "When a stop fires, its reduce-only IOC order and fill are public."],
  ["Your NEAR account's activity", "Which account placed sealed orders, how many, and when."],
  ["The agent approval", "That your trading wallet approved an agent. Every user approves the same agent address."],
  ["Gloam's edges", "Deposits into and cash-outs from Gloam are visible at the vault."],
];

const TRUST = [
  ["Intel TDX and OutLayer", "The enclave's memory is unreadable to its operator and its keys are derived by OutLayer's keystore. A broken TEE would expose plaintext stops (never withdrawal rights)."],
  ["The project owner", "Keys are bound to the OutLayer project and its operator account, so a new version published by the owner holds the same keys. The contract owner can also rotate the pinned keys. Until ownership is locked or moved to a DAO, the owner is trusted."],
  ["Liveness", "If no keeper calls the enclave, stops do not fire. Mitigations: the optional public backstop near liquidation, heartbeats you can see, and an open-source keeper anyone with an operator payment key can run."],
  ["Latency", "A stop fires within the tick interval (3 s) plus the enclave run (about 1.5 s) after the cross. A fast wick can fill worse than a native stop, and IOC closes that find no liquidity inside your slippage are retried up to 5 times."],
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 grid grid-cols-1 gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">What Blindstop hides, what it cannot hide, and what you have to trust. Stated plainly.</p>
      </div>

      <Panel title="The path of a stop">
        <Code>{`browser ── seal(order) to enclave x25519 key ──▶ NEAR  place_order(ciphertext, commitment)
                                                   │
keeper (every 3 s) ── POST /call ──▶ OutLayer TEE ─┤ read get_active from 2 independent RPCs (must match)
                                                   │ decrypt, check wallet signature, read Hyperliquid mark
                                                   │ crossed? → reduce-only IOC close, signed by the agent key
                                                   ▼
keeper ◀── ed25519-signed report ──  record_fire ──▶ NEAR verifies the signature, marks the order Fired`}</Code>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Table title="Hidden" rows={HIDDEN} tone="good" />
        <Table title="Still public" rows={PUBLIC} tone="bad" />
      </div>

      <Table title="What you trust" rows={TRUST} />

      <Panel title="Safety properties you can test">
        <ul className="text-sm leading-relaxed text-fg/80 list-disc pl-5 space-y-1.5">
          <li>A report with a forged signature, a replayed report, or a valid report for another order is refused by the contract.</li>
          <li>The enclave reads nothing that matters from its input: fake prices or orders sent by a keeper are ignored.</li>
          <li>If the two NEAR RPCs disagree about the active orders, the enclave refuses to act at all.</li>
          <li>A ciphertext moved to another NEAR account does not decrypt (the owner is in the authenticated data).</li>
          <li>An order naming a wallet that did not sign a binding to your NEAR account is retired as invalid, never acted on.</li>
          <li>Only the order&rsquo;s owner can cancel or reveal it, and a reveal with the wrong preimage is refused.</li>
        </ul>
        <p className="mt-3 text-xs text-muted">
          <code className="font-mono">scripts/attacks.ts</code> runs these against the deployed contract and enclave and prints ALL ATTACKS REFUSED.
        </p>
      </Panel>
    </div>
  );
}

function Table({ title, rows, tone }: { title: string; rows: string[][]; tone?: "good" | "bad" }) {
  return (
    <section className="border border-line rounded-[8px] bg-panel">
      <header className="px-4 sm:px-5 h-11 flex items-center border-b border-line">
        <h2 className={`text-[13px] font-medium ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{title}</h2>
      </header>
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="px-4 sm:px-5 py-3 grid gap-0.5">
            <dt className="text-sm font-medium">{k}</dt>
            <dd className="text-[13px] text-fg/70 leading-relaxed">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
