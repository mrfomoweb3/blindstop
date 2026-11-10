"use client";

import { useEffect, useState } from "react";

/** Dark is the default; light is opt-in and remembered. */
export function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    try {
      setLight(localStorage.getItem("theme") === "light");
    } catch {}
  }, []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    try {
      if (next) localStorage.setItem("theme", "light");
      else localStorage.removeItem("theme");
    } catch {}
    if (next) document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  };
  return (
    <button
      onClick={toggle}
      className="grid place-items-center size-9 rounded-full border border-line-strong text-muted hover:text-fg"
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark theme" : "Light theme"}
    >
      {light ? (
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      )}
    </button>
  );
}
