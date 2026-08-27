import { describe, it, expect } from "vitest";
import { EMPTY, formatCount, formatKrw, formatMonth, formatPercent, orEmpty } from "./format";

describe("formatKrw", () => {
  it("천단위 콤마 + 원", () => {
    expect(formatKrw(1_234_567)).toBe("1,234,567원");
    expect(formatKrw(0)).toBe("0원");
  });

  it("소수는 반올림한다", () => {
    expect(formatKrw(1000.6)).toBe("1,001원");
  });

  it("null·NaN·무한대는 '—'", () => {
    expect(formatKrw(null)).toBe(EMPTY);
    expect(formatKrw(undefined)).toBe(EMPTY);
    expect(formatKrw(Number.NaN)).toBe(EMPTY);
    expect(formatKrw(Number.POSITIVE_INFINITY)).toBe(EMPTY);
  });
});

describe("formatCount", () => {
  it("건수를 콤마로", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12_345)).toBe("12,345");
  });
  it("비유한은 '—'", () => {
    expect(formatCount(Number.NaN)).toBe(EMPTY);
    expect(formatCount(null)).toBe(EMPTY);
  });
  it("수량이 아닌 음수·소수는 typed 계약에 따라 '—'", () => {
    expect(formatCount(-1)).toBe(EMPTY);
    expect(formatCount(1.5)).toBe(EMPTY);
  });
});

describe("formatPercent", () => {
  it("0~1 비율을 퍼센트로", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("0 은 '0.0%' (NaN 금지)", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("자릿수를 지정할 수 있다", () => {
    expect(formatPercent(0.1234, 2)).toBe("12.34%");
    expect(formatPercent(0.5, 0)).toBe("50%");
  });

  it("비유한은 '—'", () => {
    expect(formatPercent(Number.NaN)).toBe(EMPTY);
    expect(formatPercent(null)).toBe(EMPTY);
  });
  it("0~1 밖 값은 ratio가 아니므로 '—'", () => {
    expect(formatPercent(-0.1)).toBe(EMPTY);
    expect(formatPercent(1.01)).toBe(EMPTY);
  });
});

describe("orEmpty", () => {
  it("available=false 면 '—'", () => {
    expect(orEmpty(false, 100, formatKrw)).toBe(EMPTY);
  });
  it("available=true 면 포맷 결과", () => {
    expect(orEmpty(true, 100, formatKrw)).toBe("100원");
  });
});

describe("formatMonth", () => {
  it("YYYY-MM 을 한글 월로", () => {
    expect(formatMonth("2026-07")).toBe("2026년 7월");
    expect(formatMonth("2026-12")).toBe("2026년 12월");
  });
  it("형식이 아니면 원문", () => {
    expect(formatMonth("2026/07")).toBe("2026/07");
  });
});
