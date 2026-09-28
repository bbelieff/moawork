import { describe, expect, it } from "vitest";
import { suggestBizRegTypeValue } from "./taxation";

describe("suggestBizRegTypeValue", () => {
  it("개인 + 일반과세자 → 개인사업자 (대체 아님)", () => {
    expect(suggestBizRegTypeValue("개인사업자", "일반과세자")).toEqual({
      supported: true,
      value: "개인사업자",
    });
  });

  it("개인 + 간이과세자 → 개인사업자(간이)", () => {
    expect(suggestBizRegTypeValue("개인사업자", "간이과세자")).toEqual({
      supported: true,
      value: "개인사업자(간이)",
    });
  });

  it("개인 + 면세사업자 → 개인사업자(면세)", () => {
    expect(suggestBizRegTypeValue("개인사업자", "면세사업자")).toEqual({
      supported: true,
      value: "개인사업자(면세)",
    });
  });

  it("회귀: 법인 + 일반과세자 → 법인사업자 (법인 정체성 유지)", () => {
    const result = suggestBizRegTypeValue("법인사업자", "일반과세자");
    expect(result).toEqual({ supported: true, value: "법인사업자" });
    if (result.supported) {
      expect(result.value).toContain("법인사업자");
      expect(result.value).not.toBe("일반과세자");
    }
  });

  it("법인 + 면세사업자 → 법인사업자(면세)", () => {
    expect(suggestBizRegTypeValue("법인사업자", "면세사업자")).toEqual({
      supported: true,
      value: "법인사업자(면세)",
    });
  });

  it("base 모호(빈값·그외·중복) → 자동선택 해제 + 사유", () => {
    for (const current of ["", "그외", "개인사업자/법인사업자", "자영업"]) {
      const result = suggestBizRegTypeValue(current, "일반과세자");
      expect(result.supported).toBe(false);
      if (!result.supported) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("법인사업자(유한) + 일반과세자 → 임의 환원 금지", () => {
    const result = suggestBizRegTypeValue("법인사업자(유한)", "일반과세자");
    expect(result.supported).toBe(false);
  });

  it("기존 하위구분과 OCR 과세가 다르면 덮지 않음", () => {
    const result = suggestBizRegTypeValue("개인사업자(간이)", "면세사업자");
    expect(result.supported).toBe(false);
  });

  it("같은 하위구분이면 현재값 그대로 (no-op 제안)", () => {
    expect(suggestBizRegTypeValue("개인사업자(간이)", "간이과세자")).toEqual({
      supported: true,
      value: "개인사업자(간이)",
    });
  });

  it("알 수 없는 과세 표기 → 미지원", () => {
    const result = suggestBizRegTypeValue("개인사업자", "특수과세자");
    expect(result.supported).toBe(false);
  });
});
