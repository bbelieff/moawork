import { describe, expect, it } from "vitest";
import {
  canonicalNumberString,
  formatDecimal,
  formatKrw,
  formatMillionKrw,
  formatNumericDisplay,
  formatOrdinal,
  formatPercentPoints,
  formatQuantity,
  formatRatio,
  normalizeNumericSearchText,
  numericSearchIncludes,
  parseNumericInput,
  validateNumericValue,
} from "./number";

describe("typed numeric display", () => {
  it("quantity와 decimal을 명시적으로 구분한다", () => {
    expect(formatQuantity(12_345, { suffix: "건" })).toBe("12,345건");
    expect(formatDecimal(-12_345.67)).toBe("-12,345.67");
    expect(() => formatQuantity(1.5)).toThrow("quantity must be an integer");
    expect(() => formatQuantity(-1)).toThrow("quantity must not be negative");
  });

  it("기본 decimal 표시는 허용된 비영 값을 0으로 축약하지 않는다", () => {
    expect(formatDecimal(1e-21)).toBe("0.000000000000000000001");
    expect(formatDecimal(-1e-21)).toBe("-0.000000000000000000001");
    expect(formatDecimal(1e-20)).toBe("0.00000000000000000001");
    expect(formatDecimal(0)).toBe("0");
    expect(formatDecimal(-0)).toBe("-0");
    expect(formatDecimal(1_234.5)).toBe("1,234.5");
    expect(formatDecimal(1e-21, { maximumFractionDigits: 2 })).toBe("0");
  });

  it("ratio와 percentPoints를 혼용하지 않는다", () => {
    expect(formatRatio(0.1234, { fractionDigits: 2 })).toBe("12.34%");
    expect(formatPercentPoints(12.34, { fractionDigits: 2 })).toBe("12.34%");
    expect(() => formatRatio(12.34)).toThrow("ratio must be between 0 and 1");
    expect(() => formatPercentPoints(-1)).toThrow("percent points must be between 0 and 100");
  });

  it("원과 백만원은 저장 단위 변경 없이 표시하고 원 소수 정책을 명시한다", () => {
    expect(formatKrw(1_234_567)).toBe("1,234,567원");
    expect(formatKrw(-1_234)).toBe("-1,234원");
    expect(() => formatKrw(1_000.6)).toThrow("rounding is explicit");
    expect(formatKrw(1_000.6, { rounding: "round" })).toBe("1,001원");
    expect(formatMillionKrw(12_345_678)).toBe("12.3백만원");
  });

  it("ordinal은 양의 정수만 받는다", () => {
    expect(formatOrdinal(1_234)).toBe("1,234위");
    expect(() => formatOrdinal(0)).toThrow("positive integer");
  });

  it("discriminated API가 모든 숫자 의미를 노출한다", () => {
    expect(formatNumericDisplay(1_234, { kind: "quantity" })).toBe("1,234");
    expect(formatNumericDisplay(1_234.5, { kind: "decimal" })).toBe("1,234.5");
    expect(formatNumericDisplay(0.5, { kind: "ratio", fractionDigits: 0 })).toBe("50%");
    expect(formatNumericDisplay(5, { kind: "percentPoints" })).toBe("5%");
    expect(formatNumericDisplay(1_234, { kind: "krw" })).toBe("1,234원");
    expect(formatNumericDisplay(1_000_000, { kind: "millionKrw" })).toBe("1백만원");
    expect(formatNumericDisplay(3, { kind: "ordinal" })).toBe("3위");
  });

  it("formatter는 number-only이고 NaN/Infinity를 거부한다", () => {
    expect(() => formatDecimal(Number.NaN)).toThrow("finite number");
    expect(() => formatDecimal(Number.POSITIVE_INFINITY)).toThrow("finite number");
    // @ts-expect-error 식별 문자열·날짜·전화·version은 숫자 포맷터 입력이 아니다.
    expect(() => formatDecimal("001234")).toThrow("finite number");
  });
});

describe("canonical numeric input", () => {
  it("빈값은 null, 0/음수/소수/올바른 쉼표는 canonical number로 파싱한다", () => {
    expect(parseNumericInput("  ")).toEqual({ ok: true, value: null });
    expect(parseNumericInput("0")).toEqual({ ok: true, value: 0 });
    expect(parseNumericInput("-1,234.5")).toEqual({ ok: true, value: -1234.5 });
    expect(canonicalNumberString(-1234.5)).toBe("-1234.5");
  });

  it("불완전한 쉼표·단위·지수·식별 문자열은 추측하지 않는다", () => {
    expect(parseNumericInput("1,23").ok).toBe(false);
    expect(parseNumericInput("1,234원").ok).toBe(false);
    expect(parseNumericInput("1e3").ok).toBe(false);
    expect(parseNumericInput("001234").ok).toBe(false);
  });

  it("컬럼별 음수·소수·범위 제약과 비유한수를 명시한다", () => {
    expect(parseNumericInput("-1", { allowNegative: false })).toEqual({
      ok: false,
      value: null,
      error: "negative_not_allowed",
    });
    expect(parseNumericInput("1.5", { allowDecimal: false })).toEqual({
      ok: false,
      value: null,
      error: "decimal_not_allowed",
    });
    expect(validateNumericValue(Number.NaN)).toEqual({
      ok: false,
      value: null,
      error: "not_finite",
    });
    expect(validateNumericValue(11, { max: 10 })).toEqual({
      ok: false,
      value: null,
      error: "above_max",
    });
  });

  it("정수 입력은 Number 안전 범위와 원문 왕복을 보장한다", () => {
    const integerRules = { allowDecimal: false };
    expect(parseNumericInput("9007199254740991", integerRules)).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
    expect(parseNumericInput("-9,007,199,254,740,991", integerRules)).toEqual({
      ok: true,
      value: -Number.MAX_SAFE_INTEGER,
    });
    expect(parseNumericInput("9,007,199,254,740,992", integerRules)).toEqual({
      ok: false,
      value: null,
      error: "unsafe_integer",
    });
    expect(parseNumericInput("-9007199254740992", integerRules)).toEqual({
      ok: false,
      value: null,
      error: "unsafe_integer",
    });
    expect(parseNumericInput("9".repeat(400), integerRules)).toEqual({
      ok: false,
      value: null,
      error: "unsafe_integer",
    });
    expect(validateNumericValue(9_007_199_254_740_992, integerRules)).toEqual({
      ok: false,
      value: null,
      error: "unsafe_integer",
    });
  });

  it("0이 아닌 소수의 underflow를 거부하고 canonical 지수값은 십진 문자열로 왕복한다", () => {
    const tinyInput = `0.${"0".repeat(400)}1`;
    expect(parseNumericInput(tinyInput)).toEqual({
      ok: false,
      value: null,
      error: "underflow",
    });

    for (const value of [1e21, 1e-7]) {
      const canonical = canonicalNumberString(value);
      expect(canonical).not.toMatch(/e/i);
      expect(parseNumericInput(canonical)).toEqual({ ok: true, value });
    }
    expect(canonicalNumberString(1e21)).toBe("1000000000000000000000");
    expect(canonicalNumberString(1e-7)).toBe("0.0000001");
  });

  it("decimal 원문이 Number 왕복 중 달라지면 precision loss로 거부한다", () => {
    for (const raw of [
      "9007199254740993.0",
      "9007199254740991.5",
      "0.1234567890123456789",
    ]) {
      expect(parseNumericInput(raw, { allowDecimal: true })).toEqual({
        ok: false,
        value: null,
        error: "precision_loss",
      });
    }

    expect(parseNumericInput("9007199254740991.0", { allowDecimal: true })).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
    expect(parseNumericInput("0.1", { allowDecimal: true })).toEqual({ ok: true, value: 0.1 });
    expect(parseNumericInput("1.2300", { allowDecimal: true })).toEqual({ ok: true, value: 1.23 });
    expect(parseNumericInput("-0.000", { allowDecimal: true })).toEqual({ ok: true, value: -0 });
    expect(parseNumericInput("9007199254740991.5", { allowDecimal: false })).toEqual({
      ok: false,
      value: null,
      error: "decimal_not_allowed",
    });
  });
});

describe("numeric search normalization", () => {
  it("1234와 1,234를 동등하게 검색한다", () => {
    expect(normalizeNumericSearchText("매출 1,234원")).toBe("매출 1234원");
    expect(numericSearchIncludes("매출 1,234원", "1234")).toBe(true);
    expect(numericSearchIncludes("매출 1234원", "1,234")).toBe(true);
  });

  it("잘못된 쉼표와 식별 문자열은 임의 재작성하지 않는다", () => {
    expect(normalizeNumericSearchText("ID 001,23")).toBe("id 001,23");
    expect(normalizeNumericSearchText("ID 001,234")).toBe("id 001,234");
  });
});
