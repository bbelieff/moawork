import { describe, expect, it } from "vitest";
import { analyzePhone, formatPhone, isSamePhone, normalizePhone } from "./phone";

describe("phone format contract", () => {
  it.each([
    ["010-1234-5678", "01012345678"],
    ["010 1234 5678", "01012345678"],
    ["(010) 1234.5678", "01012345678"],
    ["+82 10 1234 5678", "01012345678"],
    ["+82 (0)10-1234-5678", "01012345678"],
    ["+1 (415) 555-2671", "14155552671"],
  ])("normalizes %s for storage", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["01012345678", "010-1234-5678"],
    ["0111234567", "011-123-4567"],
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["0311234567", "031-123-4567"],
  ])("formats %s only for display", (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  it("keeps readable international numbers as digits", () => {
    expect(formatPhone("+1 (415) 555-2671")).toBe("14155552671");
  });

  it.each(["12345", "문의는 대표번호", "+82"])(
    "marks unreadable input for review without guessing: %s",
    (input) => {
      expect(analyzePhone(input)).toEqual({ status: "needs_review", normalized: "" });
      expect(normalizePhone(input)).toBe("");
      expect(formatPhone(input)).toBe("확인 필요");
    },
  );

  it("distinguishes an empty value from an unreadable value", () => {
    expect(analyzePhone("  ")).toEqual({ status: "empty", normalized: "" });
  });

  it("recognizes differently entered forms as the same phone", () => {
    expect(isSamePhone("010-1234-5678", "+82 10 1234 5678")).toBe(true);
    expect(isSamePhone("010-1234-5678", "010-9999-5678")).toBe(false);
    expect(isSamePhone("", "")).toBe(false);
  });
});
