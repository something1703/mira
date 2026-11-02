"use client";

import { Button } from "@mira/ui";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "mira-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light by default; follows the system until the person chooses. Never needed to read the page. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the DOM after hydration
    setTheme(current === "dark" || current === "light" ? current : systemTheme());
  }, []);

  function toggle() {
    const next: Theme = (theme ?? systemTheme()) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  }

  return (
    // The visible text is the accessible name (WCAG 2.5.3). Before hydration it is neutral.
    <Button variant="secondary" onClick={toggle}>
      {theme === null ? "Switch theme" : theme === "dark" ? "Switch to light" : "Switch to dark"}
    </Button>
  );
}
