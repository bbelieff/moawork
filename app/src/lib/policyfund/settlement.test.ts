import { describe, it, expect } from "vitest";
import {
  commission,
  settlementDate,
  computeSettlement,
  totalRevenue,
  grossFromDisbursement,
} from "./settlement";

describe("commission", () => {
  it("수수료 = 집행금액 × 수수료율 (원 단위 반올림)", () => {
    expect(commission(100_000_000, 0.03)).toBe(3_000_000);
  });

  it("반올림한다", () => {
    expect(commission(1_000_001, 0.03)).toBe(30_000); // 30000.03 → 30000
    expect(commission(333, 0.05)).toBe(17); // 16.65 → 17
  });

  it("집행금액 0 이면 0", () => {
    expect(commission(0, 0.03)).toBe(0);
  });
});

describe("settlementDate", () => {
  const contract = new Date("2026-07-21T00:00:00Z");

  it("D+180 을 계산한다", () => {
    expect(settlementDate(contract, 180)).toBe("2027-01-17");
  });

  it("D+365 를 계산한다", () => {
    expect(settlementDate(contract, 365)).toBe("2027-07-21");
  });

  it("계약일 당일 시각과 무관하게 날짜만 가산한다(UTC)", () => {
    const late = new Date("2026-07-21T23:59:59Z");
    expect(settlementDate(late, 180)).toBe("2027-01-17");
  });
});

describe("computeSettlement", () => {
  it("수수료 + D+180 + D+365 를 한 번에 산출한다", () => {
    const r = computeSettlement({
      disbursedAmount: 200_000_000,
      feeRate: 0.03,
      contractDate: new Date("2026-07-21T00:00:00Z"),
    });
    expect(r).toEqual({
      commission: 6_000_000,
      settlementDate180: "2027-01-17",
      settlementDate365: "2027-07-21",
    });
  });
});

describe("totalRevenue / grossFromDisbursement", () => {
  const items = [
    { disbursedAmount: 100_000_000, feeRate: 0.03, contractDate: new Date() },
    { disbursedAmount: 50_000_000, feeRate: 0.02, contractDate: new Date() },
  ];

  it("총매출 = 수수료 합", () => {
    expect(totalRevenue(items)).toBe(3_000_000 + 1_000_000);
  });

  it("총매출(집행금액 기준) = 집행금액 합", () => {
    expect(grossFromDisbursement(items)).toBe(150_000_000);
  });

  it("빈 목록은 0", () => {
    expect(totalRevenue([])).toBe(0);
    expect(grossFromDisbursement([])).toBe(0);
  });
});
