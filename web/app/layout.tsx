import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CONTRACT, NEAR_NETWORK } from "@/lib/config";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Blindstop — hidden stops for Hyperliquid", template: "%s · Blindstop" },
  description: "Your stop-losses never touch the public order book. A sealed enclave on NEAR holds them, watches the price, and closes your position when your level is hit.",
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
              <span>
                Contract <span className="font-mono">{CONTRACT}</span> · NEAR {NEAR_NETWORK}
              </span>
              <Link href="/how-it-works" className="hover:text-fg">What is hidden, what is not</Link>
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
