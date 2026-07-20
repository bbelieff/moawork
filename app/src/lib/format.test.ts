import { describe, it, expect } from "vitest";
import { toDateString } from "./format";

describe("toDateString", () => {
  it("날짜를 YYYY-MM-DD 로 포맷한다", () => {
    expect(toDateString(new Date("2026-07-21T12:34:56Z"))).toBe("2026-07-21");
  });
});
