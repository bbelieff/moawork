import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

vi.mock("next/navigation", () => ({ usePathname: () => "/w/sample-lab" }));

describe("ThemeToggle tooltip contract", () => {
  it("keeps the icon-only action accessible without a native title tooltip", () => {
    const html = renderToStaticMarkup(<ThemeToggle />);

    expect(html).toContain('aria-label="다크/라이트 전환"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("다크/라이트 전환");
    expect(html).not.toMatch(/\stitle=/);
  });
});
