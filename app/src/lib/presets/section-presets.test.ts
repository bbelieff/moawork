import { describe, expect, it } from "vitest";
import { snapshotSectionPreset } from "./section-presets";

describe("snapshotSectionPreset", () => {
  it("그룹과 컬럼 구조를 줄이지 않고 재사용 가능한 값으로 복사한다", () => {
    const result = snapshotSectionPreset("  영업 기본  ", [
      { id: "g1", org_id: "o", board_id: "b", name: "접수", color: "#fff", sort_order: 0 },
      { id: "g2", org_id: "o", board_id: "b", name: "완료", color: null, sort_order: 1 },
    ], [{
      id: "c1", org_id: "o", board_id: "b", key: "status", label: "상태", type: "select", source: "in",
      rightPinned: false, options_jsonb: { options: [{ id: "done", label: "완료", order: 0 }] }, sort_order: 0, width: 140,
      move_rule_jsonb: { done: "완료" }, is_readonly: false,
    }]);
    expect(result.name).toBe("영업 기본");
    expect(result.groups).toHaveLength(2);
    expect(result.columns).toEqual([expect.objectContaining({ key: "status", move_rule_jsonb: { done: "완료" } })]);
  });
});
