import { describe, expect, it } from "vitest";
import { groupDigitsForInput } from "./GroupTable";

describe("숫자 칸 천단위 콤마 (2026-10-17 belie)", () => {
  it("정수부를 3자리마다 끊고 소수·음수를 지킨다", () => {
    expect(groupDigitsForInput("111111111")).toBe("111,111,111");
    expect(groupDigitsForInput("1,2345")).toBe("12,345");
    expect(groupDigitsForInput("-1234567.5")).toBe("-1,234,567.5");
    expect(groupDigitsForInput("0012")).toBe("12");
    expect(groupDigitsForInput("")).toBe("");
  });
});
