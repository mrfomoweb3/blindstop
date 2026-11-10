"use client";

import { useState } from "react";

/** A wallet address people can recognize and copy, without a wall of hex. */
export function Address({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      title={`${label ? label + ": " : ""}${value} (click to copy)`}
      className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-line-strong bg-panel-2 text-[12.5px] hover:border-accent/50"
    >
      <span className="font-mono">{short}</span>
      <span className={copied ? "text-accent-text" : "text-muted"}>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
