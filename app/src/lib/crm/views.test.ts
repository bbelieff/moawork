import { describe, it, expect } from "vitest";
import { applyView, matchFilter, resolveCellValue, STAGE_COLUMN_KEY } from "./views";
import type { ItemWithValues, ViewConfig } from "./types";

function mkItem(
  id: string,
  stageId: string | null,
  values: Record<string, unknown>,
  formulas: Record<string, unknown> = {},
): ItemWithValues {
  return {
    id,
    orgId: "org1",
    boardId: "b1",
    stageId,
    name: id,
    position: 0,
    createdBy: null,
    createdAt: "2026-07-21T00:00:00Z",
    updatedAt: "2026-07-21T00:00:00Z",
    completedAt: null,
    values: values as ItemWithValues["values"],
    formulas: formulas as ItemWithValues["formulas"],
  };
}

describe("matchFilter", () => {
  it("eq / neq (숫자문자열 정규화)", () => {
    expect(matchFilter(100, "eq", "100")).toBe(true);
    expect(matchFilter(100, "neq", 200)).toBe(true);
  });
  it("contains (대소문자 무시)", () => {
    expect(matchFilter("Hello World", "contains", "world")).toBe(true);
    expect(matchFilter("Hello", "contains", "xyz")).toBe(false);
  });
  it("gt/gte/lt/lte", () => {
    expect(matchFilter(5, "gt", 3)).toBe(true);
    expect(matchFilter(3, "gte", 3)).toBe(true);
    expect(matchFilter(2, "lt", 3)).toBe(true);
    expect(matchFilter(3, "lte", 3)).toBe(true);
  });
  it("is_empty / is_not_empty", () => {
    expect(matchFilter(null, "is_empty")).toBe(true);
    expect(matchFilter("", "is_empty")).toBe(true);
    expect(matchFilter("x", "is_not_empty")).toBe(true);
  });
});

describe("resolveCellValue", () => {
  const item = mkItem("i1", "stage-done", { 고객명: "홍길동" }, { 수수료: 3000000 });
  it("입력값 우선, 없으면 수식값", () => {
    expect(resolveCellValue(item, "고객명")).toBe("홍길동");
    expect(resolveCellValue(item, "수수료")).toBe(3000000);
    expect(resolveCellValue(item, "없음")).toBeNull();
  });
  it("__stage__ 는 stageKeyOf 로 해석", () => {
    expect(
      resolveCellValue(item, STAGE_COLUMN_KEY, (sid) => (sid === "stage-done" ? "done" : null)),
    ).toBe("done");
  });
});

describe("applyView — 필터 + 정렬", () => {
  const items = [
    mkItem("a", "s-consult", { 금액: 300 }, {}),
    mkItem("b", "s-done", { 금액: 100 }, {}),
    mkItem("c", "s-done", { 금액: 200 }, {}),
  ];
  const stageKeyOf = (sid: string | null) =>
    sid === "s-done" ? "done" : sid === "s-consult" ? "consulting" : null;

  it("단계 필터(AND) 적용", () => {
    const cfg: ViewConfig = {
      filters: [{ columnKey: STAGE_COLUMN_KEY, operator: "eq", value: "done" }],
      sorts: [],
    };
    const out = applyView(items, cfg, stageKeyOf);
    expect(out.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("금액 내림차순 정렬", () => {
    const cfg: ViewConfig = {
      filters: [],
      sorts: [{ columnKey: "금액", direction: "desc" }],
    };
    const out = applyView(items, cfg, stageKeyOf);
    expect(out.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("필터 + 정렬 결합", () => {
    const cfg: ViewConfig = {
      filters: [{ columnKey: STAGE_COLUMN_KEY, operator: "eq", value: "done" }],
      sorts: [{ columnKey: "금액", direction: "asc" }],
    };
    const out = applyView(items, cfg, stageKeyOf);
    expect(out.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("빈 config 는 원본 순서 유지", () => {
    const out = applyView(items, { filters: [], sorts: [] }, stageKeyOf);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
