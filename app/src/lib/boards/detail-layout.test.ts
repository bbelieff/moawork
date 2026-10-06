import { describe, expect, it } from "vitest";
import { CONTRACT_WORK_TAB } from "@/lib/default-tabs/contract-work";
import { NEW_LEAD_TAB } from "@/lib/default-tabs/new-lead";
import type { DefaultTab } from "@/lib/default-tabs/types";
import type { BoardColumn } from "./types";
import {
  detailKeyFromLabel,
  isMemberFieldType,
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

  /*
   * 2026-10-06 검토 P1 — 계약업체 실무 fallback 이 활성 컬럼을 «전부» 넣으면 첫 칸이 담당자(person)다.
   *   상세에는 계약업체 실무용 구성원 편집기가 없어 일반 글자 입력으로 떨어졌고, 담당자 자리에
   *   구성원 id 가 날것으로 보이며 아무 글자나 담당자로 저장됐다.
   */
  describe("구성원 칸(담당자·연관담당)", () => {
    // 실제 설치 정의 그대로의 컬럼 — 서버 호출부처럼 숨기기 전 전체를 넘긴다.
    const installed = (tab: DefaultTab): BoardColumn[] => tab.columns.map((definition, index) => ({
      id: `column-${definition.key}`, org_id: "org-a", board_id: `board-${tab.key}`,
      key: definition.key, label: definition.label, type: definition.type, source: definition.source,
      rightPinned: definition.rightPinned ?? false,
      options_jsonb: definition.options ? { options: definition.options } : null,
      sort_order: index, width: definition.width ?? null,
    }));

    it("계약업체 실무 기본 배치에는 구성원 칸이 없다 — 담당자는 연관담당 줄이 보여 준다", () => {
      const columns = installed(CONTRACT_WORK_TAB);
      expect(columns[0]).toMatchObject({ key: "owner", type: "person" });
      const resolved = resolveBoardDetailLayout(CONTRACT_WORK_TAB.source, [], columns);
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved.map((entry) => entry.key)).not.toContain("owner");
      expect(resolved.filter((entry) => isMemberFieldType(entry.type))).toEqual([]);
      // 구성원 칸만 빠지고 나머지 순서는 설치 정의 그대로다.
      expect(resolved[0].key).toBe(columns.find((column) => !isMemberFieldType(column.type))!.key);
    });

    it("신규리드는 담당자 전용 편집기(담당자 흐름)가 있어 기본 배치에 담당자를 남긴다", () => {
      const resolved = resolveBoardDetailLayout(NEW_LEAD_TAB.source, [], installed(NEW_LEAD_TAB));
      expect(resolved.map((entry) => entry.key)).toEqual(expect.arrayContaining(["owner", "collaborators"]));
    });

    it("person·people 만 구성원 칸이다", () => {
      expect(isMemberFieldType("person")).toBe(true);
      expect(isMemberFieldType("people")).toBe(true);
      for (const other of ["text", "status", "select", "multiselect", undefined, null]) {
        expect(isMemberFieldType(other)).toBe(false);
      }
    });
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
