import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/crm/validation";
import { parsePeriod, parseRebuild, parseSort } from "./input";

describe("parsePeriod", () => {
  it("YYYY-MM 을 통과시킨다", () => {
    expect(parsePeriod("2026-07")).toBe("2026-07");
    expect(parsePeriod("2026-01")).toBe("2026-01");
    expect(parsePeriod("2026-12")).toBe("2026-12");
  });

  it("빈 값은 undefined (호출부가 기본월 결정)", () => {
    expect(parsePeriod(undefined)).toBeUndefined();
    expect(parsePeriod(null)).toBeUndefined();
    expect(parsePeriod("")).toBeUndefined();
  });

  it("13월·0월은 거부한다 — 통과시키면 조용히 다른 달을 재계산한다", () => {
    expect(() => parsePeriod("2026-13")).toThrow(ValidationError);
    expect(() => parsePeriod("2026-00")).toThrow(ValidationError);
  });

  it("형식이 다르면 거부한다", () => {
    for (const bad of ["2026/07", "26-07", "2026-7", "2026-07-01", 202607]) {
      expect(() => parsePeriod(bad)).toThrow(ValidationError);
    }
  });
});

describe("parseSort", () => {
  it("허용된 값만 통과", () => {
    expect(parseSort("fee")).toBe("fee");
    expect(parseSort("exec")).toBe("exec");
    expect(parseSort("deals")).toBe("deals");
    expect(parseSort(null)).toBeUndefined();
  });

  it("모르는 값은 거부", () => {
    expect(() => parseSort("incentive")).toThrow(ValidationError);
  });
});

describe("parseRebuild", () => {
  it("본문 없음은 빈 입력(현재월)", () => {
    expect(parseRebuild(null)).toEqual({ period: undefined });
    expect(parseRebuild(undefined)).toEqual({ period: undefined });
  });

  it("period 를 검증해 통과시킨다", () => {
    expect(parseRebuild({ period: "2026-07" })).toEqual({ period: "2026-07" });
  });

  it("잘못된 period 는 거부", () => {
    expect(() => parseRebuild({ period: "2026-99" })).toThrow(ValidationError);
  });

  it("객체가 아니면 거부", () => {
    expect(() => parseRebuild("2026-07")).toThrow(ValidationError);
  });
});
