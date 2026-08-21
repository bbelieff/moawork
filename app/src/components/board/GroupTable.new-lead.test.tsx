import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const keys = ["rep_name", "phone", "email", "industry", "contact_move"] as const;
const columns: BoardColumn[] = keys.map((key, index) => ({
  id: `c-${key}`,
  org_id: "org-a",
  board_id: "board-a",
  key,
  label: key === "industry" ? "업종" : key,
  type: key === "phone" ? "phone" : "text",
  source: key === "industry" ? "auto" : "in",
  rightPinned: key === "contact_move",
  options_jsonb: null,
  sort_order: index,
  width: null,
}));

const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a",
  title: "예시 리드", assigned_to: null, deal_id: "deal-a", sort_order: 0,
  created_at: "2026-08-21T00:00:00Z", updated_at: "2026-08-21T00:00:00Z",
  values: { industry: "기존 업종" },
};

function render() {
  return renderToStaticMarkup(
    <GroupTable
      boardId="board-a" groupId="group-a" columns={columns} rows={[row]} readOnly={false}
      canonicalNewLead
      newLeadMembers={[{ id: "user-a", label: "담당자 가" }]}
      currentUserId="user-a"
      rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null}
      canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}}
    />,
  );
}

describe("BBE-171 new-lead GroupTable wiring", () => {
  it("shows the compact intake behind a New item disclosure with visible required copy", () => {
    const html = render();
    expect(html).toContain("＋ 새 항목");
    expect(html).toContain("회사명 / 이름");
    expect(html).toContain("필수");
    for (const label of ["사업자 유형", "업종·업태", "매출 / 매출 구간", "시군구", "상세 주소", "담당자", "협업자"]) {
      expect(html).toContain(label);
    }
    for (const value of ["오늘(KST)", "신규리드 · 컨택 대기", "미상담 · 상담 전", "해당 없음", "일정 없음", "등록 후 첨부"]) {
      expect(html).toContain(value);
    }
    expect(html).toContain("담당자 가 (나)");
    expect(html).toContain("취소");
  });

  it("does not infer a canonical board from matching custom columns", () => {
    const html = renderToStaticMarkup(<GroupTable boardId="board-a" groupId="group-a" columns={columns} rows={[row]} readOnly={false} rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null} canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}} />);
    expect(html).not.toContain('name="dealId"');
    expect(html).not.toContain("등록과 동시에 준비되는 값");
  });

  it("keeps an auto-sourced canonical field editable through the audited deal RPC action", () => {
    const html = render();
    expect(html).toContain('name="dealId" value="deal-a"');
    expect(html).toContain('name="field" value="industry"');
    expect(html).toContain('name="value" value="기존 업종"');
  });
});
