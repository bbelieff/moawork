// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewLeadOnboarding } from "./NewLeadOnboarding";

describe("Issue #554 new lead help", () => {
  it("제목 옆의 작은 물음표와 hover/focus 메모로만 안내한다", () => {
    const html = renderToStaticMarkup(<NewLeadOnboarding />);
    expect(html).toContain('aria-label="신규리드 도움말"');
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("신규리드 시작하기");
    expect(html).toContain("리드컨택으로 넘기기");
    expect(html).toContain("group-hover/help:visible");
    expect(html).toContain("group-focus-within/help:visible");
    expect(html).not.toContain("확인했어요");
  });
});
