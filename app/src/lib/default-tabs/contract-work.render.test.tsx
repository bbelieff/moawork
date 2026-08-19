import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardToolbar } from "@/components/board/BoardToolbar";
import { EMPTY_FILTERS } from "@/components/board/filters";
import { GroupTable } from "@/components/board/GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { CONTRACT_WORK_TAB } from "./contract-work";

const boardId = "board-contract-work";
const columns: BoardColumn[] = CONTRACT_WORK_TAB.columns.map((column, sort_order) => ({
  id: `column-${column.key}`,
  org_id: "org-contract-work",
  board_id: boardId,
  key: column.key,
  label: column.label,
  type: column.type,
  source: column.source,
  options_jsonb: column.options ? { options: column.options } : null,
  sort_order,
  width: column.width ?? null,
  move_rule_jsonb: null,
  is_readonly: column.readOnly ?? false,
  rightPinned: column.rightPinned ?? false,
  created_at: "2026-08-15T00:00:00.000Z",
  updated_at: "2026-08-15T00:00:00.000Z",
}));

const row: ItemWithValues = {
  id: "item-empty",
  org_id: "org-contract-work",
  board_id: boardId,
  group_id: null,
  title: "",
  assigned_to: null,
  deal_id: null,
  sort_order: 0,
  values: {},
  created_at: "2026-08-15T00:00:00.000Z",
  updated_at: "2026-08-15T00:00:00.000Z",
};

function renderTable() {
  return renderToStaticMarkup(
    <GroupTable
      boardId={boardId}
      groupId={null}
      columns={columns}
      rows={[row]}
      readOnly={false}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />,
  );
}

describe("BBE-150 계약업체 실무 렌더", () => {
  it("27개 컬럼을 목업 순서로 그리고 진행상항을 우측 고정한다", () => {
    const html = renderTable();
    const positions = CONTRACT_WORK_TAB.columns.map((column) => html.indexOf(`>${column.label}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("sticky right-0");
  });

  it("lk 8개와 계산 5개는 편집 폼을 열지 않는다", () => {
    const html = renderTable();
    for (const column of CONTRACT_WORK_TAB.columns.filter(({ source }) => source === "lk" || source === "calc")) {
      expect(html, column.label).not.toContain(`name="columnKey" value="${column.key}"`);
    }
    expect(html).toContain('name="columnKey" value="execution_amount"');
  });

  it("상태·선택 필터는 칩+팝오버이며 네이티브 select가 아니다", () => {
    const html = renderToStaticMarkup(
      <BoardToolbar
        columns={columns}
        filters={EMPTY_FILTERS}
        onChange={() => {}}
        matched={0}
        total={0}
        people={[]}
      />,
    );
    expect(html).not.toContain("<select");
    expect(html).toContain("<details");
    for (const label of ["진행기관", "진행 상품", "진행상항"]) expect(html).toContain(label);
  });
});
