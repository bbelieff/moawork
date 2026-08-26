import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const keys = ["owner", "collaborators", "applied_on", "rep_name", "phone", "email", "industry", "contact_move"] as const;
const columns: BoardColumn[] = keys.map((key, index) => ({
  id: `c-${key}`,
  org_id: "org-a",
  board_id: "board-a",
  key,
  label: key === "industry" ? "업종" : key,
  type: key === "phone" ? "phone" : key === "owner" ? "person" : key === "collaborators" ? "people" : key === "applied_on" ? "date" : "text",
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
  it("보드 컬럼을 바로 채울 수 있는 회사 등록 필드와 동일한 사람 선택 UI를 보여준다", () => {
    const html = render();
    expect(html).toContain("＋ 새 항목");
    expect(html).toContain("회사명");
    expect(html).toContain("필수");
    expect(html).toContain("사업자유형");
    expect(html).toContain("개인사업자");
    expect(html).toContain("법인사업자");
    expect(html).toContain("그외");
    expect(html).toContain("연락처");
    expect(html).toContain("담당자 가 (나)");
    expect(html).toContain("대표자명");
    expect(html).toContain("이메일");
    expect(html).toContain("업종");
    expect(html).toContain("담당자 1명");
    expect(html).toContain("연관담당 · 알림받는 사람 여러 명");
    expect(html).not.toContain("등록과 동시에 준비되는 값");
    expect(html).toContain("취소");
  });

  it("does not infer a canonical board from matching custom columns", () => {
    const html = renderToStaticMarkup(<GroupTable boardId="board-a" groupId="group-a" columns={columns} rows={[row]} readOnly={false} rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null} canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}} />);
    expect(html).not.toContain('name="dealId"');
    expect(html).not.toContain("＋ 새 회사");
  });

  it("keeps an auto-sourced canonical field editable through the audited deal RPC action", () => {
    const html = render();
    expect(html).toContain('name="dealId" value="deal-a"');
    expect(html).toContain('name="field" value="industry"');
    expect(html).toContain('name="value" value="기존 업종"');
    expect(html).toContain('name="field" value="owner"');
    expect(html).toContain('name="field" value="collaborators"');
    expect(html).toContain('name="field" value="applied_on"');
  });

  it("keeps the deal ledger out of the new-lead row while preserving the detail opener", () => {
    const html = render();
    expect(html).toContain("열기");
    expect(html).not.toContain("원장");
  });
});
