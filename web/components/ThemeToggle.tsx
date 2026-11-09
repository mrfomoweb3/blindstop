"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      setTheme((localStorage.getItem("theme") as Theme) || "system");
    } catch {}
  }, []);
  const next = () => {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };
  return (
    <button onClick={next} className="h-8 px-2 text-xs text-muted hover:text-fg font-mono" aria-label={`Theme: ${theme}. Change theme`}>
      {theme === "system" ? "◐ auto" : theme === "light" ? "○ light" : "● dark"}
    </button>
  );
}
