import { describe, expect, it } from "vitest";
import {
  findDuplicateMatches,
  normalizeBizNo,
  normalizeCompanyName,
  referenceCompany,
  searchCompanies,
} from "./match";
import type { CompanyCandidate } from "./types";

function company(overrides: Partial<CompanyCandidate>): CompanyCandidate {
  return {
    id: "id",
    bizNo: null,
    name: "이름 없음",
    ceoName: null,
    bizType: null,
    industry: null,
    regionSido: null,
    regionSigungu: null,
    phone: null,
    foundedOn: null,
    revenue: null,
    dealCount: 0,
    lastActivity: null,
    ...overrides,
  };
}

const WOOJIN = company({
  id: "c1",
  bizNo: "123-45-67890",
  name: "우진산업㈜",
  ceoName: "정우진",
  bizType: "법인",
  industry: "제조업",
  regionSido: "경남",
  regionSigungu: "김해시",
  phone: "010-3390-••••",
  foundedOn: "2009",
  revenue: "54억",
  dealCount: 3,
  lastActivity: "혁신성장자금 · 진행중",
});

const DAEHAN = company({
  id: "c2",
  bizNo: "222-11-22222",
  name: "㈜대한정밀",
  ceoName: "김성호",
  bizType: "법인",
  industry: "제조업",
  regionSido: "경기",
  regionSigungu: "화성시",
  dealCount: 2,
  lastActivity: "기보 혁신리딩 · 진행중",
});

const FIXTURES = [WOOJIN, DAEHAN];

describe("normalizeCompanyName (BBE-125)", () => {
  it("법인 표기와 공백을 제거해 같은 값으로 만든다", () => {
    const variants = ["㈜대한정밀", "주식회사 대한정밀", "대한정밀(주)", "대한 정밀"];
    const normalized = variants.map(normalizeCompanyName);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("대한정밀");
  });
});

describe("normalizeBizNo (BBE-125)", () => {
  it("하이픈·공백을 제거하고 유효한 10자리만 식별키로 쓴다", () => {
    expect(normalizeBizNo("123-45-67890")).toBe("1234567890");
    expect(normalizeBizNo("123 45 67890")).toBe("1234567890");
    expect(normalizeBizNo("123")).toBeNull();
  });
});

describe("searchCompanies (BBE-125)", () => {
  it("초성으로 회사명을 찾는다 — 수용 기준 예시", () => {
    expect(searchCompanies(FIXTURES, "ㅇㅈㅅㅇ")).toEqual([WOOJIN]);
  });

  it("대표자명으로도 찾아진다", () => {
    expect(searchCompanies(FIXTURES, "김성호")).toEqual([DAEHAN]);
  });

  it("회사명 일부와 대표자명 일부로도 찾아진다", () => {
    expect(searchCompanies(FIXTURES, "진산")).toEqual([WOOJIN]);
    expect(searchCompanies(FIXTURES, "성호")).toEqual([DAEHAN]);
  });

  it("빈 검색어는 전체를 돌려준다", () => {
    expect(searchCompanies(FIXTURES, "")).toEqual(FIXTURES);
  });

  it("대표자명이 null이어도 오류 없이 걸러진다", () => {
    const noCeo = company({ id: "c3", name: "이름만" });
    expect(searchCompanies([noCeo], "정우진")).toEqual([]);
  });
});

describe("findDuplicateMatches (BBE-125)", () => {
  it("사업자등록번호가 같으면 confirmed", () => {
    const matches = findDuplicateMatches(
      { name: "우진산업(주)", bizNo: "123-45-67890" },
      FIXTURES,
    );
    expect(matches).toEqual([{ kind: "confirmed", candidate: WOOJIN }]);
  });

  it("사업자등록번호가 없고 정규화명+대표자명이 같으면 suspected(자동 병합 아님)", () => {
    const matches = findDuplicateMatches(
      { name: "주식회사 대한정밀", ceoName: "김성호" },
      FIXTURES,
    );
    expect(matches).toEqual([{ kind: "suspected", candidate: DAEHAN }]);
  });

  it("사업자등록번호가 다르면 confirmed로 올리지 않되, 이름+대표자가 같으면 suspected로는 남긴다", () => {
    // 다른 bizNo를 "그러니 확실히 다른 회사"로 단정하지 않는다 — 오탈자로 실제 중복을
    // 놓치는 쪽이 더 위험하다(D40: 애매하면 숨기지 말고 사람이 보게 한다).
    const matches = findDuplicateMatches(
      { name: "㈜대한정밀", bizNo: "999-99-99999", ceoName: "김성호" },
      FIXTURES,
    );
    expect(matches).toEqual([{ kind: "suspected", candidate: DAEHAN }]);
  });

  it("이름과 대표자명이 모두 다르면 빈 배열", () => {
    expect(findDuplicateMatches({ name: "새봄푸드", ceoName: "오새봄" }, FIXTURES)).toEqual([]);
  });

  it("대표자명 없이 이름만 겹치는 것은 suspected로 올리지 않는다(오탐 방지)", () => {
    expect(findDuplicateMatches({ name: "㈜대한정밀" }, FIXTURES)).toEqual([]);
  });
});

describe("referenceCompany (BBE-125)", () => {
  it("회사 값은 복사하지 않고 companyId와 7개 참조 키만 돌려준다", () => {
    expect(referenceCompany(WOOJIN)).toEqual({
      companyId: "c1",
      fields: ["ceoName", "businessType", "industry", "region", "phone", "foundedOn", "revenue"],
    });
  });
});
