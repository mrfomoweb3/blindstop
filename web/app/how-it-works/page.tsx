import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Details } from "@/components/ui";

export const metadata: Metadata = { title: "How it works" };

const STEPS: [string, string, string][] = [
  ["1", "You set a stop", "Choose the price where you want out. Before it leaves your device it's locked, so only Blindstop's secure watcher can read it."],
  ["2", "It's watched, out of sight", "A sealed computer checks Hyperliquid's price every few seconds. Your stop isn't in any public list, so nobody can aim at it."],
  ["3", "Your trade is closed", "When the price reaches your level, the watcher closes your position straight away and records what happened."],
  ["4", "You can prove it", "Afterwards you can publish proof of exactly where your stop was and when you set it, so anyone can check."],
];

const FAQ: [string, ReactNode][] = [
  [
    "Why do stops get hunted?",
    "On Hyperliquid, every order is public, including stop-losses. Tools show where many stops are bunched together, and large traders can push the price into that zone to trigger them, then let it bounce back. Hidden stops give them nothing to aim at.",
  ],
  [
    "Can Blindstop take my money?",
    "No. You give it permission to close your positions, nothing more. Hyperliquid itself doesn't let that kind of permission withdraw or send funds.",
  ],
  [
    "Who can see my stop price?",
    "Only you, on your device, and the secure watcher that has to act on it. Not other traders, not Hyperliquid's public order list, and not the people who run Blindstop.",
  ],
  [
    "What can other people still see?",
    "Your open position, like any trade on Hyperliquid, including its liquidation price. They also see the moment your stop closes it, and that your account uses Blindstop.",
  ],
  [
    "What if Blindstop goes offline?",
    <>
      Then stops can&rsquo;t trigger until it&rsquo;s back. You can always see whether it&rsquo;s running on the{" "}
      <Link href="/watcher" className="underline underline-offset-2">Status</Link> page. To be safe, keep the optional safety net on: a backup
      stop near your liquidation price that protects you even if Blindstop is down.
    </>,
  ],
  [
    "Is it as fast as a normal stop?",
    "Almost. Your stop triggers within a few seconds of the price reaching it. In a very sudden move, the price you get can be a little worse than a stop that sits on the exchange.",
  ],
  [
    "Do I need a new wallet?",
    "Yes, a separate trading wallet just for Blindstop, created in the app in a few seconds. It keeps your main wallet out of it entirely.",
  ],
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 grid grid-cols-1 gap-12">
      <div className="text-center pt-6">
        <h1 className="headline text-[36px] sm:text-[48px] leading-tight">
          How <strong>Blindstop</strong> works
        </h1>
        <p className="mt-4 text-[15px] text-soft max-w-xl mx-auto">Hidden stop-losses in four steps, and straight answers about what you&rsquo;re trusting.</p>
      </div>

      <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STEPS.map(([n, title, text], i) => (
          <li key={n} className={i === 1 ? "card p-6 lime-glow" : "card p-6"}>
            <span
              className={
                i === 1
                  ? "grid place-items-center size-9 rounded-full bg-accent text-accent-ink font-medium"
                  : "grid place-items-center size-9 rounded-full border border-line-strong"
              }
            >
              {n}
            </span>
            <h2 className="mt-4 text-[15px] font-medium">{title}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{text}</p>
          </li>
        ))}
      </ol>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="card p-6">
          <h2 className="text-lg font-light tracking-tight text-accent-text">Hidden from everyone</h2>
          <ul className="mt-4 grid gap-2.5">
            <Check>Your stop-loss and take-profit prices</Check>
            <Check>How much of your position they&rsquo;ll close</Check>
            <Check>Which coin they&rsquo;re for</Check>
            <Check>Which wallet they protect</Check>
          </ul>
        </div>
        <div className="card p-6">
          <h2 className="text-lg font-light tracking-tight">Still visible, as on any exchange</h2>
          <ul className="mt-4 grid gap-2.5 text-[13px] text-muted list-disc pl-5">
            <li>Your open position and its liquidation price</li>
            <li>The moment a stop closes your trade</li>
            <li>That your account uses Blindstop, and when you set stops</li>
          </ul>
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="headline text-[28px] sm:text-[34px] text-center mb-3">
          Common <strong>questions</strong>
        </h2>
        {FAQ.map(([q, a]) => (
          <details key={q} className="card group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
              {q}
              <span className="text-muted transition group-open:rotate-45 text-xl leading-none" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-3 text-[13.5px] leading-relaxed text-soft">{a}</p>
          </details>
        ))}
      </section>

      <Details title="For the technically curious">
        <p>
          Stops are encrypted in the browser (X25519, HKDF-SHA256, ChaCha20-Poly1305) to a key that exists only inside an OutLayer enclave
          (Intel TDX). The NEAR contract stores only the 316-byte ciphertext and a SHA-256 commitment. Each order also carries a signature
          from the trading wallet, so nobody can seal an order against someone else&rsquo;s wallet.
        </p>
        <p>
          Every few seconds the enclave reads the active orders from two independent NEAR RPC providers (they must agree) and the mark
          price from Hyperliquid. When a level is crossed it sends a reduce-only IOC close as the user&rsquo;s approved agent and returns an
          ed25519-signed report, which the contract verifies before marking the order as triggered.
        </p>
        <p>
          The full threat model, test evidence and source code are in the{" "}
          <a className="underline underline-offset-2" href="https://github.com/mrfomoweb3/blindstop" target="_blank" rel="noreferrer">
            GitHub repository
          </a>
          .
        </p>
      </Details>
    </div>
  );
}
