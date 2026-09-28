import { describe, expect, it } from "vitest";
import {
  findBizNoCandidates,
  formatBizNo,
  isValidBizNo,
  normalizeBizNo,
} from "./bizno";

// 합성 픽스처: 123-45-67891 (순차 숫자로 계산된 체크섬 1 — 실제 번호 아님).
const VALID = "123-45-67891";
const INVALID_CHECK = "123-45-67890";

describe("bizno", () => {
  it("normalizeBizNo는 구분자를 걷어낸다", () => {
    expect(normalizeBizNo("123-45-67891")).toBe("1234567891");
    expect(normalizeBizNo(" 123 45 67891 ")).toBe("1234567891");
  });

  it("formatBizNo는 3-2-5로 찍는다", () => {
    expect(formatBizNo("1234567891")).toBe(VALID);
    expect(formatBizNo("짧음")).toBe("짧음");
  });

  it("체크섬이 맞는 합성 번호를 통과시킨다", () => {
    expect(isValidBizNo(VALID)).toBe(true);
    expect(isValidBizNo("1234567891")).toBe(true);
  });

  it("체크섬이 틀리면 거부한다", () => {
    expect(isValidBizNo(INVALID_CHECK)).toBe(false);
  });

  it("자리수 미달·문자·자리채움을 거부한다", () => {
    expect(isValidBizNo("123-45-6789")).toBe(false);
    expect(isValidBizNo("")).toBe(false);
    expect(isValidBizNo("000-00-00000")).toBe(false);
    expect(isValidBizNo("111-11-11111")).toBe(false);
  });

  it("후보를 대시형·연속형 모두 순서대로 찾고 중복을 걷는다", () => {
    const found = findBizNoCandidates(`등록번호 ${VALID} / 1234567891`);
    expect(found).toEqual([VALID]);
  });
});
