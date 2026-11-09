/** A price line with the level blacked out: the stop is there, you just can't see it. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
        <path d="M3 20h9M20 20h9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        <rect x="13" y="9" width="6" height="15" rx="1.5" fill="var(--accent)" />
      </svg>
      <span className="font-semibold tracking-[-0.02em] text-[15px]">Blindstop</span>
    </span>
  );
}
