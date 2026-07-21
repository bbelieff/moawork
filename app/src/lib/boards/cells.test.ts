import { describe, it, expect } from "vitest";
import {
  normalizeCellValue,
  isEmptyCell,
  validateAgainstOptions,
  compareCells,
  formatCell,
  hasOptions,
} from "./cells";
import type { FieldOption } from "@/lib/types";

const OPTS: FieldOption[] = [
  { id: "o1", label: "대기" },
  { id: "o2", label: "완료" },
];

describe("normalizeCellValue — 13 타입", () => {
  it("checkbox 는 불리언으로 수렴", () => {
    expect(normalizeCellValue("checkbox", true)).toBe(true);
    expect(normalizeCellValue("checkbox", "true")).toBe(true);
    expect(normalizeCellValue("checkbox", null)).toBe(false);
  });
  it("number 는 콤마/통화기호 파싱, 실패는 null", () => {
    expect(normalizeCellValue("number", "1,200,000")).toBe(1200000);
    expect(normalizeCellValue("number", "abc")).toBeNull();
    expect(normalizeCellValue("number", "")).toBeNull();
  });
  it("date 는 YYYY-MM-DD 로 정규화", () => {
    expect(normalizeCellValue("date", "2026-07-21")).toBe("2026-07-21");
    expect(normalizeCellValue("date", "2026-07-21T09:00:00Z")).toBe("2026-07-21");
    expect(normalizeCellValue("date", "nope")).toBeNull();
  });
  it("datetime 은 ISO", () => {
    expect(normalizeCellValue("datetime", "2026-07-21T09:00:00Z")).toBe("2026-07-21T09:00:00.000Z");
  });
  it("multiselect 는 항상 배열", () => {
    expect(normalizeCellValue("multiselect", ["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeCellValue("multiselect", "a")).toEqual(["a"]);
    expect(normalizeCellValue("multiselect", null)).toEqual([]);
  });
  it("문자열 계열은 trim, 빈문자는 null", () => {
    expect(normalizeCellValue("text", "  hi  ")).toBe("hi");
    expect(normalizeCellValue("text", "   ")).toBeNull();
    expect(normalizeCellValue("email", "a@b.com")).toBe("a@b.com");
  });
});

describe("isEmptyCell / hasOptions", () => {
  it("빈값 판정", () => {
    expect(isEmptyCell(null)).toBe(true);
    expect(isEmptyCell("")).toBe(true);
    expect(isEmptyCell([])).toBe(true);
    expect(isEmptyCell(0)).toBe(false);
    expect(isEmptyCell(false)).toBe(false);
  });
  it("선택지 보유 타입", () => {
    expect(hasOptions("select")).toBe(true);
    expect(hasOptions("multiselect")).toBe(true);
    expect(hasOptions("text")).toBe(false);
  });
});

describe("validateAgainstOptions", () => {
  it("select 은 옵션 id 여야 통과", () => {
    expect(validateAgainstOptions("select", "o1", OPTS)).toBe(true);
    expect(validateAgainstOptions("select", "ghost", OPTS)).toBe(false);
    expect(validateAgainstOptions("select", null, OPTS)).toBe(true);
  });
  it("multiselect 은 부분집합이어야 통과", () => {
    expect(validateAgainstOptions("multiselect", ["o1", "o2"], OPTS)).toBe(true);
    expect(validateAgainstOptions("multiselect", ["o1", "x"], OPTS)).toBe(false);
  });
  it("옵션 정의 없으면 통과(느슨한 보드)", () => {
    expect(validateAgainstOptions("select", "anything", null)).toBe(true);
  });
  it("비선택 타입은 항상 통과", () => {
    expect(validateAgainstOptions("text", "free", OPTS)).toBe(true);
  });
});

describe("compareCells — 빈값 뒤로", () => {
  it("숫자 오름차순", () => {
    expect(compareCells(1, 2)).toBeLessThan(0);
  });
  it("빈값은 항상 뒤", () => {
    expect(compareCells(null, 1)).toBeGreaterThan(0);
    expect(compareCells(1, null)).toBeLessThan(0);
    expect(compareCells(null, null)).toBe(0);
  });
});

describe("formatCell", () => {
  it("옵션 id 를 라벨로 치환", () => {
    expect(formatCell("select", "o1", OPTS)).toBe("대기");
    expect(formatCell("multiselect", ["o1", "o2"], OPTS)).toBe("대기, 완료");
  });
  it("checkbox 는 체크 표시", () => {
    expect(formatCell("checkbox", true)).toBe("✓");
    expect(formatCell("checkbox", false)).toBe("");
  });
});
