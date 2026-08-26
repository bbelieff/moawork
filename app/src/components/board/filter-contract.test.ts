import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  applyFilters,
  decodeBoardFilters,
  EMPTY_FILTERS,
  encodeBoardFilters,
  savedViewFilterPayload,
} from "./filters";

const columns: BoardColumn[] = [
  {
    id: "status",
    org_id: "org-1",
    board_id: "board-1",
    key: "status",
    label: "상태",
    type: "select",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
  },
];

function row(index: number): ItemWithValues {
  return {
    id: `row-${index}`,
    org_id: "org-1",
    board_id: "board-1",
    group_id: null,
    title: `회사 ${index}`,
    assigned_to: index % 2 === 0 ? "u1" : "u2",
    deal_id: null,
    sort_order: index,
    created_at: "2026-08-16T00:00:00.000Z",
    updated_at: "2026-08-16T00:00:00.000Z",
    values: { status: index % 3 === 0 ? "new" : "hold" },
  };
}

describe("BBE-118 filter contract", () => {
  it("restores multi-select filters after a URL round trip and fails closed", () => {
    const filters = {
      ...EMPTY_FILTERS,
      q: "서울",
      assignees: ["u1", "u2"],
      byColumn: { status: ["new", "hold"] },
      sortKey: "status",
      sortDir: "desc" as const,
      visibleColumnKeys: ["status"],
    };
    expect(decodeBoardFilters(encodeBoardFilters(filters))).toEqual(filters);
    expect(decodeBoardFilters(JSON.stringify({ ...filters, columnLimit: 12 })).columnLimit).toBe(0);
    expect(decodeBoardFilters("not-json")).toEqual(EMPTY_FILTERS);
  });

  it("hands BBE-117 a versioned payload without persisting it", () => {
    const filters = { ...EMPTY_FILTERS, byColumn: { status: ["new"] } };
    expect(savedViewFilterPayload(filters)).toEqual({ version: 1, filters });
  });

  it("filters 8,400 actual rows with OR inside a column and AND across columns", () => {
    const rows = Array.from({ length: 8_400 }, (_, index) => row(index));
    const result = applyFilters(rows, columns, {
      ...EMPTY_FILTERS,
      assignees: ["u1"],
      byColumn: { status: ["new", "missing"] },
    });
    expect(result).toHaveLength(1_400);
  });
});
