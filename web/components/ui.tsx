import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  const base =
    "inline-flex items-center justify-center gap-2 h-10 px-5 text-[13px] font-medium rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap";
  const v: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:brightness-105 lime-glow",
    secondary: "border border-line-strong bg-panel-2 text-fg hover:border-fg/30",
    ghost: "text-muted hover:text-fg px-3",
    danger: "border border-bad/40 text-bad hover:bg-bad/10",
  };
  return (
    <button className={cx(base, v[variant], className)} disabled={busy || rest.disabled} {...rest}>
      {busy && <span aria-hidden className="size-1.5 rounded-full bg-current pulse" />}
      {children}
    </button>
  );
}

/** Sealing is the primary action everywhere. */
export function SealButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  const { className, busy, children, ...rest } = props;
  return (
    <Button variant="primary" busy={busy} className={cx("h-11 px-6 uppercase tracking-[0.04em] font-semibold", className)} {...rest}>
      {children}
    </Button>
  );
}

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card min-w-0", className)}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 px-5 sm:px-6 h-12 border-b border-line">
          <h2 className="text-[13px] font-medium tracking-tight">{title}</h2>
          {aside && <div className="text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className="p-5 sm:p-6 min-w-0">{children}</div>
    </section>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2 text-xs text-muted mb-1.5">
      <span className="font-medium text-soft">{children}</span>
      {hint && <span>{hint}</span>}
    </span>
  );
}

export function Input({ className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      className={cx(
        "w-full h-11 px-4 rounded-xl border border-line-strong bg-sunken text-sm placeholder:text-faint focus:border-accent/60 outline-none transition",
        mono && "font-mono tabular",
        className,
      )}
      {...rest}
    />
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12.5px] tabular break-all", className)}>{children}</span>;
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

export function Pill({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  const t: Record<Tone, string> = {
    neutral: "text-muted border-line-strong",
    good: "text-good border-good/35 bg-good/5",
    warn: "text-warn border-warn/35 bg-warn/5",
    bad: "text-bad border-bad/35 bg-bad/5",
    accent: "text-accent-text border-accent/40 bg-accent/8",
  };
  return (
    <span className={cx("inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border text-[11.5px] font-medium tabular", t[tone])}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1.5 font-mono tabular text-[16px] truncate">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted truncate">{sub}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "warn" | "bad" | "good"; title?: ReactNode; children: ReactNode }) {
  const t = {
    neutral: "border-line bg-sunken",
    warn: "border-warn/30 bg-warn/6",
    bad: "border-bad/30 bg-bad/6",
    good: "border-good/30 bg-good/6",
  }[tone];
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-[13px] leading-relaxed", t)}>
      {title && <div className="font-medium mb-0.5">{title}</div>}
      <div className="text-soft">{children}</div>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="font-mono text-[12px] leading-[1.65] bg-sunken border border-line rounded-xl p-4 overflow-x-auto whitespace-pre max-w-full min-w-0 text-soft">
      {children}
    </pre>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-line-strong underline-offset-[3px] hover:decoration-accent">
      {children}
    </a>
  );
}

/** Small rounded square with an icon, as on feature cards. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid place-items-center size-9 shrink-0 rounded-xl border border-line-strong bg-panel-2 text-soft" aria-hidden>
      {children}
    </span>
  );
}

/** Lime check used in feature lists. */
export function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] text-soft">
      <span className="mt-[3px] grid place-items-center size-4 shrink-0 rounded-full border border-accent/50 text-accent-text" aria-hidden>
        <svg viewBox="0 0 12 12" className="size-2.5">
          <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] uppercase tracking-[0.14em] text-accent-text font-medium">{children}</p>;
}

/** Where the technical facts live: collapsed by default, for the curious. */
export function Details({ title = "Technical details", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-sunken/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 h-11 text-[13px] text-muted hover:text-fg select-none">
        <svg viewBox="0 0 12 12" className="size-3 transition group-open:rotate-90" aria-hidden>
          <path d="M4 2.5 7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1 text-[13px] text-soft grid gap-3 min-w-0">{children}</div>
    </details>
  );
}
