import type { ReactNode } from "react";
import { cx } from "../ui";

export function Step({
  n,
  title,
  done,
  open,
  summary,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className={cx("card", open && "lime-glow")}>
      <div className="flex items-center gap-3 px-4 sm:px-5 h-14">
        <span
          className={cx(
            "grid place-items-center size-6 rounded-full text-[11px] font-mono shrink-0",
            done ? "bg-accent text-accent-ink" : open ? "border border-accent text-accent-text" : "border border-line-strong text-muted",
          )}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        <h3 className={cx("text-sm font-medium", !open && !done && "text-muted")}>{title}</h3>
        {summary && <div className="ml-auto min-w-0 text-xs text-muted truncate">{summary}</div>}
      </div>
      {open && <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-line">{children}</div>}
    </li>
  );
}
