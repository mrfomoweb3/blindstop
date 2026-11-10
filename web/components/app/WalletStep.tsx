"use client";

import { friendly } from "@/lib/errors";
import { useState } from "react";
import { useTrading } from "@/lib/trading";
import * as vault from "@/lib/vault";
import { Button, Input, Label, Notice } from "../ui";

export function WalletStep({ onBackedUp }: { onBackedUp: () => void }) {
  const t = useTrading();
  const [mode, setMode] = useState<"create" | "import">("create");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [pk, setPk] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const blob = await vault.exportBackup();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `blindstop-backup-${t.address?.slice(0, 8) ?? "wallet"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    onBackedUp();
  };

  if (t.status === "locked") {
    return (
      <form className="grid gap-3 max-w-md pt-3" onSubmit={(e) => (e.preventDefault(), run(() => t.unlock(pass)))}>
        <p className="text-sm text-soft">
          Your trading wallet is saved in this browser and locked with your password. Unlock it to continue.
        </p>
        <label>
          <Label>Password</Label>
          <Input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        {err && <Notice tone="bad">{err}</Notice>}
        <div>
          <Button variant="primary" busy={busy} type="submit">Unlock</Button>
        </div>
      </form>
    );
  }

  if (t.status === "unlocked") {
    return (
      <div className="grid gap-3 pt-3 max-w-xl">
        <p className="text-sm text-soft">
          Your trading wallet is ready. It lives only in this browser, locked with your password. Download a backup now: if you
          clear your browser without one, the wallet is gone for good.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={download}>Download backup</Button>
        </div>
      </div>
    );
  }

  const tooShort = pass.length > 0 && pass.length < 10;
  const mismatch = pass2.length > 0 && pass !== pass2;
  return (
    <div className="grid gap-4 pt-3 max-w-xl">
      <p className="text-sm text-soft">
        This is a separate wallet just for trading with Blindstop, so your main wallet stays out of it. It&rsquo;s created right here
        and never leaves your device. Pick a password to lock it.
      </p>
      <div className="flex gap-1 text-xs">
        {(["create", "import"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`px-2.5 h-7 rounded-full ${mode === m ? "bg-sunken text-fg" : "text-muted"}`}>
            {m === "create" ? "Create new" : "Use an existing one"}
          </button>
        ))}
      </div>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pass !== pass2) return setErr("passphrases differ");
          void run(() => (mode === "create" ? t.create(pass) : t.importKey(pk, pass)));
        }}
      >
        {mode === "import" && (
          <label>
            <Label hint="starts with 0x">Private key</Label>
            <Input mono type="password" autoComplete="off" spellCheck={false} value={pk} onChange={(e) => setPk(e.target.value)} />
          </label>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <label>
            <Label hint={tooShort ? "at least 10 characters" : undefined}>Password</Label>
            <Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <label>
            <Label hint={mismatch ? "doesn't match" : undefined}>Repeat password</Label>
            <Input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </label>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div>
          <Button variant="primary" busy={busy} type="submit" disabled={pass.length < 10 || pass !== pass2 || (mode === "import" && !pk)}>
            {mode === "create" ? "Create wallet" : "Use this wallet"}
          </Button>
        </div>
      </form>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">I have a backup file</summary>
        <input
          className="mt-2 text-xs"
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(async () => (await vault.importBackup(f), await t.refresh()));
          }}
        />
      </details>
    </div>
  );
}
