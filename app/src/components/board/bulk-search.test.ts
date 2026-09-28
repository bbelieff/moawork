import { describe, expect, it } from "vitest";

import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { applyFilters, EMPTY_FILTERS, rowMatches } from "./filters";

const phoneCol = {
  id: "col-phone",
  org_id: "org-a",
  board_id: "board-a",
  key: "phone",
  label: "연락처",
  type: "phone",
  source: "in",
  rightPinned: false,
  options_jsonb: null,
  sort_order: 1,
  width: null,
} as unknown as BoardColumn;

const statusCol = {
  id: "col-status",
  org_id: "org-a",
  board_id: "board-a",
  key: "status",
  label: "상태",
  type: "status",
  source: "in",
  rightPinned: false,
  options_jsonb: { options: [{ id: "opt-doing", label: "진행중", order: 0 }] },
  sort_order: 0,
  width: null,
} as unknown as BoardColumn;

const row = (over: Partial<ItemWithValues> = {}): ItemWithValues =>
  ({
    id: "item-a",
    org_id: "org-a",
    board_id: "board-a",
    group_id: "group-a",
    title: "대한정밀",
    assigned_to: "user-1",
    deal_id: null,
    sort_order: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    values: { phone: "010-1234-5678", status: "opt-doing" },
    ...over,
  }) as ItemWithValues;

const COLUMNS = [statusCol, phoneCol] as readonly BoardColumn[];
const LABELS = { "user-1": "김담당" };

describe("보드 검색 정규화 (agenda06)", () => {
  it("전화 표기 차이와 무관하게 찾음 — 하이픈·+82·공백", () => {
    for (const q of ["01012345678", "010-1234-5678", "+82 10-1234-5678", "+821012345678", "1234"]) {
      expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q }, undefined, LABELS)).toBe(true);
    }
  });

  it("다른 번호는 걸리지 않음", () => {
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "01099998888" }, undefined, LABELS)).toBe(
      false,
    );
  });

  it("짧은 숫자(2자리 이하)는 번호 매칭을 타지 않음", () => {
    // "99" 는 표시 텍스트에 없고 번호 매칭 최소 길이(3)에도 못 미침.
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "99" }, undefined, LABELS)).toBe(false);
  });

  it("선택지 표기(라벨)로 찾고 id 로는 찾지 않음", () => {
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "진행중" }, undefined, LABELS)).toBe(true);
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "opt-doing" }, undefined, LABELS)).toBe(
      false,
    );
  });

  it("담당자 표시 이름으로 찾고 id(UUID)로는 찾지 않음 — 숨은 값 노출 금지", () => {
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "김담당" }, undefined, LABELS)).toBe(true);
    expect(rowMatches(row(), COLUMNS, { ...EMPTY_FILTERS, q: "user-1" }, undefined, LABELS)).toBe(false);
  });

  it("applyFilters 가 라벨 맵을 그대로 전달", () => {
    const kept = applyFilters([row()], COLUMNS, { ...EMPTY_FILTERS, q: "김담당" }, undefined, LABELS);
    expect(kept).toHaveLength(1);
    expect(applyFilters([row()], COLUMNS, { ...EMPTY_FILTERS, q: "user-1" }, undefined, LABELS)).toHaveLength(
      0,
    );
  });
});
