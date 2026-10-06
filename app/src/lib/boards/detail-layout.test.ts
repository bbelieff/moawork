import { describe, expect, it } from "vitest";
import {
  detailKeyFromLabel,
  moveDetailEntry,
  normalizeDetailLayout,
  resolveBoardDetailLayout,
  resolveDetailLayout,
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

  /*
   * 2026-10-06 — 계약업체 실무 상세의 회사 정보가 통째로 비어 있었다.
   * 설치기는 상세 배치를 저장하지 않으므로 DB 값은 `[]`이고, fallback이 신규리드에만 있었다.
   */
  describe("계약업체 실무 기본 탭", () => {
    const column = (key: string, label: string, sort_order: number) => ({
      id: `column-${key}`, org_id: "org-a", board_id: "board-work", key, label,
      type: "text" as const, source: "in" as const, rightPinned: false, options_jsonb: null,
      sort_order, width: null,
    });
    // 서버 호출부(actions·service·ocr)는 숨기기 전 «전체» 컬럼을 넘긴다.
    const serverColumns = [
      column("company_name", "회사명", 0),
      column("progress_status", "진행현황", 1),
      column("ceo", "대표자", 2),
    ];

    it("빈 배치는 활성 컬럼을 상속하되 진행현황 원본 키는 서버 호출에서도 빠진다", () => {
      const resolved = resolveBoardDetailLayout("core.default-tab/contract-work", [], serverColumns);
      expect(resolved.map((entry) => entry.key)).toEqual(["company_name", "ceo"]);
      expect(resolved[0]).toEqual({ key: "company_name", source: "column", label: "회사명", type: "text" });
      // 클라이언트가 미리 거른 목록을 넘겨도 결과가 같다 — 관리자 첫 저장이 원본 키를 박제하지 않는다.
      const clientColumns = serverColumns.filter((candidate) => candidate.key !== "progress_status");
      expect(resolveBoardDetailLayout("core.default-tab/contract-work", null, clientColumns)).toEqual(resolved);
    });

    it("저장된 배치가 있으면 fallback으로 덮지 않는다", () => {
      expect(resolveBoardDetailLayout("core.default-tab/contract-work", board, serverColumns)).toEqual(board);
    });

    it("다른 기본 탭(리드컨택)과 임의 보드의 빈 배치는 그대로 비어 있다", () => {
      expect(resolveBoardDetailLayout("core.default-tab/contact", [], serverColumns)).toEqual([]);
      expect(resolveBoardDetailLayout(null, [], serverColumns)).toEqual([]);
    });
  });

  it("신규리드 fallback도 진행현황 원본·옛 이동 키를 서버 호출에서 뺀다", () => {
    const keys = ["company", "consult_status", "contact_move", "workflow_progress", "phone"];
    const columns = keys.map((key, index) => ({
      id: `column-${key}`, org_id: "org-a", board_id: "board-a", key, label: key,
      type: "text" as const, source: "in" as const, rightPinned: false, options_jsonb: null,
      sort_order: index, width: null,
    }));
    expect(resolveBoardDetailLayout("core.default-tab/new-lead", [], columns).map((entry) => entry.key))
      .toEqual(["company", "phone"]);
  });
});
