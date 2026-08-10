/**
 * BBE-123 — 렌더 markup 검증. 실제 브라우저 없이도 다음을 고정한다:
 *   D09 출처 배지 노출 · lk/calc 클릭 편집창 안 열림 · lk ⇄ 표시 · money 우측정렬
 *   D11 우측 고정 열 sticky 클래스.
 *
 * 로컬 (app) 셸은 Supabase env 가 없으면 500 이라 브라우저로 이 화면까지 갈 수 없다
 * (app/src/lib/supabase/env.ts — 기존 갭, 이 카드 범위 밖). 그래서 GroupTable 자체를
 * 직접 렌더해 markup 으로 검증한다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, CellValue, ItemWithValues } from "@/lib/boards/types";

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

function row(values: Record<string, CellValue> = {}): ItemWithValues {
  return {
    id: "row-1",
    org_id: "org",
    board_id: "b1",
    group_id: null,
    title: "행1",
    assigned_to: null,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values,
  };
}

function renderTable(columns: BoardColumn[], rows: ItemWithValues[]) {
  return renderToStaticMarkup(
    <GroupTable
      boardId="b1"
      groupId={null}
      columns={columns}
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
    />,
  );
}

describe("GroupTable — 출처 배지·편집 게이트(D09)", () => {
  it("모든 출처 배지가 헤더에 뜬다(⟳✎▼✉⇄ƒ 6종 전부)", () => {
    const columns = (["auto", "in", "act", "msg", "lk", "calc"] as const).map((source) =>
      col({ key: source, label: source, source, type: source === "calc" ? "calc" : "text" }),
    );
    const html = renderTable(columns, [row()]);
    for (const mark of ["⟳", "✎", "▼", "✉", "⇄", "ƒ"]) {
      expect(html).toContain(mark);
    }
  });

  it("⇄ 연동 칸은 폼(편집창) 없이 값 + 인라인 ⇄ 표시만 그린다", () => {
    const columns = [col({ key: "lkcol", label: "업체명", source: "lk", type: "text" })];
    const html = renderTable(columns, [row({ lkcol: "우진산업" })]);
    expect(html).toContain("우진산업");
    // 편집 폼이 없어야 한다 — hidden input(columnKey) 이 이 컬럼 key 로 안 나온다.
    expect(html).not.toContain('name="columnKey" value="lkcol"');
  });

  it("ƒ 수식 칸도 편집창이 없다", () => {
    const columns = [col({ key: "calccol", label: "D-day", source: "calc", type: "calc" })];
    const html = renderTable(columns, [row({ calccol: "D-51" })]);
    expect(html).toContain("D-51");
    expect(html).not.toContain('name="columnKey" value="calccol"');
  });

  it("✎ 입력 칸은 편집 폼이 있다(대조군)", () => {
    const columns = [col({ key: "incol", label: "메모", source: "in", type: "text" })];
    const html = renderTable(columns, [row({ incol: "메모값" })]);
    expect(html).toContain('name="columnKey" value="incol"');
  });

  it("money 타입은 우측 정렬·천단위로 표시된다", () => {
    const columns = [col({ key: "amt", label: "계약금", source: "lk", type: "money" })];
    const html = renderTable(columns, [row({ amt: 1200000 })]);
    expect(html).toContain("1,200,000");
    expect(html).toContain("text-right");
  });

  it("우측 고정 열(D11)은 sticky right-0 클래스를 받는다", () => {
    const columns = [
      col({ key: "a", label: "일반" }),
      col({ key: "b", label: "상담 상황", source: "act", type: "status", rightPinned: true }),
    ];
    const html = renderTable(columns, [row()]);
    expect(html).toContain("sticky right-0");
  });

  it("일반 열은 우측 고정 클래스가 없다", () => {
    const columns = [col({ key: "a", label: "일반", rightPinned: false })];
    const html = renderTable(columns, [row()]);
    expect(html).not.toContain("sticky right-0");
  });
});
