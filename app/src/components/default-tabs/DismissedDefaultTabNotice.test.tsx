import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ pathname: "/w/sample-lab/newcust" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

import { DismissedDefaultTabNotice } from "./DismissedDefaultTabNotice";

describe("#849 지운 기본 탭 안내", () => {
  it("탭 이름과 되살리는 길을 알려 주고, 지금 회사의 탭 관리로 보낸다", () => {
    location.pathname = "/w/sample-lab/newcust";
    const html = renderToStaticMarkup(<DismissedDefaultTabNotice tabName="신규리드 관리" />);

    expect(html).toContain("‘신규리드 관리’ 탭을 지웠어요");
    expect(html).toContain(
      "휴지통에 있으면 7일 안에 복구할 수 있고, 완전히 지웠다면 탭 관리에서 ‘기본 탭 다시 설치’로 새로 만들 수 있어요.",
    );
    expect(html).toContain("탭 관리로 가기");
    expect(html).toContain('href="/w/sample-lab/settings/workspace-builder?section=tabs"');
  });

  it("주소에서 회사를 못 읽으면 다른 회사로 보내지 않고 진입 화면으로 보낸다", () => {
    location.pathname = "/newcust";
    const html = renderToStaticMarkup(<DismissedDefaultTabNotice tabName="공지사항" />);

    expect(html).toContain('href="/workspace-entry?error=routing"');
  });
});
