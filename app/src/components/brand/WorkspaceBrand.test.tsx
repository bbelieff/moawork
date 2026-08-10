import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceBrand } from "./WorkspaceBrand";

describe("WorkspaceBrand", () => {
  it("shows the company name in place of a logo when the company has none", () => {
    const html = renderToStaticMarkup(<WorkspaceBrand orgName="서울경영지원센터" href="/w/seoul" />);
    expect(html).toContain("서울경영지원센터");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="/w/seoul"');
    expect(html).toContain('aria-label="서울경영지원센터 홈"');
  });

  it("renders the company logo when one is set", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBrand orgName="서울경영지원센터" logoUrl="https://cdn.example.com/logo.svg" href="/w/seoul" />,
    );
    expect(html).toContain('src="https://cdn.example.com/logo.svg"');
    expect(html).not.toContain(">서울경영지원센터<");
  });

  it("fails closed to the name fallback on a non-https logo url", () => {
    const html = renderToStaticMarkup(
      <WorkspaceBrand orgName="서울경영지원센터" logoUrl="javascript:alert(1)" href="/w/seoul" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("서울경영지원센터");
  });
});
