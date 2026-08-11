import { describe, expect, it } from "vitest";
import { isMoveColumn, resolveMoveTarget } from "./moveRules";
import type { BoardColumn } from "./types";

function col(move_rule_jsonb: Record<string, string> | null | undefined): Pick<BoardColumn, "move_rule_jsonb"> {
  return { move_rule_jsonb };
}

describe("resolveMoveTarget", () => {
  it("규칙 없는 컬럼은 항상 null", () => {
    expect(resolveMoveTarget(col(null), "x")).toBeNull();
    expect(resolveMoveTarget(col(undefined), "x")).toBeNull();
    expect(resolveMoveTarget(col({}), "x")).toBeNull();
  });

  it("규칙에 있는 값이면 매핑된 그룹 id를 돌려준다", () => {
    const c = col({ "opt-done": "grp-1", "opt-hold": "grp-2" });
    expect(resolveMoveTarget(c, "opt-done")).toBe("grp-1");
    expect(resolveMoveTarget(c, "opt-hold")).toBe("grp-2");
  });

  it("규칙에 없는 값은 null(이동 안 함)", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, "opt-other")).toBeNull();
  });

  it("빈 값(null/undefined)은 null", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, null)).toBeNull();
    expect(resolveMoveTarget(c, undefined as never)).toBeNull();
  });

  it("multiselect(배열 값)는 이동 대상이 아니다 — 여러 그룹을 동시에 가리킬 수 없다", () => {
    const c = col({ "opt-done": "grp-1" });
    expect(resolveMoveTarget(c, ["opt-done"])).toBeNull();
  });

  it("숫자·불리언 값도 문자열 키로 비교한다", () => {
    const c = col({ "1": "grp-1", "true": "grp-2" });
    expect(resolveMoveTarget(c, 1)).toBe("grp-1");
    expect(resolveMoveTarget(c, true)).toBe("grp-2");
  });
});

describe("isMoveColumn", () => {
  it("규칙이 비어 있지 않으면 true", () => {
    expect(isMoveColumn(col({ a: "g1" }))).toBe(true);
  });
  it("규칙이 없거나 빈 객체면 false", () => {
    expect(isMoveColumn(col(null))).toBe(false);
    expect(isMoveColumn(col(undefined))).toBe(false);
    expect(isMoveColumn(col({}))).toBe(false);
  });
});
