import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  applyFilters,
  decodeBoardFilters,
  EMPTY_FILTERS,
  encodeBoardFilters,
  rowMatches,
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

function column(key: string, type: BoardColumn["type"]): BoardColumn {
  return {
    ...columns[0],
    id: key,
    key,
    label: key,
    type,
  };
}

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

  it("실제 보드 검색에서 typed 숫자의 raw·표시 문자열을 모두 찾는다", () => {
    const numericColumns = [column("number", "number"), column("money", "money")];
    const rows = [
      { ...row(1), values: { number: 1_234, money: -1_234.5 } },
      { ...row(2), values: { number: 2_000, money: 5 } },
    ];

    for (const q of ["1234", "1,234", "-1234.5", "-1,234.5"]) {
      expect(rowMatches(rows[0], numericColumns, { ...EMPTY_FILTERS, q })).toBe(true);
      expect(applyFilters(rows, numericColumns, { ...EMPTY_FILTERS, q }).map((item) => item.id))
        .toEqual(["row-1"]);
    }
  });

  it("text·phone·date·선행 0 문자열은 기존 표시 검색 의미를 보존한다", () => {
    const identityColumns = [
      column("identifier", "text"),
      column("phone", "phone"),
      column("date", "date"),
    ];
    const rows = [{
      ...row(1),
      values: {
        identifier: "001234",
        phone: "01012345678",
        date: "2026-08-27",
      },
    }];

    for (const q of ["001234", "010-1234-5678", "2026-08-27"]) {
      expect(applyFilters(rows, identityColumns, { ...EMPTY_FILTERS, q })).toHaveLength(1);
    }
    expect(applyFilters(rows, identityColumns, { ...EMPTY_FILTERS, q: "01012345678" }))
      .toHaveLength(0);
  });
});
