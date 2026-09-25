"use client";
import { useLayoutEffect } from "react";
import { AppearanceControl } from "@/components/appearance/AppearanceControl";
import { applyAppearancePreference, readAppearancePreference } from "@/components/appearance/RouteAppearance";

/** Existing isolated visual fixture: exercise the real production appearance layer. */
export function VisualAppearanceProbe({ accent, controls }: { accent: "new" | "contact"; controls: boolean }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const attrs = ["data-mw-accent", "data-mw-effects", "data-moa-theme"];
    const previous = attrs.map(name => root.getAttribute(name));
    const styles = ["--mw-company-grad", "--mw-company-solid"];
    const oldStyles = styles.map(name => root.style.getPropertyValue(name));
    root.setAttribute("data-mw-accent", accent);
    applyAppearancePreference(readAppearancePreference());
    return () => {
      attrs.forEach((name, i) => previous[i] === null ? root.removeAttribute(name) : root.setAttribute(name, previous[i]!));
      styles.forEach((name, i) => oldStyles[i] ? root.style.setProperty(name, oldStyles[i]) : root.style.removeProperty(name));
    };
  }, [accent]);
  return controls ? <div className="mb-3 flex justify-end"><AppearanceControl /></div> : null;
}
