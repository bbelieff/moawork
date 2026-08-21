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
    // 보이는 락업과 링크 이름이 목적을 전달한다. layout 에 남는 native title 은 쓰지 않는다.
    expect(html).not.toMatch(/\stitle=/);
  });

  it("does not invent navigation when no home target is supplied", () => {
    const html = renderToStaticMarkup(<Logo />);

    expect(html).not.toContain("<a");
  });
});
