"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { WatcherPill } from "./WatcherPill";
import { cx } from "./ui";

const LINKS = [
  ["/app", "App"],
  ["/app/orders", "Orders"],
  ["/verify", "Verify"],
  ["/watcher", "Watcher"],
  ["/how-it-works", "How it works"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-[2px]">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
        <Link href="/" aria-label="Blindstop home" className="shrink-0">
          <Logo />
        </Link>
        <nav className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
          <ul className="flex items-center gap-0.5 text-[13px]">
            {LINKS.map(([href, label]) => {
              const active = href === "/app" ? path === "/app" : path.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cx("px-2.5 py-1.5 rounded-[5px] whitespace-nowrap", active ? "text-fg bg-sunken" : "text-muted hover:text-fg")}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <WatcherPill />
        <span className="hidden md:inline">
          <ThemeToggle />
        </span>
      </div>
    </header>
  );
}
