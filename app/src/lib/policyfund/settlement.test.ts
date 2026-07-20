import { describe, it, expect } from "vitest";
import {
  feeAmount,
  totalRevenue,
  dPlus,
  computeSettlement,
  sumTotalRevenue,
} from "./settlement";

describe("feeAmount = round(실행액 × 수수료% / 100)", () => {
  it("정수 퍼센트로 수수료를 계산한다(3 = 3%)", () => {
    expect(feeAmount(100_000_000, 3)).toBe(3_000_000);
  });

  it("원 단위 반올림", () => {
    expect(feeAmount(1_000_050, 3)).toBe(30_002); // 30001.5 → 30002
    expect(feeAmount(333, 5)).toBe(17); // 16.65 → 17
  });

  it("실행액/수수료 0 이면 0", () => {
    expect(feeAmount(0, 3)).toBe(0);
    expect(feeAmount(100_000_000, 0)).toBe(0);
  });
});

describe("totalRevenue = 계약금 + 수수료(원)", () => {
  it("계약금과 수수료를 더한다", () => {
    expect(totalRevenue(500_000, 3_000_000)).toBe(3_500_000);
  });
});

describe("dPlus = 수수료입금일 + n일", () => {
  const deposit = new Date("2026-07-21T00:00:00Z");

  it("D+180", () => {
    expect(dPlus(deposit, 180)).toBe("2027-01-17");
  });

  it("D+365", () => {
    expect(dPlus(deposit, 365)).toBe("2027-07-21");
  });

  it("입금일 미정(null)이면 null", () => {
    expect(dPlus(null, 180)).toBeNull();
    expect(dPlus(null, 365)).toBeNull();
  });

  it("입금일 시각과 무관하게 날짜만 가산(UTC)", () => {
    expect(dPlus(new Date("2026-07-21T23:59:59Z"), 180)).toBe("2027-01-17");
  });
});

describe("computeSettlement", () => {
  it("수수료·총매출·D+180·D+365 를 한 번에 산출한다", () => {
    const r = computeSettlement({
      disbursedAmount: 100_000_000,
      feePercent: 3,
      downPayment: 500_000,
      feeDepositDate: new Date("2026-07-21T00:00:00Z"),
    });
    expect(r).toEqual({
      feeAmount: 3_000_000,
      totalRevenue: 3_500_000, // 계약금 500,000 + 수수료 3,000,000
      dPlus180: "2027-01-17",
      dPlus365: "2027-07-21",
    });
  });

  it("수수료 미입금이면 D+n 은 null, 금액은 계산된다", () => {
    const r = computeSettlement({
      disbursedAmount: 50_000_000,
      feePercent: 2,
      downPayment: 0,
      feeDepositDate: null,
    });
    expect(r.feeAmount).toBe(1_000_000);
    expect(r.totalRevenue).toBe(1_000_000);
    expect(r.dPlus180).toBeNull();
    expect(r.dPlus365).toBeNull();
  });
});

describe("sumTotalRevenue", () => {
  it("여러 건의 총매출을 합산한다", () => {
    const items = [
      {
        disbursedAmount: 100_000_000,
        feePercent: 3,
        downPayment: 500_000,
        feeDepositDate: null,
      },
      {
        disbursedAmount: 50_000_000,
        feePercent: 2,
        downPayment: 0,
        feeDepositDate: null,
      },
    ];
    // (500,000+3,000,000) + (0+1,000,000)
    expect(sumTotalRevenue(items)).toBe(4_500_000);
  });

  it("빈 목록은 0", () => {
    expect(sumTotalRevenue([])).toBe(0);
  });
});
