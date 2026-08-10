import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo home-link contract", () => {
  it("wraps the full logo in an accessible home link when requested", () => {
    const html = renderToStaticMarkup(<Logo href="/w/moa-team" />);

    expect(html).toContain('href="/w/moa-team"');
    expect(html).toContain('aria-label="MoaWork 홈"');
    expect(html).toContain('aria-label="MoaWork 로고"');
  });

  it("does not invent navigation when no home target is supplied", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).not.toContain("<a");
  });
});
