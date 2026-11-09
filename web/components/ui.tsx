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
    "inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium rounded-[6px] transition-colors disabled:opacity-45 disabled:cursor-not-allowed select-none whitespace-nowrap";
  const v: Record<Variant, string> = {
    primary: "bg-fg text-bg hover:bg-fg/85",
    secondary: "border border-line-strong bg-panel hover:border-fg/40",
    ghost: "text-muted hover:text-fg",
    danger: "border border-bad/40 text-bad hover:bg-bad/8",
  };
  return (
    <button className={cx(base, v[variant], className)} disabled={busy || rest.disabled} {...rest}>
      {busy && <span aria-hidden className="size-1.5 rounded-full bg-current pulse" />}
      {children}
    </button>
  );
}

/** The one place the accent fills a surface: sealing. */
export function SealButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  const { className, busy, children, ...rest } = props;
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-semibold rounded-[6px] bg-accent text-accent-ink hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed",
        className,
      )}
      disabled={busy || rest.disabled}
      {...rest}
    >
      {busy && <span aria-hidden className="size-1.5 rounded-full bg-current pulse" />}
      {children}
    </button>
  );
}

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border border-line bg-panel rounded-[8px] min-w-0", className)}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 h-11 border-b border-line">
          <h2 className="text-[13px] font-medium tracking-tight">{title}</h2>
          {aside && <div className="text-xs text-muted">{aside}</div>}
        </header>
      )}
      <div className="p-4 sm:p-5 min-w-0">{children}</div>
    </section>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2 text-xs text-muted mb-1.5">
      <span className="font-medium text-fg/80">{children}</span>
      {hint && <span>{hint}</span>}
    </span>
  );
}

export function Input({ className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      className={cx(
        "w-full h-10 px-3 rounded-[6px] border border-line-strong bg-bg text-sm placeholder:text-faint focus:border-fg/60 outline-none",
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
    good: "text-good border-good/40",
    warn: "text-warn border-warn/40",
    bad: "text-bad border-bad/40",
    accent: "text-accent border-accent/50",
  };
  return (
    <span className={cx("inline-flex items-center gap-1.5 h-6 px-2 rounded-full border text-[11.5px] font-medium tabular", t[tone])}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-1 font-mono tabular text-[15px] truncate">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted truncate">{sub}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "warn" | "bad" | "good"; title?: ReactNode; children: ReactNode }) {
  const t = {
    neutral: "border-line bg-sunken",
    warn: "border-warn/35 bg-warn/6",
    bad: "border-bad/35 bg-bad/6",
    good: "border-good/35 bg-good/6",
  }[tone];
  return (
    <div className={cx("rounded-[6px] border px-3.5 py-3 text-[13px] leading-relaxed", t)}>
      {title && <div className="font-medium mb-0.5">{title}</div>}
      <div className="text-fg/80">{children}</div>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="font-mono text-[12px] leading-[1.6] bg-sunken border border-line rounded-[6px] p-3 overflow-x-auto whitespace-pre max-w-full min-w-0">{children}</pre>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="underline decoration-line-strong underline-offset-[3px] hover:decoration-fg">
      {children}
    </a>
  );
}
