import { describe, expect, it } from "vitest";
import { chosung, matchesQuery } from "./chosung";

describe("chosung (BBE-125)", () => {
  it("완성형 한글을 초성으로 축약한다", () => {
    expect(chosung("우진산업")).toBe("ㅇㅈㅅㅇ");
    expect(chosung("대한정밀")).toBe("ㄷㅎㅈㅁ");
  });

  it("한글이 아닌 문자는 그대로 통과시킨다", () => {
    expect(chosung("㈜대한정밀")).toBe("㈜ㄷㅎㅈㅁ");
    expect(chosung("ABC123")).toBe("ABC123");
  });
});

describe("matchesQuery (BBE-125)", () => {
  it("빈 검색어는 전부 통과한다", () => {
    expect(matchesQuery("우진산업㈜", "")).toBe(true);
    expect(matchesQuery("우진산업㈜", "   ")).toBe(true);
  });

  it("부분 문자열이 일치하면 통과한다", () => {
    expect(matchesQuery("우진산업㈜", "우진")).toBe(true);
    expect(matchesQuery("㈜대한정밀", "대한정밀")).toBe(true);
  });

  it("초성만으로도 찾아진다 — 카드 수용 기준의 ㄷㅎㅈㅁ 예시", () => {
    expect(matchesQuery("대한정밀", "ㄷㅎㅈㅁ")).toBe(true);
    expect(matchesQuery("우진산업㈜", "ㅇㅈㅅㅇ")).toBe(true);
  });

  it("일치하지 않으면 거부한다", () => {
    expect(matchesQuery("우진산업㈜", "새봄푸드")).toBe(false);
    expect(matchesQuery("우진산업㈜", "ㅅㅂㅍㄷ")).toBe(false);
  });
});
