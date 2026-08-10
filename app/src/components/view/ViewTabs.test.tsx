import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewTabs } from "./ViewTabs";

describe("ViewTabs", () => {
  it("보드·표·캘린더 3개를 렌더하고 현재 kind에 aria-current를 붙인다", () => {
    const html = renderToStaticMarkup(<ViewTabs kind="flat" onSelect={() => {}} />);
    expect(html).toContain("보드");
    expect(html).toContain("표");
    expect(html).toContain("캘린더");
    expect(html).toContain('aria-current="page"');
  });
});
