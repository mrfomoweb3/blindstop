import { NextResponse, type NextRequest } from "next/server";

/**
 * Strict CSP with a per-request nonce: only our own scripts run. Network access is limited to
 * NEAR RPCs, Hyperliquid, OutLayer, the keeper and the wallets' own endpoints.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const connect = [
    "'self'",
    ...(process.env.NEXT_PUBLIC_NEAR_RPCS ?? "https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org").split(","),
    "https://rpc.testnet.near.org",
    "https://rpc.mainnet.near.org",
    "https://*.fastnear.com",
    "https://api.hyperliquid.xyz",
    "https://api.hyperliquid-testnet.xyz",
    "https://testnet-api.outlayer.ai",
    "https://api.outlayer.ai",
    "https://arb1.arbitrum.io",
    "https://*.mynearwallet.com",
    "https://*.meteorwallet.app",
    "https://*.intear.tech",
    "wss://*.intear.tech",
    process.env.NEXT_PUBLIC_KEEPER_URL ?? "",
    dev ? "ws://localhost:*" : "",
  ].filter(Boolean);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "frame-src https://*.intear.tech https://*.meteorwallet.app",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
