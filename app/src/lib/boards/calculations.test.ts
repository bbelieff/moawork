import { describe, expect, it } from "vitest";
import { calculateFields, calculationFreshness } from "./calculations";

const NOW = new Date("2026-08-13T03:00:00.000Z");

describe("BBE-153 D79 자동계산 6개", () => {
  it("6개 공식을 계산하고 계산시각·날짜 기반 stale 경계를 함께 만든다", () => {
    const result = calculateFields({
      executionAmount: 100_000_000,
      feePercent: 3,
      fundedOn: "2026-08-20",
      feePaidOn: "2026-08-01",
      reviewEndsOn: "2026-10-03",
      targetIds: ["a", "b", "c"],
      readerIds: ["b", "c", "x"],
    }, NOW, 7_000_000);

    expect(result.values).toEqual({
      reapply_notice_date: "2027-08-20",
      fee_amount: 3_000_000,
      total_revenue: 7_000_000,
      review_dday: "D-51",
      d180: "2027-01-28",
      read_count: 2,
    });
    expect(result.calculatedAt).toBe(NOW.toISOString());
    expect(result.staleAfter.review_dday).toBe("2026-08-13T15:00:00.000Z");
    expect(result.staleAfter.d180).toBe("2026-08-13T15:00:00.000Z");
  });

  it("원본이 없거나 잘못된 값이면 이전 계산값을 유지하지 않고 null로 계산한다", () => {
    expect(calculateFields({ fundedOn: "2026-02-30" }, NOW).values).toEqual({
      reapply_notice_date: null,
      fee_amount: null,
      total_revenue: null,
      review_dday: null,
      d180: null,
      read_count: null,
    });
  });

  it("원본·일일 경계·실패가 계산시각보다 새로우면 stale로 판정한다", () => {
    expect(calculationFreshness(null, null, null, null, NOW)).toBe("unknown");
    expect(calculationFreshness("2026-08-13T02:00:00Z", "2026-08-13T15:00:00Z", "2026-08-13T01:00:00Z", null, NOW)).toBe("fresh");
    expect(calculationFreshness("2026-08-13T02:00:00Z", "2026-08-13T03:00:00Z", null, null, NOW)).toBe("stale");
    expect(calculationFreshness("2026-08-13T02:00:00Z", null, "2026-08-13T02:00:01Z", null, NOW)).toBe("stale");
    expect(calculationFreshness("2026-08-13T02:00:00Z", null, null, "2026-08-13T02:00:01Z", NOW)).toBe("stale");
  });

  it("8,400건 6개 공식을 회귀 예산 안에서 계산한다", () => {
    const startedAt = performance.now();
    for (let index = 0; index < 8_400; index += 1) {
      calculateFields({
        executionAmount: 10_000_000 + index,
        feePercent: 3,
        fundedOn: "2026-08-20",
        feePaidOn: "2026-08-01",
        reviewEndsOn: "2026-10-03",
        targetIds: ["a"],
        readerIds: ["a"],
      }, NOW, 252_000_000);
    }
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });
});
