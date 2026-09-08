import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticePerspectiveNav } from "./NoticePerspectiveNav";

describe("NoticePerspectiveNav", () => {
  it("links truthful perspectives and marks department as unavailable", () => {
    const html = renderToStaticMarkup(<NoticePerspectiveNav baseHref="/w/sample/boards/board%20one" active="authored" as="member" />);
    expect(html).toContain('aria-label="공지 보기"');
    expect(html).toContain('/w/sample/boards/board%20one?as=member&amp;noticeView=authored');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("내 부서 · 준비 중");
    expect(html).toContain("나에게 · 준비 중");
    expect(html).toContain("canonical 보드 상세");
  });
});
