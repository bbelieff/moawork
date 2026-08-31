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
  it("28개 컬럼을 정의 순서로 그리고 진행상황을 우측 고정한다", () => {
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

  /*
   * #655 — 필터 칩은 「필터」 패널 안으로 들어갔다. 원칙 9(칩+팝오버·네이티브 select 금지)는
   * 그대로이고 «어디에 서 있는가» 만 바뀌었다. 걸린 필터가 있으면 패널은 기본으로 열린다(#602).
   */
  const toolbar = (filters: typeof EMPTY_FILTERS) => renderToStaticMarkup(
    <BoardToolbar
      columns={columns}
      filters={filters}
      onChange={() => {}}
      matched={0}
      total={0}
      people={[]}
    />,
  );

  it("상태·선택 필터는 칩+팝오버이며 네이티브 select가 아니다", () => {
    const html = toolbar({ ...EMPTY_FILTERS, assignees: ["someone"] });
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<details");
    for (const label of ["진행기관", "세부명칭", "진행상황"]) expect(html).toContain(label);
  });

  it("아무것도 안 걸리면 필터는 접히고 세 묶음만 선다 (#655)", () => {
    const html = toolbar(EMPTY_FILTERS);
    for (const label of ["찾기", "필터", "보기", "정렬", "표시 컬럼", "저장", "뷰로 저장"]) {
      expect(html, label).toContain(label);
    }
    // 접혔으므로 개별 필터 칩은 아직 서 있지 않다.
    expect(html).not.toContain("진행기관");
    expect(html).not.toContain("<select");
  });
});
