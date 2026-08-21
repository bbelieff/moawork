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
      rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null}
      canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}}
    />,
  );
}

describe("BBE-171 new-lead GroupTable wiring", () => {
  it("shows the compact intake behind a New item disclosure with visible required copy", () => {
    const html = render();
    expect(html).toContain("＋ 새 항목");
    expect(html).toContain("이름");
    expect(html).toContain("필수");
    expect(html).toContain("나머지는 지금 또는 등록 후 언제든 수정할 수 있어요");
    expect(html).toContain("취소");
  });

  it("does not infer a canonical board from matching custom columns", () => {
    const html = renderToStaticMarkup(<GroupTable boardId="board-a" groupId="group-a" columns={columns} rows={[row]} readOnly={false} rowDragEnabled={false} cellFlash={null} onColumnDrop={() => {}} dragRowId={null} canDropRow={() => false} onRowDragStart={() => {}} onRowDragEnd={() => {}} onRowDrop={() => {}} />);
    expect(html).not.toContain('name="dealId"');
    expect(html).not.toContain("나머지는 지금 또는 등록 후 언제든 수정할 수 있어요");
  });

  it("keeps an auto-sourced canonical field editable through the audited deal RPC action", () => {
    const html = render();
    expect(html).toContain('name="dealId" value="deal-a"');
    expect(html).toContain('name="field" value="industry"');
    expect(html).toContain('name="value" value="기존 업종"');
  });
});
