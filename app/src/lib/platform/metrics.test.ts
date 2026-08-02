import { describe, it, expect } from "vitest";
import {
  DORMANT_DAYS,
  activityMetrics,
  classifyHealth,
  daysAgo,
  healthMetrics,
  idleDaysSince,
  inputMetrics,
  median,
  ratio,
  retentionRate,
  revenueMetrics,
  sortByRisk,
  ttfvMetrics,
} from "./metrics";
import type { BillingMonthRow, MetricsDailyRow, OrgOverviewRow } from "./types";

const NOW = new Date("2026-07-29T00:00:00.000Z");

function org(id: string, patch: Partial<OrgOverviewRow> = {}): OrgOverviewRow {
  return {
    orgId: id,
    name: `조직${id}`,
    planTier: "t1_3",
    isInternal: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 5,
    activeUsers7d: 2,
    writes7d: 10,
    errors7d: 0,
    lastActivityAt: "2026-07-28T00:00:00.000Z",
    ...patch,
  };
}

function daily(
  date: string,
  orgId: string,
  patch: Partial<MetricsDailyRow> = {},
): MetricsDailyRow {
  return { date, orgId, activeUsers: 1, writes: 5, errors: 0, memberCount: 5, ...patch };
}

describe("ratio — 0분모 방어", () => {
  it("분모가 0이거나 음수면 0을 낸다 (NaN·Infinity 금지)", () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(5, -1)).toBe(0);
    expect(Number.isFinite(ratio(5, 0))).toBe(true);
  });

  it("정상 분모에서는 몫을 낸다", () => {
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe("idleDaysSince / classifyHealth", () => {
  it("경과 일수를 센다", () => {
    expect(idleDaysSince("2026-07-29T00:00:00.000Z", NOW)).toBe(0);
    expect(idleDaysSince("2026-07-22T00:00:00.000Z", NOW)).toBe(7);
  });

  it("활동 이력이 없으면 null 이고 휴면으로 본다", () => {
    expect(idleDaysSince(null, NOW)).toBeNull();
    expect(classifyHealth(null, NOW)).toBe("dormant");
  });

  it("14일 무활동은 휴면, 7~13일은 둔화, 그 미만은 활발", () => {
    expect(classifyHealth("2026-07-15T00:00:00.000Z", NOW)).toBe("dormant"); // 14일
    expect(classifyHealth("2026-07-22T00:00:00.000Z", NOW)).toBe("slowing"); // 7일
    expect(classifyHealth("2026-07-28T00:00:00.000Z", NOW)).toBe("active"); // 1일
  });

  it("휴면 기준은 14일이다", () => {
    expect(DORMANT_DAYS).toBe(14);
  });
});

describe("sortByRisk — 기본 정렬은 위험순", () => {
  it("휴면 → 둔화 → 활발 순으로 낸다", () => {
    const sorted = sortByRisk(
      [
        org("a", { lastActivityAt: "2026-07-28T00:00:00.000Z" }), // 활발
        org("b", { lastActivityAt: "2026-07-01T00:00:00.000Z" }), // 휴면
        org("c", { lastActivityAt: "2026-07-22T00:00:00.000Z" }), // 둔화
      ],
      NOW,
    );
    expect(sorted.map((r) => r.orgId)).toEqual(["b", "c", "a"]);
    expect(sorted.map((r) => r.health)).toEqual(["dormant", "slowing", "active"]);
  });

  it("활동 이력이 아예 없는 조직이 가장 위험하다", () => {
    const sorted = sortByRisk(
      [
        org("old", { lastActivityAt: "2026-06-01T00:00:00.000Z" }),
        org("never", { lastActivityAt: null }),
      ],
      NOW,
    );
    expect(sorted[0].orgId).toBe("never");
  });

  it("같은 상태면 오래 놀고 있는 쪽 → 규모 큰 쪽 순이다", () => {
    const sorted = sortByRisk(
      [
        org("small", { lastActivityAt: "2026-07-01T00:00:00.000Z", memberCount: 2 }),
        org("older", { lastActivityAt: "2026-06-20T00:00:00.000Z", memberCount: 2 }),
        org("big", { lastActivityAt: "2026-07-01T00:00:00.000Z", memberCount: 50 }),
      ],
      NOW,
    );
    expect(sorted.map((r) => r.orgId)).toEqual(["older", "big", "small"]);
  });

  it("활성/전체 비율을 파생하고 멤버 0명이면 0이다", () => {
    const sorted = sortByRisk(
      [org("a", { memberCount: 4, activeUsers7d: 1 }), org("b", { memberCount: 0 })],
      NOW,
    );
    expect(sorted.find((r) => r.orgId === "a")?.activeRatio).toBe(0.25);
    expect(sorted.find((r) => r.orgId === "b")?.activeRatio).toBe(0);
  });

  it("빈 입력에서 빈 배열을 낸다", () => {
    expect(sortByRisk([], NOW)).toEqual([]);
  });
});

describe("activityMetrics — DAU/WAU/MAU·스티키니스", () => {
  it("기간별 조직 최대 활성자를 합산한다", () => {
    const rows = [
      daily(daysAgo(0, NOW), "o1", { activeUsers: 3 }),
      daily(daysAgo(0, NOW), "o2", { activeUsers: 2 }),
      daily(daysAgo(3, NOW), "o1", { activeUsers: 5 }),
      daily(daysAgo(20, NOW), "o1", { activeUsers: 9 }),
    ];
    const m = activityMetrics(rows, NOW);
    expect(m.dau).toBe(5); // 오늘: o1 3 + o2 2
    expect(m.wau).toBe(7); // 7일: o1 max 5 + o2 2
    expect(m.mau).toBe(11); // 30일: o1 max 9 + o2 2
    expect(m.stickiness).toBeCloseTo(5 / 11);
  });

  it("데이터가 없으면 전부 0이고 스티키니스도 0이다 (NaN 없음)", () => {
    const m = activityMetrics([], NOW);
    expect(m).toEqual({ dau: 0, wau: 0, mau: 0, stickiness: 0 });
  });

  it("30일보다 오래된 데이터는 MAU 에 들어가지 않는다", () => {
    const m = activityMetrics([daily(daysAgo(40, NOW), "o1", { activeUsers: 99 })], NOW);
    expect(m.mau).toBe(0);
  });
});

describe("inputMetrics", () => {
  it("쓰기 총합과 조직별 일평균을 낸다", () => {
    const rows = [
      daily("2026-07-28", "o1", { writes: 10 }),
      daily("2026-07-28", "o2", { writes: 6 }),
      daily("2026-07-29", "o1", { writes: 4 }),
    ];
    const m = inputMetrics(rows);
    expect(m.writes).toBe(20);
    expect(m.orgCount).toBe(2);
    expect(m.days).toBe(2);
    expect(m.writesPerOrgPerDay).toBe(5); // 20 / (2 조직 × 2일)
  });

  it("빈 입력이면 0이다", () => {
    expect(inputMetrics([])).toEqual({
      writes: 0,
      writesPerOrgPerDay: 0,
      days: 0,
      orgCount: 0,
    });
  });
});

describe("median / ttfvMetrics", () => {
  it("중앙값 — 홀수·짝수·빈 배열", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("첫 딜이 없는 조직은 미전환으로 분리한다 (0시간으로 넣지 않는다)", () => {
    const m = ttfvMetrics([
      {
        orgId: "a",
        name: "A",
        signedUpAt: "2026-07-01T00:00:00.000Z",
        firstDealAt: "2026-07-01T02:00:00.000Z", // 2시간
      },
      { orgId: "b", name: "B", signedUpAt: "2026-07-01T00:00:00.000Z", firstDealAt: null },
    ]);
    expect(m.converted).toBe(1);
    expect(m.total).toBe(2);
    expect(m.medianHours).toBe(2);
    expect(m.meanHours).toBe(2);
  });

  it("첫 딜이 가입보다 앞선 비정상 데이터는 제외한다", () => {
    const m = ttfvMetrics([
      {
        orgId: "a",
        name: "A",
        signedUpAt: "2026-07-10T00:00:00.000Z",
        firstDealAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    expect(m.converted).toBe(0);
    expect(m.medianHours).toBeNull();
  });

  it("전환 조직이 없으면 중앙값·평균이 null 이다", () => {
    const m = ttfvMetrics([]);
    expect(m).toEqual({ converted: 0, total: 0, medianHours: null, meanHours: null });
  });
});

describe("retentionRate", () => {
  const signedUp = "2026-06-01T00:00:00.000Z";

  it("가입 후 N주차에 활동이 있으면 유지로 센다", () => {
    const rate = retentionRate(
      [{ orgId: "o1", createdAt: signedUp }],
      [daily("2026-06-09", "o1", { activeUsers: 1 })], // W1 창(6/8~6/15)
      1,
      NOW,
    );
    expect(rate).toBe(1);
  });

  it("해당 주차에 활동이 없으면 이탈이다", () => {
    const rate = retentionRate(
      [{ orgId: "o1", createdAt: signedUp }],
      [daily("2026-06-02", "o1", { activeUsers: 1 })], // W0 만 활동
      1,
      NOW,
    );
    expect(rate).toBe(0);
  });

  it("아직 그 주차가 오지 않은 조직은 코호트에서 뺀다", () => {
    // 어제 가입 → W4 창이 미도래 → 코호트 0 → 0분모 방어로 0
    const rate = retentionRate(
      [{ orgId: "new", createdAt: "2026-07-28T00:00:00.000Z" }],
      [],
      4,
      NOW,
    );
    expect(rate).toBe(0);
  });

  it("활동량이 0인 롤업 행은 유지로 세지 않는다", () => {
    const rate = retentionRate(
      [{ orgId: "o1", createdAt: signedUp }],
      [daily("2026-06-09", "o1", { activeUsers: 0, writes: 0 })],
      1,
      NOW,
    );
    expect(rate).toBe(0);
  });
});

describe("healthMetrics", () => {
  it("휴면 조직수·오류율·미처리요청을 묶어 낸다", () => {
    const orgs = [
      org("a", { lastActivityAt: "2026-07-01T00:00:00.000Z" }), // 휴면
      org("b", { lastActivityAt: "2026-07-28T00:00:00.000Z" }), // 활발
    ];
    const rows = [
      daily("2026-07-28", "a", { writes: 90, errors: 10 }),
      daily("2026-07-28", "b", { writes: 10, errors: 0 }),
    ];
    const m = healthMetrics(orgs, rows, 3, NOW);
    expect(m.dormantOrgs).toBe(1);
    expect(m.errorRate).toBeCloseTo(0.1);
    expect(m.pendingRequests).toBe(3);
  });

  it("쓰기가 0이면 오류율은 0이다 (0분모 방어)", () => {
    expect(healthMetrics([], [], 0, NOW).errorRate).toBe(0);
  });
});

describe("revenueMetrics", () => {
  function month(m: string, supply: number, paid: number): BillingMonthRow {
    const vat = Math.round(supply * 0.1);
    return {
      month: m,
      invoiceCount: 1,
      supplySum: supply,
      vatSum: vat,
      totalSum: supply + vat,
      paidSum: paid,
    };
  }

  it("MRR 은 공급가액(부가세 제외) 기준이고 ARR 은 12배다", () => {
    const m = revenueMetrics([month("2026-06-01", 1_000_000, 0), month("2026-07-01", 1_200_000, 0)]);
    expect(m.mrr).toBe(1_200_000);
    expect(m.arr).toBe(14_400_000);
  });

  it("NRR 은 전월 대비이며 입력 순서에 의존하지 않는다", () => {
    const rowsAsc = [month("2026-06-01", 1_000_000, 0), month("2026-07-01", 1_200_000, 0)];
    const rowsDesc = [...rowsAsc].reverse();
    expect(revenueMetrics(rowsAsc).nrr).toBeCloseTo(1.2);
    expect(revenueMetrics(rowsDesc).nrr).toBeCloseTo(1.2);
  });

  it("전월 매출이 0이면 NRR 은 정의 불가(null) — 0으로 표시하지 않는다", () => {
    expect(revenueMetrics([month("2026-07-01", 500_000, 0)]).nrr).toBeNull();
  });

  it("미수금은 청구−수납이며 음수는 0으로 절사한다", () => {
    const over = revenueMetrics([month("2026-07-01", 1_000_000, 99_999_999)]);
    expect(over.outstanding).toBe(0);
    const owed = revenueMetrics([month("2026-07-01", 1_000_000, 0)]);
    expect(owed.outstanding).toBe(1_100_000); // 공급가 100만 + 부가세 10만
  });

  it("데이터가 없으면 전부 0이고 NRR 은 null", () => {
    expect(revenueMetrics([])).toEqual({ mrr: 0, arr: 0, nrr: null, outstanding: 0 });
  });
});
