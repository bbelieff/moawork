import { describe, expect, it } from "vitest";
import { resolveNewLeadBusinessType } from "./business-types";
import { resolveNewLeadRevenueBand } from "./revenue-bands";
import { canonicalSido, canonicalSigungu, searchSido, searchSigungu } from "./region-search";

describe("issue 558 신규리드 입력 선택 계약", () => {
  it("supports the two standard business types and a required custom type", () => {
    expect(resolveNewLeadBusinessType("개인사업자", "")).toBe("개인사업자");
    expect(resolveNewLeadBusinessType("법인사업자", "")).toBe("법인사업자");
    expect(resolveNewLeadBusinessType("그외", " 비영리법인 ")).toBe("비영리법인");
    expect(resolveNewLeadBusinessType("그외", " ")).toBeNull();
  });

  it("keeps observed Monday revenue bands and allows a custom band", () => {
    expect(resolveNewLeadRevenueBand("2,000만원~4,000만원", "")).toBe("2,000만원~4,000만원");
    expect(resolveNewLeadRevenueBand("그외", " 1억원 이상 ")).toBe("1억원 이상");
  });

  it("finds 시도 and 시군구 by Korean initials and stores canonical values", () => {
    expect(searchSido("ㅅㅇ")[0]).toEqual({ value: "서울", label: "서울시" });
    expect(searchSido("ㅈㅈ")).toContainEqual({ value: "제주", label: "제주도" });
    expect(canonicalSido("서울시")).toBe("서울");
    expect(searchSigungu("서울", "ㄱㄴ")).toContainEqual({ value: "강남구", label: "강남구" });
    expect(canonicalSigungu("서울", "강남구")).toBe("강남구");
    expect(canonicalSigungu("부산", "강남구")).toBeNull();
  });
});
