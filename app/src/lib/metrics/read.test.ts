import { describe, expect, it } from "vitest";
import { groupByDay } from "./read";
import type { DailyRollup } from "./types";

function row(day: string, orgId: string, dau = 1): DailyRollup {
  return {
    day,
    orgId,
    dau,
    mau: 10,
    stickiness: 0.1,
    activeUsers: 5,
    dormantUsers: 1,
    newDeals: 0,
  };
}

describe("groupByDay", () => {
  it("같은 날짜의 조직 행을 하나로 묶는다", () => {
    const groups = groupByDay([row("2026-07-27", "A"), row("2026-07-27", "B")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((r) => r.orgId)).toEqual(["A", "B"]);
  });

  it("최신 날짜가 먼저 온다", () => {
    const groups = groupByDay([
      row("2026-07-25", "A"),
      row("2026-07-27", "A"),
      row("2026-07-26", "A"),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-07-27", "2026-07-26", "2026-07-25"]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
