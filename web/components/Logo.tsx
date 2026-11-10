/** A price line with the level blacked out: the stop is there, you just can't see it. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid place-items-center size-7 rounded-lg bg-accent text-accent-ink" aria-hidden>
        <svg viewBox="0 0 32 32" className="size-[18px]">
          <path d="M3 19h8M21 19h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <rect x="13" y="8" width="6" height="16" rx="1.6" fill="currentColor" />
        </svg>
      </span>
      <span className="font-semibold tracking-[-0.02em] text-[15px]">Blindstop</span>
    </span>
  );
}
