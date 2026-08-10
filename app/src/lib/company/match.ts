/**
 * 업체 마스터 — 검색·중복판정 (BBE-125).
 *
 * DB 스키마(컬럼)는 아직 없다(§ index.ts 상단 경고). 이 파일은 목업의
 * `pfilter`/`upsertCompany` 판정 규칙을 순수 함수로 옮긴 것이며, 실제 저장은
 * 별도 카드(BBE-108 완료 후)가 이 함수들을 그대로 호출해 붙이면 된다.
 */

import { matchesQuery } from "./chosung";
import type {
  CompanyAutoFillFields,
  CompanyCandidate,
  CompanyIdentityInput,
  DuplicateMatch,
} from "./types";

const CORP_MARKERS = ["주식회사", "㈜", "(주)"];

/**
 * 회사명 정규화 — 공백·법인 표기(㈜·(주)·주식회사)를 제거한다(설계서 §2-1).
 * 사업자등록번호가 없을 때의 2순위 식별 키(정규화명 + 대표자명)에 쓴다.
 */
export function normalizeCompanyName(name: string): string {
  let n = name;
  for (const marker of CORP_MARKERS) n = n.split(marker).join("");
  return n.replace(/\s+/g, "");
}

/** 회사명·대표자명 중 하나라도 검색어에 걸리면 포함(목업 `hit(c.n,q)||hit(c.ceo,q)`). */
export function searchCompanies(
  companies: readonly CompanyCandidate[],
  query: string,
): CompanyCandidate[] {
  return companies.filter(
    (c) => matchesQuery(c.name, query) || (c.ceoName !== null && matchesQuery(c.ceoName, query)),
  );
}

/**
 * 신규/이관 입력이 기존 업체와 같은 회사인지 판정한다.
 *
 * 1순위: 사업자등록번호 일치 → `confirmed`(같은 회사로 확정).
 * 2순위(1순위 매치가 없을 때만): 정규화 회사명 + 대표자명 일치 → `suspected`(중복 의심).
 *
 * **자동 병합하지 않는다(D40).** 호출자는 `confirmed`를 자동 upsert 근거로,
 * `suspected`는 화면에 "확인 필요"로만 노출한다.
 */
export function findDuplicateMatches(
  input: CompanyIdentityInput,
  companies: readonly CompanyCandidate[],
): DuplicateMatch[] {
  const bizNo = input.bizNo?.trim();
  if (bizNo) {
    const confirmed = companies.filter((c) => c.bizNo !== null && c.bizNo === bizNo);
    if (confirmed.length > 0) {
      return confirmed.map((candidate) => ({ kind: "confirmed" as const, candidate }));
    }
  }

  const ceoName = input.ceoName?.trim();
  if (!ceoName) return [];
  const normalizedName = normalizeCompanyName(input.name);
  return companies
    .filter(
      (c) =>
        c.ceoName !== null &&
        c.ceoName.trim() === ceoName &&
        normalizeCompanyName(c.name) === normalizedName,
    )
    .map((candidate) => ({ kind: "suspected" as const, candidate }));
}

/** 업체를 골랐을 때 새 행에 채워 넣을 필드(목업 `fillFrom` 1:1 — 값은 참조 없이 복사, D31). */
export function autoFillFrom(candidate: CompanyCandidate): CompanyAutoFillFields {
  return {
    ceoName: candidate.ceoName,
    bizType: candidate.bizType,
    industry: candidate.industry,
    phone: candidate.phone,
    regionSido: candidate.regionSido,
    regionSigungu: candidate.regionSigungu,
    foundedOn: candidate.foundedOn,
    revenue: candidate.revenue,
  };
}
