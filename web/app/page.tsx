import Link from "next/link";
import { Code } from "@/components/ui";

export default function Landing() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="pt-14 sm:pt-20 pb-12 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-start">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted tracking-wide">HIDDEN STOPS FOR HYPERLIQUID · NEAR × OUTLAYER TEE</p>
          <h1 className="mt-4 text-[34px] sm:text-[46px] leading-[1.04] font-semibold tracking-[-0.035em]">
            Every stop on Hyperliquid is public.
            <br />
            <span className="text-muted">Yours doesn&rsquo;t have to be.</span>
          </h1>
          <p className="mt-5 text-[15.5px] leading-relaxed text-fg/80 max-w-[34rem]">
            Hyperliquid&rsquo;s order book is fully on chain, stop-losses included. Trackers map where stops cluster, and
            traders push price into those clusters on purpose. Blindstop keeps your stop-loss and take-profit off the book
            entirely. They are sealed to an enclave on NEAR that watches the mark price and closes your position the
            moment your level is hit.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/app" className="inline-flex items-center h-11 px-5 rounded-[6px] bg-accent text-accent-ink font-semibold text-sm hover:brightness-110">
              Seal a stop
            </Link>
            <Link href="/how-it-works" className="inline-flex items-center h-11 px-5 rounded-[6px] border border-line-strong text-sm font-medium hover:border-fg/40">
              What is hidden, exactly
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted max-w-[34rem]">
            Gloam hides who you are. Blindstop hides where your stops are.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 min-w-0">
          <div className="border border-line rounded-[8px] bg-panel overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 h-10 border-b border-line text-xs">
              <span className="font-medium">Without Blindstop</span>
              <span className="text-bad font-mono">readable by anyone</span>
            </div>
            <div className="p-3 min-w-0">
              <Code>{`POST api.hyperliquid.xyz/info
{"type":"frontendOpenOrders","user":"0x9f2c…e41a"}

[{ "coin": "BTC", "side": "A",
   "orderType": "Stop Market",
   "triggerPx": "94800",  "sz": "1.25",
   "reduceOnly": true }]`}</Code>
            </div>
          </div>
          <div className="border border-line rounded-[8px] bg-panel overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 h-10 border-b border-line text-xs">
              <span className="font-medium">With Blindstop</span>
              <span className="text-good font-mono">nothing to hunt</span>
            </div>
            <div className="p-3 grid grid-cols-1 gap-2 min-w-0">
              <Code>{`POST api.hyperliquid.xyz/info
{"type":"frontendOpenOrders","user":"0x9f2c…e41a"}

[]`}</Code>
              <Code>{`NEAR  blindstop.testnet · place_order
ciphertext  316 bytes   7f3a91c4e0…  (sealed to the enclave)
commitment  sha256      c21e9b07aa…  (proves the level later)`}</Code>
            </div>
          </div>
          <p className="text-[11.5px] text-muted px-1">Illustration of the two API answers. The wallet and values are examples.</p>
        </div>
      </section>

      <section className="border-t border-line py-12 grid md:grid-cols-3 gap-8">
        {[
          ["01  Seal", "Your browser encrypts the stop to the enclave's public key and stores only ciphertext and a commitment on NEAR. The level, size, market and trading wallet are all inside the ciphertext."],
          ["02  Watch", "Every few seconds the OutLayer enclave (Intel TDX) reads the sealed orders from two independent NEAR RPCs and the mark price from Hyperliquid. Nobody can feed it fake prices."],
          ["03  Close", "When mark crosses your level, the enclave sends a reduce-only IOC close as your approved agent and signs a report. NEAR verifies the signature and records the fill."],
        ].map(([h, p]) => (
          <div key={h}>
            <h3 className="font-mono text-sm">{h}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg/75">{p}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-line py-12 grid md:grid-cols-2 gap-10">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">What the agent can and cannot do</h2>
          <p className="mt-3 text-sm leading-relaxed text-fg/75">
            You approve the enclave as a Hyperliquid <em>agent</em> for a fresh trading wallet. Agents can place and cancel
            orders. They cannot withdraw, and the enclave only ever sends reduce-only closes for wallets that signed a
            binding to your NEAR account. Its signing key is held by the TEE host and never leaves it.
          </p>
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">What stays public</h2>
          <ul className="mt-3 text-sm leading-relaxed text-fg/75 list-disc pl-5 space-y-1">
            <li>Your position: size, entry and liquidation price.</li>
            <li>The close order, at the moment a stop fires.</li>
            <li>Which NEAR account placed sealed orders, how many and when.</li>
            <li>That your trading wallet approved an agent (shared by every user).</li>
          </ul>
          <Link href="/how-it-works" className="mt-3 inline-block text-sm underline underline-offset-[3px] decoration-line-strong hover:decoration-fg">
            The full table and the trust assumptions
          </Link>
        </div>
      </section>
    </div>
  );
}
