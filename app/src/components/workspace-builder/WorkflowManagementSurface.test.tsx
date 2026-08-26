import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { moveAt, WorkflowManagementSurface, type WorkflowManagementTab } from "./WorkflowManagementSurface";

const tabs: WorkflowManagementTab[] = [
  { key: "new-lead", order: 1, name: "신규리드 관리", description: "신규", href: "/newcust", boardId: "new", groups: [{ id: "a", name: "신규고객", color: "#fc0" }], transition: "리드컨택 관리로 넘기기", transitionKind: "move" },
  { key: "contact", order: 2, name: "리드컨택 관리", description: "컨택", href: "/contract", boardId: "contact", groups: [{ id: "b", name: "미배정", color: "#09f" }], transition: "계약업체 실무로 넘기기", transitionKind: "move" },
  { key: "work", order: 3, name: "계약업체 실무", description: "실무", href: "/work", boardId: "work", groups: [{ id: "c", name: "진행중", color: "#0c8" }], transition: "업체관리 현황에 자동 반영", transitionKind: "projection" },
  { key: "companies", order: 4, name: "업체관리 현황", description: "현황", href: "/companies", boardId: null, groups: [], transition: "완료", transitionKind: "complete" },
];

describe("workflow management", () => {
  it("shows the four-step product workflow and distinguishes moves from projection", () => {
    const html = renderToStaticMarkup(<WorkflowManagementSurface tabs={tabs} />);
    expect(html).toContain("전체 구조");
    expect(html).toContain("단계 편집");
    expect(html).toContain("신규리드 관리");
    expect(html).toContain("업체관리 현황");
    expect(html).toContain("실제 이동");
    expect(html).toContain("자동 반영");
  });

  it("moves one stage without dropping or duplicating another stage", () => {
    expect(moveAt(["신규", "상담", "보류"], 1, -1)).toEqual(["상담", "신규", "보류"]);
    expect(moveAt(["신규", "상담", "보류"], 0, -1)).toEqual(["신규", "상담", "보류"]);
  });
});
