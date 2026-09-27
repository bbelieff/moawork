import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

function col(over: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: `col-${over.key ?? "x"}`,
    org_id: "org",
    board_id: "b1",
    key: "x",
    label: "라벨",
    type: "text",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
    ...over,
  };
}

function row(id: string, title: string): ItemWithValues {
  return {
    id,
    org_id: "org",
    board_id: "b1",
    group_id: "g1",
    title,
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values: {},
  };
}

function renderSelection(selection: Set<string>, rows: ItemWithValues[]) {
  return renderToStaticMarkup(
    <GroupTable
      boardId="b1"
      groupId="g1"
      groupName="새 리드"
      columns={[col({ key: "note", label: "메모" })]}
      rows={rows}
      readOnly={false}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
      selection={selection}
      onToggleRow={() => {}}
      onToggleGroup={() => {}}
      onBulkStatusRequest={() => true}
    />,
  );
}

const ROWS = [row("row-1", "행1"), row("row-2", "행2")];

describe("GroupTable 일괄 선택 체크박스", () => {
  it("첫 칸에 그룹 마스터 + 행 체크박스를 그리고 접근성 라벨을 붙임", () => {
    const html = renderSelection(new Set(), ROWS);
    expect(html).toContain('aria-label="새 리드 전체 선택"');
    expect(html).toContain('aria-label="행1 선택"');
    expect(html).toContain('aria-label="행2 선택"');
  });

  it("부분 선택은 마스터를 mixed 로 표시 (indeterminate 접근성)", () => {
    const html = renderSelection(new Set(["row-1"]), ROWS);
    expect(html).toContain('aria-checked="mixed"');
  });

  it("전체 선택은 마스터 checked, 선택 없으면 미체크", () => {
    const full = renderSelection(new Set(["row-1", "row-2"]), ROWS);
    expect(full).not.toContain('aria-checked="mixed"');
    expect(full).toContain("checked");
    const empty = renderSelection(new Set(), ROWS);
    expect(empty).not.toContain('aria-checked="mixed"');
  });

  it("선택 props 가 없으면 체크박스를 그리지 않음", () => {
    const html = renderToStaticMarkup(
      <GroupTable
        boardId="b1"
        groupId="g1"
        columns={[col({ key: "note", label: "메모" })]}
        rows={ROWS}
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
    expect(html).not.toContain("전체 선택");
    expect(html).not.toContain("행1 선택");
  });
});
