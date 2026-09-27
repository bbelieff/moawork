import { describe, expect, it } from "vitest";
import {
  foundedMonthToFoundedOn,
  joinCanonicalRegion,
  normalizeCompanyNameForDuplicateCheck,
  parseFoundedMonthInput,
} from "./intake-mapping";

describe("intake-mapping", () => {
  it("이름 정규화는 공백·대소문자만 본다", () => {
    expect(normalizeCompanyNameForDuplicateCheck("  모아  상사 ")).toBe("모아 상사");
    expect(normalizeCompanyNameForDuplicateCheck("MOA")).toBe("moa");
  });

  it("창업연월은 YYYY-MM만 받고 저장값은 그 달 1일이다", () => {
    expect(parseFoundedMonthInput("")).toBe(null);
    expect(parseFoundedMonthInput("2024-03")).toBe("2024-03");
    expect(foundedMonthToFoundedOn("2024-03")).toBe("2024-03-01");
    expect(foundedMonthToFoundedOn("")).toBe(null);
    expect(() => parseFoundedMonthInput("2024-13")).toThrow();
    expect(() => parseFoundedMonthInput("2024-03-01")).toThrow();
    expect(() => parseFoundedMonthInput("24-03")).toThrow();
  });

  it("시도+시군구는 단일 카탈로그 값으로 합친다", () => {
    expect(joinCanonicalRegion("", "")).toBe(null);
    expect(joinCanonicalRegion("서울", "강남구")).toBe("서울_강남구");
    // 시도값(강원)과 카탈로그 접두사(강원도_)가 달라도 맞춘다.
    expect(joinCanonicalRegion("강원", "강릉시")).toBe("강원도_강릉시");
  });

  it("목록에 없는 지역은 지어내지 않고 거절한다", () => {
    expect(() => joinCanonicalRegion("없는도", "강남구")).toThrow();
    expect(() => joinCanonicalRegion("서울", "없는구")).toThrow();
    expect(() => joinCanonicalRegion("서울", "")).toThrow();
  });
});
