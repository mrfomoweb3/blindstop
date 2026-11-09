import { formatDec, parseDec, parseSignedDec } from "@blindstop/shared";

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Group thousands for display only; never parse this back. */
export function px(s: string | null | undefined): string {
  if (!s) return "—";
  const [i, f] = s.split(".");
  const neg = i!.startsWith("-");
  const digits = (neg ? i!.slice(1) : i!).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${digits}${f ? "." + f : ""}`;
}

export function usd(s: string | null | undefined, decimals = 2): string {
  if (!s) return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function short(s: string, head = 6, tail = 4): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function nsToDate(ns: string | null | undefined): Date | null {
  if (!ns) return null;
  return new Date(Number(BigInt(ns) / 1_000_000n));
}

export function dateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

/** Signed distance from `mark` to `level` as a percentage string ("−2.41%"). */
export function distancePct(mark: string | null | undefined, level: string): string {
  if (!mark) return "—";
  try {
    const m = parseDec(mark);
    const l = parseDec(level);
    if (m === 0n) return "—";
    const bps = ((l - m) * 1_000_000n) / m; // 10^-4 %
    const sign = bps < 0n ? "−" : "+";
    const a = bps < 0n ? -bps : bps;
    return `${sign}${a / 10_000n}.${(a % 10_000n).toString().padStart(4, "0").slice(0, 2)}%`;
  } catch {
    return "—";
  }
}

export function absSize(szi: string): string {
  return formatDec(parseSignedDec(szi) < 0n ? -parseSignedDec(szi) : parseSignedDec(szi));
}
