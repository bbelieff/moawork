import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkBoardSnapshot } from "@/lib/work-management";
import { WORK_COLUMNS, WORK_TEMPLATE } from "@/lib/work-management";

vi.mock("@/app/(app)/work/actions", () => ({ mutateWork: async () => ({ ok: false, message: "" }) }));

const base: WorkBoardSnapshot = {
  board: { id: "board-a", orgId: "org-a", title: "업무관리", icon: "🔥", templateKey: WORK_TEMPLATE.key, templateVersion: 1, baselineFingerprint: WORK_TEMPLATE.baselineFingerprint, currentFingerprint: "edited" },
  groups: [{ id: "group-a", name: "준비단계", color: "#579bfc", count: 1 }],
  columns: WORK_COLUMNS,
  items: [{ id: "item-a", boardId: "board-a", groupId: "group-a", title: "합성 업무", assignedTo: "user-a", workflowStatus: "in_progress", dueDate: "2026-08-04", version: 3, templateVersion: 1, companyRef: "company-a", contactRef: null, companyDisplay: "비식별 업체", contactDisplay: null, provenance: { sourceKind: "synthetic", sourceRecordId: "source-a", immutable: true }, values: {}, updates: [], activities: [] }],
  members: [{ membershipId: "membership-a", orgId: "org-a", userId: "user-a", displayName: "구성원 A", active: true }],
  views: [{ id: "view-a", name: "메인 테이블", kind: "table", shared: true, isDefault: true, version: 1, predicate: {} }],
  virtualBindings: [{ columnKey: "company", source: "company", attribute: "name", readOnly: true }],
  role: "viewer",
  filesEnabled: false,
};

describe("WorkBoardSurface", () => {
  it("renders the exact legacy columns plus the visible due date", async () => {
    const { WorkBoardSurface } = await import("./WorkBoardSurface");
    const html = renderToStaticMarkup(<WorkBoardSurface snapshot={base}/>);
    expect(html).toContain("진행상황");
    expect(html).toContain("마감일");
    expect(html).toContain("수수료 입금일");
    expect(html).toContain("계약금 입금일");
  });

  it("shows viewer structure controls as disabled and storage as gated", async () => {
    const { WorkBoardSurface } = await import("./WorkBoardSurface");
    const html = renderToStaticMarkup(<WorkBoardSurface snapshot={base}/>);
    expect(html).toContain("보드 관리자만 구조를 변경할 수 있습니다");
    expect(html).toContain("파일 비활성");
    expect(html).toContain("disabled");
  });

  it("renders only active membership options for a manager picker", async () => {
    const { WorkBoardSurface } = await import("./WorkBoardSurface");
    const html = renderToStaticMarkup(<WorkBoardSurface snapshot={{ ...base, role: "manager" }}/>);
    expect(html).toContain("담당자 수정");
    expect(html).toContain("구성원 A");
    expect(html).toContain("업무 이름");
  });
});
