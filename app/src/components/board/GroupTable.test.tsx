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
import { GroupTable, cellInputValue } from "./GroupTable";
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

function row(values: Record<string, CellValue> = {}, dealId: string | null = null): ItemWithValues {
  return {
    id: "row-1",
    org_id: "org",
    board_id: "b1",
    group_id: null,
    title: "행1",
    assigned_to: null,
    deal_id: dealId,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values,
  };
}

function renderTable(columns: BoardColumn[], rows: ItemWithValues[], canDeleteItems = false) {
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
      canDeleteItems={canDeleteItems}
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

  it("날짜와 날짜·시각은 브라우저 기본 picker를 백스톱으로 사용한다", () => {
    const columns = [
      col({ key: "date", label: "신청일", source: "in", type: "date" }),
      col({ key: "datetime", label: "재통화 일시", source: "in", type: "datetime" }),
    ];
    const html = renderTable(columns, [row({
      date: "2026-08-11",
      datetime: "2026-08-11T03:45:00.000Z",
    })]);
    expect(html).toContain('type="date"');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-08-11T03:45"');
    expect(cellInputValue("datetime", "2026-08-11T03:45:00.000Z")).toBe("2026-08-11T03:45");
  });

  it("person 컬럼은 조직 멤버 선택 UI와 미배정 값을 렌더한다", () => {
    const columns = [col({
      key: "owner",
      label: "담당자",
      type: "person",
      source: "act",
      options_jsonb: { options: [
        { id: "member-a", label: "계정 A", order: 0 },
        { id: "member-b", label: "계정 B", order: 1 },
      ] },
    })];
    const html = renderTable(columns, [row({ owner: "member-b" })]);
    expect(html).toContain('name="kind" value="person"');
    expect(html).toContain('placeholder="멤버 검색"');
    expect(html).toContain('type="hidden" name="value" value="member-b"');
    expect(html).toContain('type="radio" checked=""');
    expect(html).toContain("계정 B");
    expect(html).not.toContain('type="text" name="value"');
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

  it("상세 패널이 닫힌 상태에서도 기존 sticky 헤더·첫 열 계층을 유지한다", () => {
    const html = renderTable([col({ key: "a", label: "일반" })], [row()]);
    expect(html).toContain("sticky left-0 z-10");
    expect(html).toContain("sticky top-0 z-20");
    expect(html).toContain("sticky left-0 z-10 bg-mw-card z-30");
  });

  it("삭제 권한이 있으면 hard delete 대신 휴지통 서버 액션을 렌더한다", () => {
    const html = renderTable([col({ key: "a", label: "일반" })], [row()], true);
    expect(html).toContain('name="boardId" value="b1"');
    expect(html).toContain('name="itemId" value="row-1"');
    expect(html).toContain("행1 휴지통으로 이동");
    expect(html).toContain("삭제");
  });

  it("BBE-240 · deal_id 가 있는 행에만 원장 버튼이 뜬다", () => {
    const columns = [col({ key: "a", label: "일반" })];
    const withDeal = renderTable(columns, [row({}, "deal-1")]);
    expect(withDeal).toContain("📒 원장");
    const withoutDeal = renderTable(columns, [row()]);
    expect(withoutDeal).not.toContain("📒 원장");
  });
});
