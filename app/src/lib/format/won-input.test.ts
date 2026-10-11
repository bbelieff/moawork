import { describe, expect, it } from "vitest";
import { parseWonInput } from "./won-input";

describe("금액 입력 읽기 (QA #885)", () => {
  it("숫자·쉼표·«원» 을 읽는다", () => {
    expect(parseWonInput("5,000,000")).toBe(5_000_000);
    expect(parseWonInput("5000000원")).toBe(5_000_000);
    expect(parseWonInput(" 5 000 000 원 ")).toBe(5_000_000);
    expect(parseWonInput("0")).toBe(0);
  });

  it("한국식 단위를 읽는다", () => {
    expect(parseWonInput("1억")).toBe(100_000_000);
    expect(parseWonInput("1억 5천만")).toBe(150_000_000);
    expect(parseWonInput("3,000만원")).toBe(30_000_000);
    expect(parseWonInput("1.5억")).toBe(150_000_000);
    expect(parseWonInput("2억300")).toBe(200_000_300);
  });

  it("음수·글자·빈칸은 읽지 않는다", () => {
    expect(parseWonInput("-5000")).toBeNull();
    expect(parseWonInput("오천만")).toBeNull();
    expect(parseWonInput("5천만달러")).toBeNull();
    expect(parseWonInput("")).toBeNull();
    expect(parseWonInput("원")).toBeNull();
  });
});
