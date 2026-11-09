/**
 * Decimal strings as scaled bigints (10^-12 units), mirroring `enclave/core/src/decimal.rs`.
 * Anything compared or sent on chain goes through here, never through floats.
 */
export const SCALE_DIGITS = 12;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

export function isPlainDecimal(s: string): boolean {
  return /^\d{1,20}(\.\d{1,12})?$/.test(s);
}

export function parseDec(s: string): bigint {
  if (!isPlainDecimal(s)) throw new Error(`not a plain decimal: ${JSON.stringify(s)}`);
  const [i, f = ""] = s.split(".");
  return BigInt(i!) * SCALE + BigInt((f + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS));
}

/** Parses a signed decimal (Hyperliquid `szi`). */
export function parseSignedDec(s: string): bigint {
  return s.startsWith("-") ? -parseDec(s.slice(1)) : parseDec(s);
}

export function formatDec(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = a / SCALE;
  let f = (a % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${i}${f ? "." + f : ""}`;
}

/** Normalizes user input like "95,000.50" → "95000.5". Throws on anything ambiguous. */
export function normalizeDecimalInput(raw: string): string {
  const s = raw.trim().replace(/[,_\s]/g, "");
  if (!isPlainDecimal(s)) throw new Error("enter a plain number like 95000.5");
  return formatDec(parseDec(s));
}

/** |a − b| / b in basis points (b > 0), rounded down. */
export function distanceBps(a: bigint, b: bigint): bigint {
  if (b <= 0n) return 0n;
  const d = a > b ? a - b : b - a;
  return (d * 10_000n) / b;
}

const pow10 = (n: number) => 10n ** BigInt(n);
const digits = (v: bigint) => (v === 0n ? 0 : v.toString().length);

/** Round a non-negative scaled value to `decimals` places, down or up. */
export function roundTo(v: bigint, decimals: number, dir: "down" | "up"): bigint {
  if (decimals >= SCALE_DIGITS) return v;
  const step = pow10(SCALE_DIGITS - decimals);
  const down = (v / step) * step;
  return dir === "down" || down === v ? down : down + step;
}

/** Hyperliquid perp prices: ≤5 significant figures, ≤ 6 − szDecimals decimals, integers always valid. */
export function roundPerpPx(v: bigint, szDecimals: number, dir: "down" | "up"): bigint {
  const maxDec = Math.max(0, 6 - szDecimals);
  const intPart = v / SCALE;
  const sigDec = intPart > 0n ? 5 - digits(intPart) : SCALE_DIGITS - digits(v) + 5;
  return roundTo(v, Math.min(Math.max(sigDec, 0), maxDec), dir);
}

export function roundSizeDown(v: bigint, szDecimals: number): bigint {
  return roundTo(v, szDecimals, "down");
}

/** v × num / den, rounded. */
export function mulRatio(v: bigint, num: bigint, den: bigint, dir: "down" | "up"): bigint {
  const p = v * num;
  const q = p / den;
  return dir === "up" && p % den !== 0n ? q + 1n : q;
}
