import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Code, Eyebrow, IconTile, cx } from "@/components/ui";

export default function Landing() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* ── hero ── */}
      <section className="pt-20 sm:pt-28 text-center">
        <Eyebrow>Hidden stops for Hyperliquid · NEAR × OutLayer TEE</Eyebrow>
        <h1 className="headline mt-5 text-[40px] sm:text-[60px] leading-[1.05]">
          Your <strong>stop-loss</strong>, sealed.
          <br />
          <strong>Invisible</strong> until it fires.
        </h1>
        <p className="mt-6 mx-auto max-w-[36rem] text-[15.5px] leading-relaxed text-soft">
          Every stop on Hyperliquid&rsquo;s order book is public, and traders hunt them. Blindstop keeps yours off the book entirely,
          sealed to an enclave on NEAR that watches the mark price and closes your position the moment your level is hit.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/app" className="inline-flex items-center h-11 px-7 rounded-full bg-accent text-accent-ink text-[13px] font-semibold uppercase tracking-[0.05em] lime-glow hover:brightness-105">
            Seal a stop
          </Link>
          <Link href="/how-it-works" className="inline-flex items-center h-11 px-7 rounded-full border border-line-strong text-[13px] font-medium uppercase tracking-[0.05em] hover:border-accent/60">
            What is hidden
          </Link>
        </div>
      </section>

      <section className="horizon mt-24 sm:mt-28 pt-10">
        <ProductFrame />
        <p className="relative mt-3 text-center text-[11.5px] text-faint">Illustration of the app. Prices and wallet are examples.</p>
      </section>

      {/* ── before / after ── */}
      <section className="mt-28 grid lg:grid-cols-2 gap-4">
        <div className="card p-5 sm:p-6 min-w-0">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium">A normal stop</span>
            <span className="font-mono text-bad text-xs">readable by anyone</span>
          </div>
          <div className="mt-4">
            <Code>{`POST api.hyperliquid.xyz/info
{"type":"frontendOpenOrders","user":"0x9f2c…e41a"}

[{ "coin": "BTC", "orderType": "Stop Market",
   "triggerPx": "94800", "sz": "1.25",
   "reduceOnly": true }]`}</Code>
          </div>
        </div>
        <div className="card p-5 sm:p-6 min-w-0 lime-glow">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium">A Blindstop stop</span>
            <span className="font-mono text-accent-text text-xs">nothing to hunt</span>
          </div>
          <div className="mt-4 grid gap-2">
            <Code>{`POST api.hyperliquid.xyz/info
{"type":"frontendOpenOrders","user":"0x9f2c…e41a"}

[]`}</Code>
            <Code>{`NEAR blindstop.testnet · place_order
ciphertext  316 bytes  7f3a91c4e0…  sealed to the enclave
commitment  sha256     c21e9b07aa…  proves the level later`}</Code>
          </div>
        </div>
      </section>

      {/* ── phases ── */}
      <section className="mt-32 text-center">
        <h2 className="headline text-[34px] sm:text-[44px] leading-tight">
          From <strong>seal</strong> to <strong>fill</strong>
        </h2>
        <p className="mt-4 mx-auto max-w-xl text-[15px] text-soft">
          Three steps, each checkable. Your browser seals, an enclave watches, NEAR verifies.
        </p>
        <div className="mt-14 grid md:grid-cols-3 gap-4 text-left">
          <Phase
            name="Seal"
            n={1}
            text="Your browser encrypts the stop to the enclave's key. NEAR stores only ciphertext and a commitment; the level, size, market and wallet are inside."
            rows={[
              ["Ciphertext, every order", "316 B"],
              ["Orders on Hyperliquid's book", "0"],
              ["Wallet binding", "EIP-191"],
            ]}
          />
          <Phase
            name="Watch"
            n={2}
            highlight
            text="An OutLayer enclave (Intel TDX) reads the sealed orders from two NEAR providers that must agree, and the mark price from Hyperliquid. Its input carries no prices."
            rows={[
              ["Tick interval", "3 s"],
              ["NEAR RPCs that must agree", "2 / 2"],
              ["Keys outside the TEE", "none"],
            ]}
          />
          <Phase
            name="Close"
            n={3}
            text="On a cross, the enclave closes your position as your approved agent and signs a report. Anyone can submit it; NEAR checks the signature and records the fill."
            rows={[
              ["Close order", "reduce-only IOC"],
              ["Retries if unfilled", "5"],
              ["Agent can withdraw", "never"],
            ]}
          />
        </div>
      </section>

      {/* ── features ── */}
      <section className="mt-32 grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="card p-6 sm:p-8 flex flex-col justify-between min-h-[320px] overflow-hidden relative">
          <div className="relative">
            <h2 className="headline text-[30px] sm:text-[36px] leading-tight">
              Why trade with <strong>sealed stops</strong>
            </h2>
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              <Check>Nothing on the public book</Check>
              <Check>Market and wallet stay sealed</Check>
              <Check>Agent cannot withdraw</Check>
              <Check>Provable after the fact</Check>
            </ul>
          </div>
          <div className="relative mt-8 grid gap-4 sm:max-w-[48%]">
            <Fact k="Signing" v="byte-identical to the Python SDK" />
            <Fact k="Attacks refused" v="9 of 9 on testnet" />
          </div>
          <Link href="/app" className="relative mt-7 self-start inline-flex items-center h-9 px-5 rounded-full bg-accent text-accent-ink text-xs font-semibold uppercase tracking-[0.05em]">
            Start sealing
          </Link>
          <Bars />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Feature icon={<IconEye />} title="Nothing to hunt" text="Trackers read Hyperliquid's book. Your stop is never on it until the moment it closes your position." />
          <Feature icon={<IconKey />} title="Your wallet stays yours" text="A fresh trading wallet whose key never leaves your browser. The watcher is an agent: it trades, it cannot withdraw." />
          <Feature icon={<IconShield />} title="Can't be fed fake prices" text="The enclave ignores its input. Orders come from NEAR, prices from Hyperliquid, read by the enclave itself." />
          <Feature icon={<IconCheck />} title="Prove it later" text="Reveal a closed order and anyone can check, against NEAR, that the level was set before the price moved." />
          <Feature icon={<IconLife />} title="Backstop near liquidation" text="Optional: a wide public stop placed with your own key, in case the watcher ever goes quiet." />
          <Feature icon={<IconPulse />} title="Watcher you can watch" text="Every tick ends in a signed heartbeat on NEAR. Its age is on every page." />
        </div>
      </section>

      {/* ── what is hidden ── */}
      <section className="mt-32 card overflow-hidden grid lg:grid-cols-2 min-w-0">
        <div className="relative min-h-[300px] dots border-b lg:border-b-0 lg:border-r border-line grid place-items-center overflow-hidden">
          <div className="absolute size-[340px] rounded-full" style={{ background: "radial-gradient(circle, var(--glow), transparent 65%)" }} />
          <Envelope />
        </div>
        <div className="p-6 sm:p-10">
          <h2 className="headline text-[30px] sm:text-[36px] leading-tight">
            Sealed with care, <strong>stated plainly</strong>
          </h2>
          <p className="mt-3 text-sm text-soft max-w-md">What Blindstop hides, and what it cannot. Your position and its liquidation price are public, as for everyone.</p>
          <div className="mt-6 grid sm:grid-cols-2 gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-accent-text mb-3">Hidden</div>
              <ul className="grid gap-2">
                <Check>Stop and take-profit levels</Check>
                <Check>Size and slippage</Check>
                <Check>Which market</Check>
                <Check>Which trading wallet</Check>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Still public</div>
              <ul className="grid gap-2 text-[13px] text-muted">
                <li>Your position and liquidation price</li>
                <li>The close, when a stop fires</li>
                <li>Your NEAR account&rsquo;s activity</li>
                <li>That you approved an agent</li>
              </ul>
            </div>
          </div>
          <Link href="/how-it-works" className="mt-8 inline-flex items-center h-9 px-5 rounded-full border border-line-strong text-xs font-medium uppercase tracking-[0.05em] hover:border-accent/60">
            Full table and trust model
          </Link>
        </div>
      </section>

      <section className="mt-32 text-center">
        <p className="headline text-[26px] sm:text-[34px]">
          Gloam hides <strong>who you are</strong>. Blindstop hides <strong>where your stops are</strong>.
        </p>
      </section>
    </div>
  );
}

function Phase({ name, n, text, rows, highlight }: { name: string; n: number; text: string; rows: [string, string][]; highlight?: boolean }) {
  return (
    <article className={cx("card overflow-hidden", highlight && "lime-glow")}>
      <div
        className={cx(
          "mx-2 mt-2 h-16 grid place-items-center rounded-[14px] text-[22px] font-medium uppercase tracking-[0.02em]",
          highlight ? "bg-accent text-accent-ink" : "bg-panel-2 border border-line-strong",
        )}
      >
        {name}
      </div>
      <div className="p-5 sm:p-6">
        <div className="text-[12px] uppercase tracking-[0.12em] text-muted">Phase {n}</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-soft">{text}</p>
        <dl className="mt-5 grid gap-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 border-t border-line pt-3">
              <span className={cx("size-1.5 rounded-full", highlight ? "bg-accent" : "bg-faint")} />
              <dt className="text-[13px]">{k}</dt>
              <dd className="ml-auto font-mono text-[12.5px] text-soft">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="card p-5 flex gap-4">
      <IconTile>{icon}</IconTile>
      <div>
        <h3 className="text-[14px] font-medium">{title}</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{text}</p>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <IconTile>
        <IconCheck />
      </IconTile>
      <div>
        <div className="text-[13px] font-medium">{k}</div>
        <div className="text-[11.5px] text-muted">{v}</div>
      </div>
    </div>
  );
}

/** Decorative bars with one lit column, echoing a price chart. */
function Bars() {
  const h = [38, 52, 44, 66, 58, 84, 72];
  return (
    <div aria-hidden className="pointer-events-none absolute right-6 bottom-0 hidden sm:flex items-end gap-2 h-36 opacity-90">
      {h.map((x, i) => (
        <div
          key={i}
          className="w-7 rounded-t-md border border-line-strong"
          style={{
            height: `${x}%`,
            background: i === 5 ? "linear-gradient(180deg, var(--accent), transparent)" : "linear-gradient(180deg, var(--panel-2), transparent)",
            boxShadow: i === 5 ? "0 0 30px -4px var(--glow)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function Envelope() {
  return (
    <svg viewBox="0 0 220 160" className="relative w-56" aria-hidden>
      <rect x="20" y="30" width="180" height="110" rx="14" fill="var(--panel-2)" stroke="var(--line-strong)" />
      <path d="M22 40l88 58 88-58" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
      <circle cx="110" cy="98" r="22" fill="var(--accent)" />
      <path d="M100 98h7M113 98h7" stroke="var(--accent-ink)" strokeWidth="3" strokeLinecap="round" />
      <rect x="106.5" y="88" width="7" height="20" rx="1.8" fill="var(--accent-ink)" />
      <text x="110" y="24" textAnchor="middle" fontFamily="var(--font-geist-mono)" fontSize="9" fill="var(--muted)">316 bytes · sealed</text>
    </svg>
  );
}

/** A framed, static picture of the app: one position, its sealed levels, an empty public book. */
function ProductFrame() {
  return (
    <div className="relative mx-auto max-w-4xl rounded-[22px] border border-line-strong bg-panel p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
      <div className="rounded-[16px] border border-line bg-sunken overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-11 border-b border-line text-[11.5px] text-muted">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
          </span>
          <span className="hidden sm:inline">Your sealed stops</span>
          <span className="ml-auto inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-good/35 text-good">
            <span className="size-1.5 rounded-full bg-current" /> watcher 2s ago
          </span>
          <span className="hidden sm:inline font-mono">testnet</span>
        </div>
        <div className="grid sm:grid-cols-[1.2fr_1fr]">
          <div className="p-4 sm:p-5 border-b sm:border-b-0 sm:border-r border-line">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[14px]">BTC-PERP</span>
              <span className="text-[11px] h-5 px-2 rounded-full border border-good/35 text-good inline-flex items-center">LONG 0.25</span>
              <span className="ml-auto font-mono text-[12.5px] text-good">+$412.80</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-[11px] uppercase tracking-[0.08em] text-muted">
              <div>Mark<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-fg">96,412</div></div>
              <div>Entry<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-fg">94,760</div></div>
              <div>Liq<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-warn">81,930</div></div>
            </div>
            <svg viewBox="0 0 300 90" className="mt-4 w-full h-24" aria-hidden>
              {Array.from({ length: 34 }, (_, i) => {
                const y = Math.round((50 + Math.sin(i / 3.2) * 16 - i * 0.7) * 10) / 10;
                const hh = 8 + ((i * 37) % 17);
                const up = Math.sin(i / 2.1) > -0.2;
                return <rect key={i} x={Math.round((6 + i * 8.6) * 10) / 10} y={y - hh / 2} width="4.2" height={hh} rx="1" fill={up ? "var(--soft)" : "var(--faint)"} opacity={0.55} />;
              })}
              <line x1="0" x2="300" y1="74" y2="74" stroke="var(--accent)" strokeDasharray="3 4" opacity="0.8" />
              <text x="296" y="70" textAnchor="end" fontSize="8" fontFamily="var(--font-geist-mono)" fill="var(--accent-text)">SL sealed · visible only to you</text>
            </svg>
          </div>
          <div className="p-4 sm:p-5 grid gap-3 content-start">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted">Sealed levels</div>
            {[
              ["SL", "91,500", "−5.10%"],
              ["TP", "103,000", "+6.83%"],
            ].map(([k, v, d]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl border border-line px-3 h-10 font-mono text-[12.5px]">
                <span className={k === "SL" ? "text-accent-text" : "text-soft"}>{k}</span>
                <span>{v}</span>
                <span className="text-muted">{d}</span>
                <span className="ml-auto text-[10.5px] h-5 px-2 rounded-full border border-accent/40 text-accent-text inline-flex items-center font-sans">sealed</span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between rounded-xl bg-panel-2 px-3 h-10 text-[12px]">
              <span className="text-muted">Public orders on Hyperliquid&rsquo;s book</span>
              <span className="font-mono text-good">0</span>
            </div>
            <div className="h-10 rounded-full bg-accent text-accent-ink grid place-items-center text-[12px] font-semibold uppercase tracking-[0.05em]">
              Seal to the enclave
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconEye() {
  return <svg viewBox="0 0 24 24" className="size-4"><path {...S} d="M3 3l18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.3 7.6C4.1 9.2 3 12 3 12s4 6 9 6a9 9 0 0 0 4-1" /></svg>;
}
function IconKey() {
  return <svg viewBox="0 0 24 24" className="size-4"><circle {...S} cx="8" cy="14" r="4" /><path {...S} d="M11 11l9-9M17 5l2 2M15 7l2 2" /></svg>;
}
function IconShield() {
  return <svg viewBox="0 0 24 24" className="size-4"><path {...S} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path {...S} d="M9 12l2 2 4-4" /></svg>;
}
function IconCheck() {
  return <svg viewBox="0 0 24 24" className="size-4"><rect {...S} x="4" y="4" width="16" height="16" rx="4" /><path {...S} d="M8.5 12.2l2.3 2.3 4.7-4.8" /></svg>;
}
function IconLife() {
  return <svg viewBox="0 0 24 24" className="size-4"><circle {...S} cx="12" cy="12" r="8" /><circle {...S} cx="12" cy="12" r="3.5" /><path {...S} d="M6.3 6.3l3.2 3.2M14.5 14.5l3.2 3.2M17.7 6.3l-3.2 3.2M9.5 14.5l-3.2 3.2" /></svg>;
}
function IconPulse() {
  return <svg viewBox="0 0 24 24" className="size-4"><path {...S} d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
}
