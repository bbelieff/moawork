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
    // BBE-116/D44: 마우스오버로 "홈" 임을 알 수 있어야 한다.
    expect(html).toContain('title="홈"');
  });

  it("does not invent navigation when no home target is supplied", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).not.toContain("<a");
  });
});
