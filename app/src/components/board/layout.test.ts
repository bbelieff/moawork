import { describe, expect, it } from "vitest";
import type { BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import {
  groupKeyOf,
  moveWithin,
  reorderColumnKeys,
  resolveColumnOrder,
  UNGROUPED_KEY,
} from "./layout";
import { buildBlocks } from "./blocks";
import {
  applyFilters,
  assigneeOptions,
  activeFilterCount,
  EMPTY_FILTERS,
  limitColumns,
  UNASSIGNED,
} from "./filters";

function col(key: string, over: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: `col-${key}`,
    org_id: "org",
    board_id: "b1",
    key,
    label: key.toUpperCase(),
    type: "text",
    options_jsonb: null,
    sort_order: 0,
    width: null,
    ...over,
  };
}

function row(id: string, over: Partial<ItemWithValues> = {}): ItemWithValues {
  return {
    id,
    org_id: "org",
    board_id: "b1",
    group_id: null,
    title: id,
    assigned_to: null,
    sort_order: 0,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
    values: {},
    ...over,
  };
}

function group(id: string, sort_order: number, over: Partial<BoardGroup> = {}): BoardGroup {
  return { id, org_id: "org", board_id: "b1", name: id, color: null, sort_order, ...over };
}

const COLUMNS = [col("a"), col("b"), col("c")];

describe("resolveColumnOrder — 그룹별 배치 오버라이드", () => {
  it("오버라이드가 없으면 보드 기본 순서 그대로", () => {
    expect(resolveColumnOrder(COLUMNS, undefined).map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(resolveColumnOrder(COLUMNS, []).map((c) => c.key)).toEqual(["a", "b", "c"]);
  });

  it("오버라이드 순서를 앞에 두고 나머지는 기본 순서로 잇는다(부분 목록 허용)", () => {
    expect(resolveColumnOrder(COLUMNS, ["c"]).map((c) => c.key)).toEqual(["c", "a", "b"]);
  });

  it("삭제된 컬럼의 잔재 key 는 조용히 무시한다", () => {
    expect(resolveColumnOrder(COLUMNS, ["zzz", "b"]).map((c) => c.key)).toEqual(["b", "a", "c"]);
  });

  it("중복 key 가 있어도 컬럼이 두 번 그려지지 않는다", () => {
    const out = resolveColumnOrder(COLUMNS, ["b", "b", "a"]);
    expect(out.map((c) => c.key)).toEqual(["b", "a", "c"]);
    expect(out).toHaveLength(COLUMNS.length);
  });

  it("어떤 오버라이드를 줘도 컬럼 집합 자체는 보존된다(정의는 보드 전역)", () => {
    for (const override of [["c", "a"], ["zzz"], ["b", "c", "a"], []]) {
      const keys = resolveColumnOrder(COLUMNS, override)
        .map((c) => c.key)
        .sort();
      expect(keys).toEqual(["a", "b", "c"]);
    }
  });

  it("한 그룹의 오버라이드는 다른 그룹 결과에 영향을 주지 않는다", () => {
    const gA = resolveColumnOrder(COLUMNS, ["c", "b", "a"]).map((c) => c.key);
    const gB = resolveColumnOrder(COLUMNS, undefined).map((c) => c.key);
    expect(gA).toEqual(["c", "b", "a"]);
    expect(gB).toEqual(["a", "b", "c"]);
  });
});

describe("moveWithin / reorderColumnKeys", () => {
  it("앞으로·뒤로 이동", () => {
    expect(moveWithin([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveWithin([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
  });

  it("범위 밖 인덱스는 원본 복사본을 돌려준다(드롭 실패가 예외가 되지 않는다)", () => {
    expect(moveWithin([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
    expect(moveWithin([1, 2, 3], 0, 9)).toEqual([1, 2, 3]);
  });

  it("컬럼 드래그 왕복 후 원래 배치로 돌아온다", () => {
    const moved = reorderColumnKeys(COLUMNS, "a", "c"); // a 를 c 자리로
    expect(moved).toEqual(["b", "c", "a"]);

    const movedCols = resolveColumnOrder(COLUMNS, moved);
    const back = reorderColumnKeys(movedCols, "a", "b"); // 다시 맨 앞으로
    expect(back).toEqual(["a", "b", "c"]);
  });
});

describe("buildBlocks — 블록 리스트", () => {
  const groups = [group("g2", 1), group("g1", 0)];

  it("블록 순서는 그룹 sort_order, 행 순서는 아이템 sort_order", () => {
    const rows = [
      row("r2", { group_id: "g1", sort_order: 1 }),
      row("r1", { group_id: "g1", sort_order: 0 }),
    ];
    const blocks = buildBlocks(groups, rows);
    expect(blocks.map((b) => b.key)).toEqual(["g1", "g2"]);
    expect(blocks[0].rows.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("행이 없는 그룹도 블록으로 남는다(그 자리에 인라인 빈 상태를 그린다)", () => {
    const blocks = buildBlocks(groups, []);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].rows).toEqual([]);
  });

  it("그룹 없는 행이 있을 때만 «그룹 없음» 블록이 맨 뒤에 생긴다", () => {
    expect(buildBlocks(groups, []).some((b) => b.key === UNGROUPED_KEY)).toBe(false);

    const blocks = buildBlocks(groups, [row("orphan")]);
    expect(blocks.at(-1)?.key).toBe(UNGROUPED_KEY);
    expect(blocks.at(-1)?.name).toBe("그룹 없음");
  });

  it("groupKeyOf 는 null 을 가상 그룹 키로 수렴시킨다", () => {
    expect(groupKeyOf(null)).toBe(UNGROUPED_KEY);
    expect(groupKeyOf("g1")).toBe("g1");
  });
});

describe("filters", () => {
  const columns = [
    col("name"),
    col("status", {
      type: "select",
      options_jsonb: {
        options: [
          { id: "o-new", label: "신규", order: 0 },
          { id: "o-hold", label: "보류", order: 1 },
        ],
      },
    }),
    col("amount", { type: "number" }),
  ];

  const rows = [
    row("r1", { title: "가나상사", assigned_to: "이대표", values: { status: "o-new", amount: 10 } }),
    row("r2", { title: "다라산업", assigned_to: null, values: { status: "o-hold", amount: 30 } }),
    row("r3", { title: "마바테크", assigned_to: "이대표", values: { status: "o-new", amount: 20 } }),
  ];

  it("검색은 제목과 셀의 **표시 라벨**을 함께 본다(옵션 id 가 아니라)", () => {
    expect(applyFilters(rows, columns, { ...EMPTY_FILTERS, q: "다라" }).map((r) => r.id)).toEqual([
      "r2",
    ]);
    expect(applyFilters(rows, columns, { ...EMPTY_FILTERS, q: "보류" }).map((r) => r.id)).toEqual([
      "r2",
    ]);
    // 내부 id 로는 검색되지 않아야 한다(사용자가 보는 어휘가 기준).
    expect(applyFilters(rows, columns, { ...EMPTY_FILTERS, q: "o-hold" })).toHaveLength(0);
  });

  it("담당자 필터와 «미배정»", () => {
    expect(
      applyFilters(rows, columns, { ...EMPTY_FILTERS, assignees: ["이대표"] }).map((r) => r.id),
    ).toEqual(["r1", "r3"]);
    expect(
      applyFilters(rows, columns, { ...EMPTY_FILTERS, assignees: [UNASSIGNED] }).map((r) => r.id),
    ).toEqual(["r2"]);
  });

  it("선택지 컬럼 필터는 여러 값을 OR 로 본다", () => {
    const f = { ...EMPTY_FILTERS, byColumn: { status: ["o-new"] } };
    expect(applyFilters(rows, columns, f).map((r) => r.id)).toEqual(["r1", "r3"]);

    const both = { ...EMPTY_FILTERS, byColumn: { status: ["o-new", "o-hold"] } };
    expect(applyFilters(rows, columns, both)).toHaveLength(3);
  });

  it("정렬 기준이 없으면 행 순서를 건드리지 않는다(드래그 배치 보존)", () => {
    expect(applyFilters(rows, columns, EMPTY_FILTERS).map((r) => r.id)).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("정렬 기준이 있으면 방향대로 정렬한다", () => {
    const asc = { ...EMPTY_FILTERS, sortKey: "amount", sortDir: "asc" as const };
    expect(applyFilters(rows, columns, asc).map((r) => r.id)).toEqual(["r1", "r3", "r2"]);

    const desc = { ...EMPTY_FILTERS, sortKey: "amount", sortDir: "desc" as const };
    expect(applyFilters(rows, columns, desc).map((r) => r.id)).toEqual(["r2", "r3", "r1"]);
  });

  it("컬럼수 제한은 앞에서 N개만 남기고, 0/초과는 전부", () => {
    expect(limitColumns(columns, 2).map((c) => c.key)).toEqual(["name", "status"]);
    expect(limitColumns(columns, 0)).toHaveLength(3);
    expect(limitColumns(columns, 99)).toHaveLength(3);
  });

  it("담당자 선택지는 데이터에 실재하는 값 + 미배정", () => {
    expect(assigneeOptions(rows)).toEqual([
      { value: "이대표", label: "이대표" },
      { value: UNASSIGNED, label: "미배정" },
    ]);
  });

  it("활성 필터 개수는 칩별로 1씩", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        q: "가",
        assignees: ["이대표"],
        byColumn: { status: ["o-new"], other: [] },
        sortKey: "amount",
        columnLimit: 8,
      }),
    ).toBe(5);
  });
});
