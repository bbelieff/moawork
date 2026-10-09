import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// 보기 줄은 표·칸반 전환에 앱 라우터를 쓴다(#845) — 정적 렌더에는 라우터가 없다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
import { BoardViewBar } from "@/components/board/BoardViewBar";
import { ViewConditionsPanel } from "@/components/board/ViewConditionsPanel";
import { EMPTY_FILTERS } from "@/components/board/filters";
import { GroupTable } from "@/components/board/GroupTable";
import { columnPlainName } from "@/components/board/column-menu-model";
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
    // 머리글은 ƒ(계산 표시)를 뗀 이름을 그린다(#845 — 칸 종류는 칸 메뉴의 회색 줄이 말한다).
    const positions = CONTRACT_WORK_TAB.columns.map((column) => html.indexOf(`>${columnPlainName(column.label)}<`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("sticky right-0");
    expect(html).not.toContain(">ƒ");
  });

  it("lk 8개와 계산 5개는 편집 폼을 열지 않는다", () => {
    const html = renderTable();
    for (const column of CONTRACT_WORK_TAB.columns.filter(({ source }) => source === "lk" || source === "calc")) {
      expect(html, column.label).not.toContain(`name="columnKey" value="${column.key}"`);
    }
    expect(html).toContain('name="columnKey" value="execution_amount"');
  });

  /*
   * #845 6단계 — 필터 칩은 보기 줄 아래로 펼쳐지는 「보기 조건」 칸의 「필터」 탭에 있다.
   * 원칙 9(칩+팝오버·네이티브 select 금지)는 그대로이고 «어디에 서 있는가» 만 바뀌었다.
   */
  const panel = (filters: typeof EMPTY_FILTERS) => renderToStaticMarkup(
    <ViewConditionsPanel
      tab="filter"
      onTab={() => {}}
      columns={columns}
      rows={[]}
      filters={filters}
      onChange={() => {}}
      people={[]}
      groupBy=""
    />,
  );
  const bar = (filters: typeof EMPTY_FILTERS) => renderToStaticMarkup(
    <BoardViewBar
      boardId={boardId}
      mode="table"
      columns={columns}
      filters={filters}
      onChange={() => {}}
      rows={[]}
      matched={0}
      total={0}
      people={[]}
    />,
  );

  it("상태·선택 필터는 칩+팝오버이며 네이티브 select가 아니다", () => {
    const html = panel(EMPTY_FILTERS);
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<details");
    for (const label of ["진행기관", "세부명칭", "진행상황"]) expect(html).toContain(label);
  });

  it("아무것도 안 걸리면 보기 조건 칸은 접혀 있고 한 줄에 칩만 선다 (#845 6단계)", () => {
    const html = bar(EMPTY_FILTERS);
    for (const label of ["메인 테이블", "표", "담당 · 전체", "필터", "정렬", "나눠 보기", "칸 숨기기", 'aria-label="찾기"']) {
      expect(html, label).toContain(label);
    }
    // 접혔으므로 개별 필터 칩은 아직 서 있지 않다.
    expect(html).not.toContain("진행기관");
    expect(html).not.toContain("<select");
    // 바뀐 것이 없으면 되돌리기·저장이 없다. 예전 「뷰로 저장」 단추도 없다.
    expect(html).not.toContain("되돌리기");
    expect(html).not.toContain(">뷰로 저장<");
  });
});
