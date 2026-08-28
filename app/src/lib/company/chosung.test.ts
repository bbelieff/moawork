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

/**
 * ★ 판정이 «한 벌» 인지 잰다 (#588 ⑤).
 *
 *   전에는 이 파일과 lib/companies/search.ts 에 각각 구현이 있었고,
 *   둘 다 같은 결함(질의까지 초성으로 낮춤)을 갖고 있었다.
 *   ⑤ 를 한쪽에서만 고치면 «화면마다 검색 결과가 달라진다» —
 *   업체 추가에서는 안 나오는데 리드컨택에서는 나온다.
 */
describe("두 화면이 같은 답을 낸다", () => {
  it("★ 「대성」이 「다스산업」을 잡지 않는다 — 리드컨택 쪽도 마찬가지다", () => {
    expect(matchesQuery("대성산업", "대성")).toBe(true);
    expect(matchesQuery("다스산업", "대성")).toBe(false);
    expect(matchesQuery("동서물류", "대성")).toBe(false);
  });

  it("초성 검색과 섞인 질의도 같이 산다", () => {
    expect(matchesQuery("대성산업", "ㄷㅅ")).toBe(true);
    expect(matchesQuery("다스산업", "ㄷㅅ")).toBe(true);
    expect(matchesQuery("대성산업", "대ㅅ")).toBe(true);
    expect(matchesQuery("다스산업", "대ㅅ")).toBe(false);
  });

  it("빈 질의는 전체를 보여준다", () => {
    expect(matchesQuery("아무회사", "")).toBe(true);
    expect(matchesQuery("아무회사", "   ")).toBe(true);
  });
});
