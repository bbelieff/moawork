import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ItemDetailPanel } from "./ItemDetailPanel";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const columns: BoardColumn[] = [{
  id: "col-company", org_id: "org-a", board_id: "board-a", key: "company", label: "회사명",
  type: "text", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
}];
const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a", title: "대한정밀",
  assigned_to: "user-a", sort_order: 0, created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:00Z",
  values: { company: "대한정밀", hidden_legacy: "보존값" },
};

describe("BBE-107 실제 상세 패널", () => {
  it("상속 상태와 미배치 값 회수, 1440/375 공통 반응형 패널 계약을 렌더한다", () => {
    const html = renderToStaticMarkup(<ItemDetailPanel
      boardId="board-a"
      row={row}
      columns={columns}
      boardLayout={[{ key: "company", source: "column" }]}
      layout={[{ key: "company", source: "column" }]}
      inherited
      canEditItems
      canManageColumns
      defaultOpen
    />);
    expect(html).toContain("보드 기본 배치를 상속 중");
    expect(html).toContain("이 화면에 배치되지 않은 항목 1개");
    expect(html).toContain("hidden_legacy");
    expect(html).toContain("배치에 추가");
    expect(html).toContain("w-full max-w-xl");
  });

  it("상세 전용 필드는 표 승격 동작을 제공한다", () => {
    const html = renderToStaticMarkup(<ItemDetailPanel
      boardId="board-a"
      row={{ ...row, values: { detail_note: "메모" } }}
      columns={columns}
      boardLayout={[]}
      layout={[{ key: "detail_note", source: "detail", label: "상세 메모", type: "text" }]}
      inherited={false}
      canEditItems
      canManageColumns
      defaultOpen
    />);
    expect(html).toContain("상세 전용");
    expect(html).toContain("표에도 보이기");
    expect(html).toContain("기본으로 되돌리기");
  });
});
