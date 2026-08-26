"use client";

import { useLayoutEffect } from "react";

export function VisualThemeProbe({ theme }: { theme: "light" | "dark" | null }) {
  useLayoutEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (previous) root.setAttribute("data-theme", previous);
      else root.removeAttribute("data-theme");
    };
  }, [theme]);
  return null;
}
