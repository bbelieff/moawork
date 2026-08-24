import { describe, expect, it } from "vitest";
import {
  FIELD_SOURCES,
  getFieldSourceSpec,
  isFieldSource,
  isSourceEditable,
  sourceRequiresConfirm,
} from "./source";

describe("field/source — 출처 6종 완전성(D09 미정의 0)", () => {
  it("6종 전부 스펙이 있다", () => {
    expect(FIELD_SOURCES).toHaveLength(6);
    for (const s of FIELD_SOURCES) {
      const spec = getFieldSourceSpec(s);
      expect(spec.mark.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("수집 출처도 직접 정정할 수 있고 계산·연결 출처만 잠긴다", () => {
    expect(isSourceEditable("auto")).toBe(true);
    expect(isSourceEditable("lk")).toBe(false);
    expect(isSourceEditable("calc")).toBe(false);
    expect(isSourceEditable("in")).toBe(true);
    expect(isSourceEditable("act")).toBe(true);
    expect(isSourceEditable("msg")).toBe(true);
  });

  it("발송(msg)만 확인 창이 필요하다", () => {
    for (const s of FIELD_SOURCES) {
      expect(sourceRequiresConfirm(s)).toBe(s === "msg");
    }
  });

  it("isFieldSource — 유효/무효 판정", () => {
    expect(isFieldSource("lk")).toBe(true);
    expect(isFieldSource("nope")).toBe(false);
    expect(isFieldSource(123)).toBe(false);
  });
});
