import { describe, expect, it } from "vitest";
import { chosung, companyMatches, digitsOnly, rankCompanies, type CompanyPickerCompany, type CompanyPickerRow } from "./search";

/**
 * 「업체 추가」 검색 — 이 화면의 목적은 «같은 회사를 두 번 적지 않게» 하는 것이다.
 * 그래서 «못 찾는 것» 이 곧 결함이다. 못 찾으면 사람이 새로 만들고, 그게 중복이다.
 *
 * ★ 이름은 전부 «검색 규칙» 을 재기 위한 지어낸 값이다. 실제 고객 정보가 아니다.
 */

const company = (over: Partial<CompanyPickerCompany>): CompanyPickerCompany => ({
  id: "c1", name: "가나상사", biz_type: null, region: null,
  owner_name: null, phone: null, email: null, homepage: null,
  ...over,
});

const row = (over: Partial<CompanyPickerCompany>, dealCount = 0): CompanyPickerRow => ({ company: company(over), dealCount });

describe("초성", () => {
  it("한글을 초성으로 접는다", () => {
    expect(chosung("가나상사")).toBe("ㄱㄴㅅㅅ");
  });

  it("한글이 아닌 글자는 그대로 둔다 — 영문·숫자도 찾을 수 있어야 한다", () => {
    expect(chosung("ABC 가나 123")).toBe("ABC ㄱㄴ 123");
  });
});

describe("전화번호 표기 차이", () => {
  it("구분자를 지운다", () => {
    expect(digitsOnly("010-1234-5678")).toBe("01012345678");
  });

  it("국가번호 82 는 앞의 0 과 같은 자리다", () => {
    expect(digitsOnly("+82 10-1234-5678")).toBe("01012345678");
  });
});

describe("회사 찾기 — 회사명 말고도 «회사에 붙은 것» 으로 찾는다", () => {
  it("회사명 일부로 찾는다", () => {
    expect(companyMatches(company({ name: "가나상사" }), "나상")).toBe(true);
  });

  it("★ 초성으로 찾는다 — 목업이 «예: ㅇㅈㅅㅇ» 라고 안내한다", () => {
    expect(companyMatches(company({ name: "가나상사" }), "ㄱㄴ")).toBe(true);
  });

  it("★ 대표자 이름으로 찾는다 — 회사 이름은 기억 안 나도 «그 사장님» 은 기억난다", () => {
    expect(companyMatches(company({ name: "가나상사", owner_name: "홍길동" }), "홍길")).toBe(true);
    expect(companyMatches(company({ name: "가나상사", owner_name: "홍길동" }), "ㅎㄱㄷ")).toBe(true);
  });

  it("★ 연락처로 찾는다 — 표기가 달라도 걸린다", () => {
    const target = company({ phone: "010-1234-5678" });
    expect(companyMatches(target, "1234")).toBe(true);
    expect(companyMatches(target, "01012345678")).toBe(true);
    expect(companyMatches(target, "+82 10 1234 5678")).toBe(true);
  });

  it("이메일·업종·지역·홈페이지로도 찾는다", () => {
    expect(companyMatches(company({ email: "sales@example.test" }), "example")).toBe(true);
    expect(companyMatches(company({ biz_type: "법인" }), "법인")).toBe(true);
    expect(companyMatches(company({ region: "경기" }), "경기")).toBe(true);
    expect(companyMatches(company({ homepage: "https://example.test" }), "example.test")).toBe(true);
  });

  it("영문은 대소문자를 가리지 않는다", () => {
    expect(companyMatches(company({ name: "MoaTech" }), "moatech")).toBe(true);
  });

  it("빈 질의는 전부 통과 — 처음 열었을 때 목록이 보여야 한다", () => {
    expect(companyMatches(company({}), "   ")).toBe(true);
  });

  it("관계없는 말은 안 걸린다", () => {
    expect(companyMatches(company({ name: "가나상사", owner_name: "홍길동" }), "전혀다른말")).toBe(false);
  });
});

describe("정렬 — 중복 등록을 막는 쪽으로 줄 세운다", () => {
  it("★ 이미 거래한 회사가 위로 온다 — 아래로 밀리면 사람이 못 보고 새로 만든다", () => {
    const ranked = rankCompanies([row({ id: "a", name: "나회사" }, 0), row({ id: "b", name: "다회사" }, 3)], "");
    expect(ranked.map((r) => r.company.id)).toEqual(["b", "a"]);
  });

  it("친 그대로 시작하는 이름이 가장 위다", () => {
    const ranked = rankCompanies(
      [row({ id: "a", name: "새로운회사" }, 5), row({ id: "b", name: "가나상사" }, 0)],
      "가나",
    );
    expect(ranked[0].company.id, "이력이 많아도 «정확히 친 것» 이 먼저다").toBe("b");
  });

  it("안 걸린 회사는 목록에서 빠진다", () => {
    const ranked = rankCompanies([row({ id: "a", name: "가나상사" }), row({ id: "b", name: "다른곳" })], "가나");
    expect(ranked.map((r) => r.company.id)).toEqual(["a"]);
  });
});
