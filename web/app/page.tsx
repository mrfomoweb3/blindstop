import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Eyebrow, IconTile, cx } from "@/components/ui";

export default function Landing() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* ── hero ── */}
      <section className="pt-20 sm:pt-28 text-center">
        <Eyebrow>Private stop-losses for Hyperliquid</Eyebrow>
        <h1 className="headline mt-5 text-[40px] sm:text-[60px] leading-[1.05]">
          Your <strong>stop-loss</strong>, sealed.
          <br />
          <strong>Invisible</strong> until it fires.
        </h1>
        <p className="mt-6 mx-auto max-w-[36rem] text-[15.5px] leading-relaxed text-soft">
          On Hyperliquid, everyone can see where your stop-loss sits, and big traders push the price there on purpose to knock you
          out. Blindstop keeps your stop hidden and closes your position for you the moment the price gets there.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/app" className="inline-flex items-center h-11 px-7 rounded-full bg-accent text-accent-ink text-[13px] font-semibold uppercase tracking-[0.05em] lime-glow hover:brightness-105">
            Seal a stop
          </Link>
          <Link href="/how-it-works" className="inline-flex items-center h-11 px-7 rounded-full border border-line-strong text-[13px] font-medium uppercase tracking-[0.05em] hover:border-accent/60">
            How it works
          </Link>
        </div>
      </section>

      <section className="horizon mt-24 sm:mt-28 pt-10">
        <ProductFrame />
        <p className="relative mt-3 text-center text-[11.5px] text-faint">A preview of the app. Prices are examples.</p>
      </section>

      {/* ── before / after ── */}
      <section className="mt-28 text-center">
        <h2 className="headline text-[34px] sm:text-[44px] leading-tight">
          They can&rsquo;t hunt <strong>what they can&rsquo;t see</strong>
        </h2>
        <div className="mt-12 grid lg:grid-cols-2 gap-4 text-left">
          <HuntCard visible />
          <HuntCard />
        </div>
      </section>

      {/* ── phases ── */}
      <section className="mt-32 text-center">
        <h2 className="headline text-[34px] sm:text-[44px] leading-tight">
          Set it once, <strong>sleep easy</strong>
        </h2>
        <p className="mt-4 mx-auto max-w-xl text-[15px] text-soft">
          Set it once. Blindstop does the watching, and closes your position for you.
        </p>
        <div className="mt-14 grid md:grid-cols-3 gap-4 text-left">
          <Phase
            name="Hide"
            n={1}
            text="Pick your stop-loss or take-profit price. It is locked before it leaves your device, so only Blindstop's secure watcher can read it."
            rows={[
              ["Who can see your price", "only you"],
              ["Orders anyone can see", "none"],
              ["Time to set up", "1 minute"],
            ]}
          />
          <Phase
            name="Watch"
            n={2}
            highlight
            text="A sealed computer that not even we can look inside checks the price around the clock, using Hyperliquid's own price."
            rows={[
              ["Checks the price every", "3 seconds"],
              ["Runs while you sleep", "yes"],
              ["Can anyone fake the price", "no"],
            ]}
          />
          <Phase
            name="Close"
            n={3}
            text="When the price reaches your level, your position is closed right away and the result is recorded publicly, so you can always check what happened."
            rows={[
              ["Closes your position", "instantly"],
              ["Tries again if needed", "up to 5×"],
              ["Can it withdraw your money", "never"],
            ]}
          />
        </div>
      </section>

      {/* ── features ── */}
      <section className="mt-32 grid lg:grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="card p-6 sm:p-8 flex flex-col justify-between min-h-[320px] overflow-hidden relative">
          <div className="relative">
            <h2 className="headline text-[30px] sm:text-[36px] leading-tight">
              Why traders use <strong>hidden stops</strong>
            </h2>
            <ul className="mt-6 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
              <Check>No one can see your stop</Check>
              <Check>No one knows which coin</Check>
              <Check>Your money can&rsquo;t be withdrawn</Check>
              <Check>You can prove it later</Check>
            </ul>
          </div>
          <div className="relative mt-8 grid gap-4 sm:max-w-[48%]">
            <Fact k="Attack-tested" v="9 of 9 break-in attempts blocked" />
            <Fact k="Open source" v="anyone can check the code" />
          </div>
          <Link href="/app" className="relative mt-7 self-start inline-flex items-center h-9 px-5 rounded-full bg-accent text-accent-ink text-xs font-semibold uppercase tracking-[0.05em]">
            Get started
          </Link>
          <Bars />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Feature icon={<IconEye />} title="Nothing to hunt" text="Normal stops sit in a public list anyone can read. Yours never does, until the moment it closes your trade." />
          <Feature icon={<IconKey />} title="Your money stays yours" text="Blindstop can only close your positions. It can never withdraw, send or move your funds anywhere." />
          <Feature icon={<IconShield />} title="Can't be tricked" text="Blindstop reads the price straight from Hyperliquid. Nobody can feed it a fake price to trigger your stop." />
          <Feature icon={<IconCheck />} title="Proof when you need it" text="After a stop triggers, you can publish proof of exactly where it was and when you set it." />
          <Feature icon={<IconLife />} title="A safety net" text="Optionally keep a wide backup stop near your liquidation price, so you're covered even if Blindstop ever goes quiet." />
          <Feature icon={<IconPulse />} title="Always know it's on" text="Every page shows whether protection is running, and when it last checked the price." />
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
            What&rsquo;s hidden, <strong>honestly</strong>
          </h2>
          <p className="mt-3 text-sm text-soft max-w-md">No fine print. Here is exactly what other people can and can&rsquo;t see.</p>
          <div className="mt-6 grid sm:grid-cols-2 gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-accent-text mb-3">Hidden</div>
              <ul className="grid gap-2">
                <Check>Your stop-loss and take-profit prices</Check>
                <Check>How much you&rsquo;re protecting</Check>
                <Check>Which coin it&rsquo;s for</Check>
                <Check>Which wallet it belongs to</Check>
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Still public</div>
              <ul className="grid gap-2 text-[13px] text-muted">
                <li>Your open position, like any trade on Hyperliquid</li>
                <li>The moment your stop closes it</li>
                <li>That your account uses Blindstop</li>
              </ul>
            </div>
          </div>
          <Link href="/how-it-works" className="mt-8 inline-flex items-center h-9 px-5 rounded-full border border-line-strong text-xs font-medium uppercase tracking-[0.05em] hover:border-accent/60">
            Learn more
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

function HuntCard({ visible }: { visible?: boolean }) {
  const pts = [62, 58, 60, 52, 55, 47, 50, 44, 47, 40, 44, 38, 42, 46, 43, 49, 46, 53, 50, 57];
  const path = pts.map((y, i) => `${i ? "L" : "M"}${10 + i * 15.5},${y}`).join(" ");
  return (
    <div className={cx("card p-6 min-w-0", !visible && "lime-glow")}>
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-medium">{visible ? "A normal stop-loss" : "A Blindstop stop-loss"}</h3>
        <span className={cx("text-xs", visible ? "text-bad" : "text-accent-text")}>{visible ? "Everyone can see it" : "No one can see it"}</span>
      </div>
      <svg viewBox="0 0 320 110" className="mt-5 w-full h-36" aria-hidden>
        <path d={path} fill="none" stroke="var(--soft)" strokeWidth="2" strokeLinejoin="round" />
        {visible ? (
          <>
            <line x1="0" x2="320" y1="80" y2="80" stroke="var(--bad)" strokeDasharray="4 4" />
            <text x="316" y="96" textAnchor="end" fontSize="10" fill="var(--bad)" fontFamily="var(--font-geist-sans)">Your stop · $94,800</text>
            <path d="M196 48 L204 78" stroke="var(--bad)" strokeWidth="2" markerEnd="url(#a)" />
            <defs>
              <marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="var(--bad)" />
              </marker>
            </defs>
          </>
        ) : (
          <text x="316" y="96" textAnchor="end" fontSize="10" fill="var(--accent-text)" fontFamily="var(--font-geist-sans)">Your stop · hidden</text>
        )}
      </svg>
      <p className="mt-3 text-[13.5px] leading-relaxed text-soft">
        {visible
          ? "Your price sits in a public list. Traders with deep pockets can see where many stops are bunched up, push the price there to trigger them, then let it bounce back."
          : "Your price is locked away. There is nothing in the public list to aim at, so nobody can push the price to your stop on purpose."}
      </p>
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
              <dd className="ml-auto text-[13px] text-soft">{v}</dd>
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
      <text x="110" y="24" textAnchor="middle" fontFamily="var(--font-geist-sans)" fontSize="10" fill="var(--muted)">locked · only Blindstop can open</text>
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
          <span className="hidden sm:inline">My positions</span>
          <span className="ml-auto inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-good/35 text-good">
            <span className="size-1.5 rounded-full bg-current" /> Protection on
          </span>
        </div>
        <div className="grid sm:grid-cols-[1.2fr_1fr]">
          <div className="p-4 sm:p-5 border-b sm:border-b-0 sm:border-r border-line">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[14px]">BTC-PERP</span>
              <span className="text-[11px] h-5 px-2 rounded-full border border-good/35 text-good inline-flex items-center">LONG 0.25</span>
              <span className="ml-auto font-mono text-[12.5px] text-good">+$412.80</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-[11px] uppercase tracking-[0.08em] text-muted">
              <div>Price now<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-fg">96,412</div></div>
              <div>Entry<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-fg">94,760</div></div>
              <div>Liquidation<div className="mt-1 font-mono text-[13px] normal-case tracking-normal text-warn">81,930</div></div>
            </div>
            <svg viewBox="0 0 300 90" className="mt-4 w-full h-24" aria-hidden>
              {Array.from({ length: 34 }, (_, i) => {
                const y = Math.round((50 + Math.sin(i / 3.2) * 16 - i * 0.7) * 10) / 10;
                const hh = 8 + ((i * 37) % 17);
                const up = Math.sin(i / 2.1) > -0.2;
                return <rect key={i} x={Math.round((6 + i * 8.6) * 10) / 10} y={y - hh / 2} width="4.2" height={hh} rx="1" fill={up ? "var(--soft)" : "var(--faint)"} opacity={0.55} />;
              })}
              <line x1="0" x2="300" y1="74" y2="74" stroke="var(--accent)" strokeDasharray="3 4" opacity="0.8" />
              <text x="296" y="70" textAnchor="end" fontSize="8" fontFamily="var(--font-geist-mono)" fill="var(--accent-text)">your stop · only you can see it</text>
            </svg>
          </div>
          <div className="p-4 sm:p-5 grid gap-3 content-start">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted">Your hidden orders</div>
            {[
              ["Stop-loss", "91,500", "−5.1%"],
              ["Take-profit", "103,000", "+6.8%"],
            ].map(([k, v, d]) => (
              <div key={k} className="flex items-center gap-3 rounded-xl border border-line px-3 h-10 font-mono text-[12.5px]">
                <span className={cx("font-sans w-[74px]", k === "Stop-loss" ? "text-accent-text" : "text-soft")}>{k}</span>
                <span>{v}</span>
                <span className="text-muted">{d}</span>
                <span className="ml-auto text-[10.5px] h-5 px-2 rounded-full border border-accent/40 text-accent-text inline-flex items-center font-sans">hidden</span>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-between rounded-xl bg-panel-2 px-3 h-10 text-[12px]">
              <span className="text-muted">Orders anyone can see</span>
              <span className="font-mono text-good">0</span>
            </div>
            <div className="h-10 rounded-full bg-accent text-accent-ink grid place-items-center text-[12px] font-semibold uppercase tracking-[0.05em]">
              Set hidden stop
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
