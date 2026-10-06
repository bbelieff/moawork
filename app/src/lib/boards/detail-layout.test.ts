import { describe, expect, it } from "vitest";
import {
  detailKeyFromLabel,
  moveDetailEntry,
  normalizeDetailLayout,
  resolveBoardDetailLayout,
  resolveDetailLayout,
  resolveRowDetailLayout,
  unplacedDetailKeys,
} from "./detail-layout";

describe("BBE-107 상세 필드 레이아웃", () => {
  const board = [
    { key: "company", source: "column" as const },
    { key: "memo", source: "detail" as const, label: "상세 메모", type: "text" as const },
  ];

  it("오버라이드하지 않은 그룹은 보드 기본을 계속 상속하고 빈 배열은 명시적 오버라이드다", () => {
    expect(resolveDetailLayout(board, null)).toEqual({ entries: board, inherited: true });
    expect(resolveDetailLayout(board, undefined)).toEqual({ entries: board, inherited: true });
    expect(resolveDetailLayout(board, [])).toEqual({ entries: [], inherited: false });
  });

  it("그룹 A 순서를 바꿔도 보드 기본과 그룹 B의 상속 결과를 바꾸지 않는다", () => {
    const groupA = moveDetailEntry(board, "memo", -1);
    expect(groupA.map((entry) => entry.key)).toEqual(["memo", "company"]);
    expect(resolveDetailLayout(board, null).entries.map((entry) => entry.key)).toEqual(["company", "memo"]);
    expect(board.map((entry) => entry.key)).toEqual(["company", "memo"]);
  });

  it("레이아웃에서 빠진 값은 삭제하지 않고 접힘 영역의 키로 회수한다", () => {
    const values = { company: "모아", memo: "보존", legacy: "옛 값", empty: "" };
    expect(unplacedDetailKeys(values, [{ key: "company", source: "column" }])).toEqual(["legacy", "memo"]);
    expect(values).toEqual({ company: "모아", memo: "보존", legacy: "옛 값", empty: "" });
  });

  it("legacy/중복/잘못된 엔트리는 결정적으로 정규화한다", () => {
    expect(normalizeDetailLayout([
      { key: "memo", source: "detail", label: " 메모 ", type: "text" },
      { key: "memo", source: "column" },
      { key: "bad key", source: "column" },
      null,
    ])).toEqual([{ key: "memo", source: "detail", label: "메모", type: "text" }]);
    expect(detailKeyFromLabel("상세 메모")).toBe("detail_상세_메모");
  });

  it("canonical 신규리드의 초기 빈 배치는 활성 컬럼 전체를 상속하되 임의 보드의 빈 배치는 보존한다", () => {
    const columns = Array.from({ length: 22 }, (_, index) => ({
      id: `column-${index}`,
      org_id: "org-a",
      board_id: "board-a",
      key: `field_${index}`,
      label: `필드 ${index + 1}`,
      type: "text" as const,
      source: "in" as const,
      rightPinned: false,
      options_jsonb: null,
      sort_order: index,
      width: null,
    }));

    const canonical = resolveBoardDetailLayout("core.default-tab/new-lead", [], columns);
    expect(canonical).toHaveLength(22);
    expect(canonical[0]).toEqual({ key: "field_0", source: "column", label: "필드 1", type: "text" });
    expect(resolveDetailLayout(canonical, null)).toEqual({ entries: canonical, inherited: true });
    expect(resolveBoardDetailLayout("custom.board", [], columns)).toEqual([]);
  });

  it("canonical 신규리드에 저장된 명시 배치가 있으면 컬럼 fallback으로 덮지 않는다", () => {
    const columns = [{
      id: "column-a", org_id: "org-a", board_id: "board-a", key: "company", label: "회사명",
      type: "text" as const, source: "in" as const, rightPinned: false, options_jsonb: null,
      sort_order: 0, width: null,
    }];
    expect(resolveBoardDetailLayout("core.default-tab/new-lead", board, columns)).toEqual(board);
  });
});

/*
 * #654 — 상세 패널의 추가 폼은 row.group_id 로 쓴다. 상담 단계 보기처럼 묶음에 물리 그룹이
 * 없는 화면도 «그 행의 그룹» 으로 읽어야 방금 추가한 필드가 보인다.
 */
describe("#654 행 단위 상세 배치", () => {
  const boardLayout = [{ key: "detail_board", source: "detail" as const, label: "보드 기본" }];
  const groups = [
    { id: "group-contact", detail_layout_jsonb: [{ key: "detail_qa", source: "detail", label: "QA-654 확인용" }] },
    { id: "group-inherit", detail_layout_jsonb: null },
  ];

  it("행의 그룹에 덮어쓰기 배치가 있으면 그것을 읽는다", () => {
    expect(resolveRowDetailLayout(boardLayout, groups, "group-contact")).toEqual({
      entries: [{ key: "detail_qa", source: "detail", label: "QA-654 확인용" }],
      inherited: false,
    });
  });

  it("그룹이 상속 중이거나 행에 그룹이 없거나 모르는 그룹이면 보드 기본을 읽는다", () => {
    for (const groupId of ["group-inherit", null, undefined, "group-unknown"]) {
      expect(resolveRowDetailLayout(boardLayout, groups, groupId)).toEqual({ entries: boardLayout, inherited: true });
    }
  });
});
