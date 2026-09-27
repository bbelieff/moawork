import { describe, expect, it } from "vitest";
import { resolveNewLeadBusinessSubtype, resolveNewLeadBusinessType } from "./business-types";
import { resolveNewLeadRevenueBand } from "./revenue-bands";
import { canonicalSido, canonicalSigungu, searchSido, searchSigungu } from "./region-search";

describe("issue 558 신규리드 입력 선택 계약", () => {
  it("supports the two standard business types and a required custom type", () => {
    expect(resolveNewLeadBusinessType("개인사업자", "")).toBe("개인사업자");
    expect(resolveNewLeadBusinessType("법인사업자", "")).toBe("법인사업자");
    expect(resolveNewLeadBusinessType("그외", " 비영리법인 ")).toBe("비영리법인");
    expect(resolveNewLeadBusinessType("그외", " ")).toBe("그외");
    expect(resolveNewLeadBusinessType(" 비영리법인 ", "")).toBe("비영리법인");
    expect(resolveNewLeadBusinessType("", "")).toBeNull();
  });

  it("resolves approved tax/form subtypes additively without rewriting stored values", () => {
    // 개인: 기본 일반은 저장값 그대로, 간이·면세는 한 번 더 눌러 접미사로.
    expect(resolveNewLeadBusinessSubtype("개인사업자", "", "")).toBe("개인사업자");
    expect(resolveNewLeadBusinessSubtype("개인사업자", "일반", "")).toBe("개인사업자");
    expect(resolveNewLeadBusinessSubtype("개인사업자", "간이", "")).toBe("개인사업자(간이)");
    expect(resolveNewLeadBusinessSubtype("개인사업자", "면세", "")).toBe("개인사업자(면세)");
    // 법인: 기본 일반은 저장값 그대로. 유한은 과세유형이 아니라 법인 형태 표기다.
    expect(resolveNewLeadBusinessSubtype("법인사업자", "", "")).toBe("법인사업자");
    expect(resolveNewLeadBusinessSubtype("법인사업자", "면세", "")).toBe("법인사업자(면세)");
    expect(resolveNewLeadBusinessSubtype("법인사업자", "유한", "")).toBe("법인사업자(유한)");
    // ★ 유한을 일반·면세로 임의 환원하지 않는다 — 과세유형 미확정으로 읽는다.
    expect(resolveNewLeadBusinessSubtype("법인사업자(유한)", "", "")).toBe("법인사업자(유한)");
    // 그외·빈값·과거 저장값은 종전 계약 그대로.
    expect(resolveNewLeadBusinessSubtype("그외", "", " 협동조합 ")).toBe("협동조합");
    expect(resolveNewLeadBusinessSubtype("", "일반", "")).toBeNull();
    expect(resolveNewLeadBusinessType("개인사업자(간이)", "")).toBe("개인사업자(간이)");
    expect(resolveNewLeadBusinessType("법인사업자(유한)", "")).toBe("법인사업자(유한)");
  });

  it("accepts the requested ranges, exact amounts and legacy form submissions", () => {
    for (const band of ["~ 1억 미만", "1억 이상 ~ 3억 미만", "3억 이상 ~ 10억 미만", "10억 이상 ~"]) {
      expect(resolveNewLeadRevenueBand(band, "")).toBe(band);
    }
    expect(resolveNewLeadRevenueBand("그외", " 2억 5,000만원 ")).toBe("2억 5,000만원");
    expect(resolveNewLeadRevenueBand("그외", " ")).toBeNull();
    expect(resolveNewLeadRevenueBand("알 수 없는 값", "")).toBeNull();
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
