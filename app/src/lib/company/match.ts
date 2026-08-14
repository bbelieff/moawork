/**
 * 업체 마스터 — 검색·중복판정 (BBE-125).
 *
 * 목업의 `pfilter`/`upsertCompany` 판정 규칙을 순수 함수로 옮겼다.
 * 영속 경계는 `065_company_master_identity.sql`과 `supabase-handoff.ts`가 담당한다.
 */

import { matchesQuery } from "./chosung";
import type {
  CompanyCandidate,
  CompanyIdentityInput,
  CompanyReference,
  DuplicateMatch,
} from "./types";
import { COMPANY_REFERENCE_FIELDS } from "./types";

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

/** 사업자등록번호 비교용 — 표시 하이픈·공백과 무관하게 숫자 10자리로 비교한다. */
export function normalizeBizNo(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
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
  const bizNo = normalizeBizNo(input.bizNo);
  if (bizNo) {
    const confirmed = companies.filter((c) => normalizeBizNo(c.bizNo) === bizNo);
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

/**
 * 업체를 골랐을 때 딜에 저장할 것은 `companyId` 하나뿐이다.
 * 화면은 이 참조와 7개 키로 회사 마스터의 최신 값을 읽는다(D31).
 */
export function referenceCompany(candidate: CompanyCandidate): CompanyReference {
  return {
    companyId: candidate.id,
    fields: COMPANY_REFERENCE_FIELDS,
  };
}
