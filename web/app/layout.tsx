import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NEAR_NETWORK } from "@/lib/config";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Blindstop — private stop-losses for Hyperliquid", template: "%s · Blindstop" },
  description: "Private stop-losses for Hyperliquid. Nobody can see where your stops are, so nobody can hunt them.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { color: "#090a09" },
  ],
};

// Applies a saved theme before paint (no flash). Nonce-tagged for the CSP.
const THEME_SCRIPT = `try{if(localStorage.getItem("theme")==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-line mt-24">
            <div className="mx-auto max-w-6xl px-4 py-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
              <span>{NEAR_NETWORK === "testnet" ? "Test version · no real money" : "Live"}</span>
              <Link href="/how-it-works" className="hover:text-fg">How it works</Link>
              <Link href="/verify" className="hover:text-fg">Check a stop</Link>
              <a href="https://github.com/mrfomoweb3/blindstop" className="hover:text-fg" rel="noreferrer noopener" target="_blank">Source</a>
              <span className="md:hidden ml-auto">
                <ThemeToggle />
              </span>
              <span className="hidden md:inline ml-auto">Built at NEAR HACKATHON. MIT.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
