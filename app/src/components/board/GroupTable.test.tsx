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
import { GroupTable, boardFileSelectionError, cellInputValue } from "./GroupTable";
import { MAX_FILE_BYTES } from "@/lib/services/file-contract";
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
  it("파일 선택은 서버 액션 전 10MiB 초과를 막는다", () => {
    expect(boardFileSelectionError(MAX_FILE_BYTES)).toBeNull();
    expect(boardFileSelectionError(MAX_FILE_BYTES + 1)).toContain("10MB");
  });

  it("#845 5단계 — 머리글에는 칸 이름만: 출처 기호(⟳✎▼✉⇄ƒ)·⋯ 단추 없이 이름이 곧 메뉴 단추다", () => {
    const columns = (["auto", "in", "act", "msg", "lk", "calc"] as const).map((source) =>
      col({ key: source, label: `칸-${source}`, source, type: source === "calc" ? "calc" : "text" }),
    );
    const html = renderTable(columns, [row()]);
    const head = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    expect(head).not.toBe("");
    for (const mark of ["⟳", "✎", "▼", "✉", "⇄", "ƒ", "⋯"]) expect(head, mark).not.toContain(mark);
    for (const column of columns) {
      const header = head.match(new RegExp(`<th(?=[^>]*data-column-key="${column.key}")[\\s\\S]*?<\\/th>`))?.[0] ?? "";
      expect(header).toMatch(new RegExp(`role="button"[^>]*aria-haspopup="menu"[^>]*>${column.label}</span>`));
    }
    // 칸이 어떤 칸인지(종류·출처)는 메뉴 맨 위와 머리글 풀이(title)에 남는다.
    expect(head).toContain("발송(바꾸면 고객에게 문자가 나가고 비용이 듭니다)");
  });

  it("⇄ 연동 칸은 provenance 배지와 편집 폼을 함께 그린다", () => {
    const columns = [col({ key: "lkcol", label: "업체명", source: "lk", type: "text" })];
    const html = renderTable(columns, [row({ lkcol: "우진산업" })]);
    expect(html).toContain("우진산업");
    expect(html).toContain('name="columnKey" value="lkcol"');
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
    expect(cellInputValue("phone", "01030266007")).toBe("010-3026-6007");
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
    expect(html).toContain('type="hidden" name="value" value="member-b"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("계정 B");
    expect(html).not.toContain('type="text" name="value"');
  });

  it("money 타입은 우측 정렬·천단위로 표시된다", () => {
    const columns = [col({ key: "amt", label: "계약금", source: "calc", type: "money" })];
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

  it("상세 패널이 닫혀도 모바일 포함 두 축 고정을 유지한다", () => {
    const html = renderTable([col({ key: "a", label: "일반" })], [row()]);
    expect(html).toContain("sticky left-0 z-[var(--mw-layer-board-cell)]");
    expect(html).toContain("sticky top-0 z-[var(--mw-layer-board-header)]");
    // #839 (2026-10-06) — 모서리 머리글은 머리글 줄 틴트(bg-mw-board-head), 본문 첫 칸은 카드색.
    expect(html).toContain("sticky left-0 z-[var(--mw-layer-board-cell)] z-[var(--mw-layer-board-corner)] bg-mw-board-head");
    expect(html).toContain("sticky left-0 z-[var(--mw-layer-board-cell)] bg-mw-card border-b");
    expect(html).toContain("relative isolate max-h-[70vh]");
  });

  it("#845 개선안 — 이름 칸에 「열기 ↗」·「삭제」 단추가 없고, 이름이 곧 상세 열기다(삭제 권한이 있어도)", () => {
    const html = renderTable([col({ key: "a", label: "일반" })], [row()], true);
    expect(html).not.toContain("열기 ↗");
    expect(html).not.toContain("data-row-trash");
    expect(html).not.toContain("행1 휴지통으로 이동");
    expect(html).not.toContain('aria-label="행 이름"');
    // 이름 단추가 상세 여는 단추다(data-item-detail-trigger) — 같은 행의 「옆에 열기」 아이콘도 함께.
    expect(html).toMatch(/<button[^>]*aria-label="행1 상세 열기"[^>]*data-item-detail-trigger="row-1"[^>]*data-row-name="true"/);
    expect(html).toContain('aria-label="행1 옆에 열기"');
  });

  it("BBE-240 · 원장 버튼은 행에 없다 — 상세(열기) 머리말로 옮겼다 (2026-10-07)", () => {
    const columns = [col({ key: "a", label: "일반" })];
    // 행 칸에는 체크·이름·옆에 열기만. 원장은 ItemDetailPanel 머리말(ItemDetailPanel.test.tsx)에서 확인한다.
    expect(renderTable(columns, [row({}, "deal-1")])).not.toContain("📒 원장");
    expect(renderTable(columns, [row()])).not.toContain("📒 원장");
  });
});

describe("GroupTable — 컬럼 순서 바꾸기만 끄기 (2026-10-08)", () => {
  const render = (canMoveColumns: boolean) => renderToStaticMarkup(
    <GroupTable
      boardId="b1"
      groupId={null}
      columns={[col({ key: "kind", label: "구분" }), col({ id: "col-rep", key: "rep", label: "대표자명" })]}
      rows={[row()]}
      readOnly={false}
      canManageColumns
      canMoveColumns={canMoveColumns}
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

  it("순서 바꾸기만 끄면 끌기는 없고 칸 메뉴(이름 바꾸기·지우기 등)·폭 조절은 남는다", () => {
    const off = render(false);
    expect(off).not.toContain('draggable="true"');
    expect(off).not.toContain("칸 순서 바꾸기");
    expect(off).toContain("끌어서 폭 조절");
    expect(off).toMatch(/<th[^>]*data-column-key="kind"[^>]*data-column-manage="true"/);
    expect(off).toContain('aria-haspopup="menu"');
    // 머리글 안에 숨은 「왼쪽으로 이동」 단추를 두지 않는다 — 옮기기는 칸 메뉴에 있다.
    expect(off).not.toContain("왼쪽으로 이동");
    const on = render(true);
    expect(on).toContain('draggable="true"');
    expect(on).toContain("칸 순서 바꾸기");
    expect(on).not.toContain("왼쪽으로 이동");
  });
});
