import { describe, it, expect } from "vitest";
import {
  VAT_RATE,
  INPUT_KEYS,
  toNumber,
  toDateOnly,
  addDays,
  round2,
  evaluateFormula,
  evaluateFormulas,
} from "./formulas";

describe("toNumber", () => {
  it("숫자/숫자문자열/콤마·통화기호를 파싱한다", () => {
    expect(toNumber(1000)).toBe(1000);
    expect(toNumber("1000")).toBe(1000);
    expect(toNumber("1,000,000")).toBe(1000000);
    expect(toNumber("₩ 50,000")).toBe(50000);
  });
  it("빈값/비수치/무한대는 null", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
});

describe("toDateOnly / addDays", () => {
  it("날짜 문자열을 YYYY-MM-DD 로 정규화", () => {
    expect(toDateOnly("2026-07-21")).toBe("2026-07-21");
    expect(toDateOnly("2026-07-21T09:00:00Z")).toBe("2026-07-21");
  });
  it("유효하지 않으면 null", () => {
    expect(toDateOnly("")).toBeNull();
    expect(toDateOnly("not-a-date")).toBeNull();
    expect(toDateOnly(123 as unknown as string)).toBeNull();
  });
  it("addDays 는 UTC 기준으로 정확히 더한다(월경계 포함)", () => {
    expect(addDays("2026-07-21", 180)).toBe("2027-01-17");
    expect(addDays("2026-07-21", 365)).toBe("2027-07-21");
    expect(addDays("2026-01-01", 1)).toBe("2026-01-02");
    expect(addDays(null, 180)).toBeNull();
  });
});

describe("round2", () => {
  it("통화 2자리 반올림", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(100.004)).toBe(100);
  });
});

describe("evaluateFormula — 수수료/총매출", () => {
  const values = {
    [INPUT_KEYS.contractAmount]: 100_000_000,
    [INPUT_KEYS.commissionRate]: 3, // 3%
  };

  it("수수료 = 계약금액 × 수수료율 / 100", () => {
    expect(evaluateFormula("commission", values)).toBe(3_000_000);
  });

  it("총매출 = 수수료 × (1 + 부가세율)", () => {
    expect(evaluateFormula("total_revenue", values)).toBe(
      round2(3_000_000 * (1 + VAT_RATE)),
    );
    expect(evaluateFormula("total_revenue", values)).toBe(3_300_000);
  });

  it("입력 누락 시 null", () => {
    expect(evaluateFormula("commission", {})).toBeNull();
    expect(
      evaluateFormula("commission", { [INPUT_KEYS.contractAmount]: 100 }),
    ).toBeNull();
  });
});

describe("evaluateFormula — D+180 / D+365", () => {
  const values = { [INPUT_KEYS.contractDate]: "2026-07-21" };

  it("D+180", () => {
    expect(evaluateFormula("d_plus_180", values)).toBe("2027-01-17");
  });
  it("D+365", () => {
    expect(evaluateFormula("d_plus_365", values)).toBe("2027-07-21");
  });
  it("계약일 없으면 null", () => {
    expect(evaluateFormula("d_plus_180", {})).toBeNull();
  });
});

describe("evaluateFormulas — 컬럼 정의 순회", () => {
  it("formula 컬럼만 계산하고 나머지는 무시", () => {
    const columns = [
      { key: "고객명", type: "text", settings: {} },
      { key: "수수료", type: "formula", settings: { formulaKey: "commission" as const } },
      { key: "총매출", type: "formula", settings: { formulaKey: "total_revenue" as const } },
      { key: "사후180", type: "formula", settings: { formulaKey: "d_plus_180" as const } },
      { key: "빈수식", type: "formula", settings: {} }, // formulaKey 없음 → skip
    ];
    const result = evaluateFormulas(columns, {
      [INPUT_KEYS.contractAmount]: 50_000_000,
      [INPUT_KEYS.commissionRate]: 4,
      [INPUT_KEYS.contractDate]: "2026-07-21",
    });
    expect(result).toEqual({
      수수료: 2_000_000,
      총매출: round2(2_000_000 * (1 + VAT_RATE)),
      사후180: "2027-01-17",
    });
    expect(result["고객명"]).toBeUndefined();
    expect(result["빈수식"]).toBeUndefined();
  });
});
