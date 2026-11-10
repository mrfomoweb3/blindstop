"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { base64ToBytes, bytesToHex, commitmentOf, decodeOrder, hexToBytes, type OrderView, type SealedOrder } from "@blindstop/shared";
import { Button, Details, Input, Label, Mono, Notice } from "@/components/ui";
import { CONTRACT } from "@/lib/config";
import { friendly } from "@/lib/errors";
import { nsToDate, px } from "@/lib/format";
import { views } from "@/lib/near";
import { useTrading } from "@/lib/trading";
import * as vault from "@/lib/vault";

interface Result {
  order: OrderView;
  recomputed: string;
  match: boolean;
  decoded: SealedOrder | null;
}

function parsePreimage(s: string): Uint8Array {
  const t = s.trim();
  return /^(0x)?[0-9a-fA-F]+$/.test(t) ? hexToBytes(t) : base64ToBytes(t);
}

function when(d: Date | null): string {
  return d ? d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function gap(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "less than a minute";
  if (m < 120) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
}

function VerifyInner() {
  const params = useSearchParams();
  const t = useTrading();
  const [id, setId] = useState(params.get("id") ?? "");
  const [paste, setPaste] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (tamper = false) => {
    setErr(null);
    setRes(null);
    setBusy(true);
    try {
      const order = await views.getOrder(id.trim());
      if (!order) throw new Error(`There is no stop number ${id}.`);
      let preimage: Uint8Array | null = null;
      if (paste.trim()) preimage = parsePreimage(paste);
      else if (order.revealed) preimage = base64ToBytes(order.revealed);
      else if (t.vaultKey) {
        const mine = (await vault.listOrders(t.vaultKey, CONTRACT)).find((l) => l.commitment === order.commitment);
        if (mine) preimage = base64ToBytes(mine.plaintext);
      }
      if (!preimage)
        throw new Error(
          order.status === "Active"
            ? "This stop is still protecting someone, so its price is private."
            : "The owner hasn't published proof for this stop yet.",
        );
      if (tamper) {
        preimage = preimage.slice();
        const i = Math.min(preimage.length - 1, 30);
        preimage[i] = preimage[i]! ^ 0x01;
      }
      const recomputed = bytesToHex(commitmentOf(preimage));
      let decoded: SealedOrder | null = null;
      try {
        decoded = decodeOrder(preimage);
      } catch {
        decoded = null;
      }
      setRes({ order, recomputed, match: recomputed === order.commitment, decoded });
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get("id")) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placed = res ? nsToDate(res.order.created_ns) : null;
  const firedMs = res?.order.fire && res.order.status === "Fired" ? Number(res.order.fire.ts_ms) : null;
  const d = res?.decoded;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-[30px] sm:text-[38px] font-light tracking-[-0.03em] leading-tight">Check a stop</h1>
        <p className="text-sm text-muted mt-1 max-w-xl">
          Every hidden stop is recorded the moment it&rsquo;s set, in a way nobody can change later. Enter a stop number to check that its
          price is exactly what was set, and when.
        </p>
      </div>
      <form
        className="card p-5 sm:p-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <label className="flex-1 min-w-[10rem]">
          <Label>Stop number</Label>
          <Input mono inputMode="numeric" placeholder="e.g. 6" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} />
        </label>
        <Button variant="primary" type="submit" busy={busy} disabled={!id}>
          Check
        </Button>
      </form>
      {err && <Notice>{err}</Notice>}

      {res && res.match && d && (
        <section className="card lime-glow p-6 sm:p-8 grid gap-5">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center size-10 rounded-full bg-accent text-accent-ink text-lg" aria-hidden>
              ✓
            </span>
            <div>
              <h2 className="text-lg font-medium">Genuine</h2>
              <p className="text-sm text-muted">This is exactly the stop that was set. It hasn&rsquo;t been changed.</p>
            </div>
          </div>
          <p className="text-[15px] leading-relaxed text-soft">
            A <strong className="text-fg font-medium">{d.kind === "stop_loss" ? "stop-loss" : "take-profit"}</strong> on{" "}
            <strong className="text-fg font-medium">{d.coin}</strong> at <strong className="text-fg font-medium">${px(d.triggerPx)}</strong>,
            protecting a {d.side} position, was set on <strong className="text-fg font-medium">{when(placed)}</strong>.
            {firedMs && placed && (
              <>
                {" "}
                It triggered <strong className="text-fg font-medium">{gap(firedMs - placed.getTime())}</strong> later and closed{" "}
                {res.order.fire!.filled_sz} {d.coin} at ${px(res.order.fire!.avg_px)}.
              </>
            )}
            {res.order.status === "Skipped" && " When the price got there, the trade had already been closed, so there was nothing to do."}
          </p>
        </section>
      )}

      {res && !res.match && (
        <section className="card p-6 sm:p-8 grid gap-2">
          <h2 className="text-lg font-medium text-bad">Doesn&rsquo;t match</h2>
          <p className="text-sm text-soft">
            This isn&rsquo;t the stop that was recorded. Either it was altered or it belongs to a different stop. A stop&rsquo;s price
            can&rsquo;t be changed once it&rsquo;s set.
          </p>
        </section>
      )}

      <Details>
        <p>
          When a stop is set, NEAR stores a fingerprint of it: <Mono>sha256(&quot;blindstop:v1:order&quot; ‖ order)</Mono>. Checking means
          hashing the published order in your browser and comparing the two.
        </p>
        {res && (
          <dl className="grid gap-1 font-mono text-[12px] break-all">
            <dt className="text-muted font-sans">Recorded fingerprint</dt>
            <dd>{res.order.commitment}</dd>
            <dt className="text-muted font-sans mt-2">Fingerprint of what you checked</dt>
            <dd className={res.match ? "text-good" : "text-bad"}>{res.recomputed}</dd>
          </dl>
        )}
        <label>
          <Label>Check your own data instead (hex or base64)</Label>
          <Input mono value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="optional" />
        </label>
        <div>
          <Button type="button" disabled={!id || busy} onClick={() => void check(true)}>
            Try a forged copy
          </Button>
          <span className="ml-3 text-xs text-muted">Changes one byte and checks again, to show a fake gets caught.</span>
        </div>
      </Details>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
