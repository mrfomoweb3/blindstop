"use client";

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
      setErr((e as Error).message);
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
        <p className="text-sm text-fg/75">
          Trading wallet <span className="font-mono">{t.address}</span> is stored in this browser, encrypted. Unlock it to continue.
        </p>
        <label>
          <Label>Passphrase</Label>
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
        <p className="text-sm text-fg/75">
          Your trading wallet is <span className="font-mono break-all">{t.address}</span>. Its key exists only in this browser,
          encrypted with your passphrase. Download the encrypted backup before you continue. Without it, clearing your browser loses the wallet.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={download}>Download encrypted backup</Button>
        </div>
      </div>
    );
  }

  const tooShort = pass.length > 0 && pass.length < 10;
  const mismatch = pass2.length > 0 && pass !== pass2;
  return (
    <div className="grid gap-4 pt-3 max-w-xl">
      <p className="text-sm text-fg/75">
        Use a <strong>fresh</strong> wallet that holds nothing else. The Blindstop agent you approve next can close its positions, so keep
        your main wallet out of it. The key is generated here and never leaves this browser.
      </p>
      <div className="flex gap-1 text-xs">
        {(["create", "import"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`px-2.5 h-7 rounded-[5px] ${mode === m ? "bg-sunken text-fg" : "text-muted"}`}>
            {m === "create" ? "Create new" : "Import key"}
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
            <Label hint="0x + 64 hex">Private key</Label>
            <Input mono type="password" autoComplete="off" spellCheck={false} value={pk} onChange={(e) => setPk(e.target.value)} />
          </label>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <label>
            <Label hint={tooShort ? "at least 10 characters" : undefined}>Passphrase</Label>
            <Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <label>
            <Label hint={mismatch ? "does not match" : undefined}>Repeat</Label>
            <Input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </label>
        </div>
        {err && <Notice tone="bad">{err}</Notice>}
        <div>
          <Button variant="primary" busy={busy} type="submit" disabled={pass.length < 10 || pass !== pass2 || (mode === "import" && !pk)}>
            {mode === "create" ? "Create trading wallet" : "Import trading wallet"}
          </Button>
        </div>
      </form>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Restore from a backup file</summary>
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
