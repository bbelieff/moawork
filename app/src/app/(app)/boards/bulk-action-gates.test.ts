import { describe, expect, it } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";
import { pickBulkStatusColumn } from "./bulk-action-gates";

function column(overrides: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: "col-status",
    board_id: "board-1",
    org_id: "org-1",
    key: "status",
    label: "상태",
    type: "status",
    source: "in",
    is_readonly: false,
    options_jsonb: {
      options: [
        { id: "진행중", label: "진행중", order: 0 },
        { id: "완료", label: "완료", order: 1 },
      ],
    },
    sort_order: 0,
    width: null,
    move_rule_jsonb: null,
    ...overrides,
  } as BoardColumn;
}

describe("pickBulkStatusColumn — 실제 컬럼 id 동봉", () => {
  it("선택한 물리 컬럼의 id를 columnId로 돌려준다", () => {
    const picked = pickBulkStatusColumn([column()], null);
    expect(picked).toMatchObject({ key: "status", columnId: "col-status" });
    expect(picked?.options.map((o) => o.id)).toEqual(["진행중", "완료"]);
  });

  it("읽기전용이면 만들기를 이을 id도 없이 null이다", () => {
    expect(pickBulkStatusColumn([column({ is_readonly: true })], null)).toBeNull();
  });

  it("워크플로 단계 컬럼도 실제 id와 함께 고른다 — 만들기는 가드가 막는다", () => {
    const picked = pickBulkStatusColumn(
      [column({ id: "col-progress", key: "progress_status" })],
      "work",
    );
    expect(picked).toMatchObject({ key: "progress_status", columnId: "col-progress" });
  });
});
