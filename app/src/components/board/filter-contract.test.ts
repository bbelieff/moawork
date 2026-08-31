import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  activeFacetCount,
  activeFilterCount,
  applyFilters,
  decodeBoardFilters,
  EMPTY_FILTERS,
  encodeBoardFilters,
  rowMatches,
  savedViewFilterPayload,
  type BoardFilterProjection,
} from "./filters";
import {
  compareNewLeadFinancialValues,
  newLeadFinancialSearchText,
} from "@/lib/new-lead/financial-profile";
import {
  emptyOtherInfoValue,
  otherInfoFacetFilterKey,
  updateOtherInfoEntry,
} from "@/lib/boards/structured-field";

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
    expect(decodeBoardFilters(encodeBoardFilters(filters))).toEqual({
      ...filters,
      byColumn: { status: ["hold", "new"] },
    });
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
    const rows: ItemWithValues[] = [
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

  it("신규리드 finance projection만 합성 검색·숫자 정렬을 쓰고 legacy/null은 마지막에 둔다", () => {
    const projection: BoardFilterProjection = {
      searchText: (item, boardColumn) => newLeadFinancialSearchText(boardColumn.key, item.values),
      compareRows: (left, right, key, direction) =>
        compareNewLeadFinancialValues(key, left.values, right.values, direction),
    };
    const financeColumns = [column("credit_scores", "text"), column("revenue_3y_million", "number")];
    const financeRows: ItemWithValues[] = [
      { ...row(1), id: "two", values: { credit_score_ncb: 800, credit_score_kcb: 700, revenue_3y_million: 2 } },
      { ...row(2), id: "ten", values: { credit_score_ncb: 800, credit_score_kcb: 750, revenue_3y_million: 10 } },
      { ...row(3), id: "hundred", values: { credit_score_ncb: 900, revenue_3y_million: 100 } },
      { ...row(4), id: "legacy", values: { revenue_band: "10억~30억" } },
      { ...row(5), id: "grouped", values: { revenue_3y_million: 1234 } },
    ];
    expect(applyFilters(financeRows, financeColumns, { ...EMPTY_FILTERS, q: "NCB 800 KCB 750" }, projection).map((item) => item.id))
      .toEqual(["ten"]);
    for (const q of ["1234", "1,234", "10억~30억"]) {
      expect(applyFilters(financeRows, financeColumns, { ...EMPTY_FILTERS, q }, projection)).toHaveLength(1);
    }
    expect(applyFilters(financeRows, financeColumns, { ...EMPTY_FILTERS, sortKey: "revenue_3y_million", sortDir: "asc" }, projection).map((item) => item.id))
      .toEqual(["two", "ten", "hundred", "grouped", "legacy"]);
    expect(applyFilters(financeRows, financeColumns, { ...EMPTY_FILTERS, sortKey: "revenue_3y_million", sortDir: "desc" }, projection).map((item) => item.id))
      .toEqual(["grouped", "hundred", "ten", "two", "legacy"]);
    expect(applyFilters(financeRows, financeColumns, { ...EMPTY_FILTERS, sortKey: "credit_scores", sortDir: "asc" }, projection).map((item) => item.id))
      .toEqual(["two", "ten", "hundred", "legacy", "grouped"]);
  });

  it("기타정보 facet은 같은 facet OR·다른 facet AND이며 structured가 legacy보다 우선한다", () => {
    let structured = updateOtherInfoEntry(emptyOtherInfoValue(), "intellectualProperty", { checked: true, text: "특허" });
    structured = updateOtherInfoEntry(structured, "export", { checked: false, text: "과거 수출" });
    const rows: ItemWithValues[] = [
      { ...row(1), id: "structured", values: { other_info: structured, export_status: "수출 중" } },
      { ...row(2), id: "legacy", values: { export_status: "수출 예정" } },
      { ...row(3), id: "missing", values: {} },
    ];
    const infoColumns = [column("other_info", "other_info")];
    const filters = {
      ...EMPTY_FILTERS,
      byColumn: {
        [otherInfoFacetFilterKey("other_info", "intellectualProperty")]: ["true"],
        [otherInfoFacetFilterKey("other_info", "export")]: ["missing", "false"],
      },
    };
    expect(applyFilters(rows, infoColumns, filters).map((item) => item.id)).toEqual(["structured"]);
    expect(applyFilters(rows, infoColumns, {
      ...EMPTY_FILTERS,
      byColumn: { [otherInfoFacetFilterKey("other_info", "export")]: ["true"] },
    }).map((item) => item.id)).toEqual(["legacy"]);
  });

  it("facet URL은 순서와 중복을 정규화하고 잘못된 상태는 fail-closed한다", () => {
    const facet = otherInfoFacetFilterKey("other_info", "certifications");
    const encoded = encodeBoardFilters({
      ...EMPTY_FILTERS,
      assignees: ["b", "a", "a"],
      byColumn: { [facet]: ["true", "missing", "true"] },
    });
    expect(decodeBoardFilters(encoded).byColumn).toEqual({ [facet]: ["missing", "true"] });
    expect(rowMatches(row(1), [column("other_info", "other_info")], {
      ...EMPTY_FILTERS,
      byColumn: { [facet]: ["future"] },
    })).toBe(false);
  });

  it("namespaced facet evaluates the exact physical column key", () => {
    const custom = updateOtherInfoEntry(emptyOtherInfoValue(), "export", { checked: true });
    const rowWithTwo = {
      ...row(1),
      values: { other_info: emptyOtherInfoValue(), custom_other: custom },
    };
    expect(rowMatches(rowWithTwo, [column("other_info", "other_info"), column("custom_other", "other_info")], {
      ...EMPTY_FILTERS,
      byColumn: { [otherInfoFacetFilterKey("custom_other", "export")]: ["true"] },
    })).toBe(true);
    expect(rowMatches(rowWithTwo, [column("other_info", "other_info"), column("custom_other", "other_info")], {
      ...EMPTY_FILTERS,
      byColumn: { [otherInfoFacetFilterKey("other_info", "export")]: ["true"] },
    })).toBe(false);
  });
});

/*
 * #655 — 「필터」 버튼 배지의 수.
 *
 * activeFilterCount 와 «일부러» 다르다. 저쪽은 「초기화」를 띄울지 정하려고 지금 무엇이든
 * 걸려 있나를 센다(검색어·정렬·표시 컬럼 포함). 여기는 «접힌 패널 안에» 몇 개가 걸렸나다.
 * 둘을 같은 수로 만들면 배지가 「2」라고 하는데 열어 보면 하나뿐인 상태가 생긴다.
 */
describe("#655 접힌 필터 배지는 패널 «안» 만 센다", () => {
  it("검색어·정렬·표시 컬럼은 배지에 안 들어간다 — 패널 밖에 그대로 보이기 때문이다", () => {
    const outside = {
      ...EMPTY_FILTERS,
      q: "대한",
      sorts: [{ columnKey: "applied_on", direction: "asc" as const }],
      visibleColumnKeys: ["title"],
    };
    expect(activeFacetCount(outside)).toBe(0);
    // 대조군 — 저쪽 계수는 같은 상태를 3으로 센다. 둘이 다른 것이 «의도» 임을 못박는다.
    expect(activeFilterCount(outside)).toBe(3);
  });

  it("담당자와 컬럼 필터만 센다", () => {
    const inside = {
      ...EMPTY_FILTERS,
      assignees: ["u1"],
      byColumn: { consult_status: ["a"], industry: [] },
    };
    expect(activeFacetCount(inside)).toBe(2);
  });

  it("빈 배열은 «걸린 것» 이 아니다 — 해제하면 배지가 사라져야 한다", () => {
    expect(activeFacetCount({ ...EMPTY_FILTERS, byColumn: { consult_status: [] } })).toBe(0);
  });
});
