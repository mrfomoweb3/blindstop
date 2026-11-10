"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { WatcherPill } from "./WatcherPill";
import { cx } from "./ui";

const LINKS = [
  ["/", "Home"],
  ["/app", "App"],
  ["/app/orders", "Orders"],
  ["/verify", "Verify"],
  ["/watcher", "Watcher"],
  ["/how-it-works", "How it works"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 pt-3 sm:pt-4 px-3 sm:px-4">
      <div className="mx-auto max-w-6xl h-14 pl-4 pr-2 flex items-center gap-3 rounded-full border border-line bg-bg/80 backdrop-blur-md">
        <Link href="/" aria-label="Blindstop home" className="shrink-0">
          <Logo />
        </Link>
        <nav className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
          <ul className="flex items-center justify-start lg:justify-center gap-0.5 text-[13.5px]">
            {LINKS.map(([href, label]) => {
              const active = href === "/" || href === "/app" ? path === href : path.startsWith(href);
              return (
                <li key={href} className={href === "/" ? "hidden lg:block" : undefined}>
                  <Link
                    href={href}
                    className={cx("px-3 py-1.5 rounded-full whitespace-nowrap transition", active ? "text-fg bg-panel-2" : "text-muted hover:text-fg")}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <WatcherPill />
        <span className="hidden md:block">
          <ThemeToggle />
        </span>
        <Link
          href="/app"
          className="hidden sm:inline-flex items-center h-10 px-5 rounded-full border border-line-strong text-[13px] font-medium uppercase tracking-[0.04em] hover:border-accent/60"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}
