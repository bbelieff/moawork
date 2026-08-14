import { findDuplicateMatches, referenceCompany } from "./match";
import type {
  CompanyCandidate,
  CompanyHandoffInput,
  CompanyHandoffResult,
} from "./types";

/**
 * 영속성 경계. 실제 Supabase 구현은 한 트랜잭션/RPC로 이 계약을 수행해야 한다.
 * 테스트·로컬 구현도 `attachDeal` 성공 전에는 이관 완료를 보고하지 않는다.
 */
export interface CompanyHandoffStore {
  listCompanies(): Promise<readonly CompanyCandidate[]>;
  createCompany(
    input: CompanyHandoffInput,
    duplicateCandidateIds: readonly string[],
  ): Promise<CompanyCandidate>;
  attachDeal(dealId: string, companyId: string): Promise<void>;
}

/**
 * 계약 이관 규칙(D29~D33·D40).
 *
 * - 사업자등록번호 확정 일치: 기존 회사는 수정하지 않고 현재 딜만 연결한다.
 * - 이름+대표자 의심 일치: 새 회사를 별도 생성하고 검토 후보를 남긴다. 자동 병합하지 않는다.
 * - 일치 없음: 새 회사를 만들고 딜을 연결한다.
 */
export async function handoffCompany(
  store: CompanyHandoffStore,
  input: CompanyHandoffInput,
): Promise<CompanyHandoffResult> {
  const companies = await store.listCompanies();
  const matches = findDuplicateMatches(input, companies);
  const confirmed = matches.filter((match) => match.kind === "confirmed");

  if (confirmed.length > 1) {
    throw new Error("사업자등록번호가 같은 업체가 둘 이상이라 이관을 중단했습니다.");
  }
  if (confirmed.length === 1) {
    const company = confirmed[0].candidate;
    await store.attachDeal(input.dealId, company.id);
    return { mode: "existing", company, reference: referenceCompany(company) };
  }

  const candidates = matches
    .filter((match) => match.kind === "suspected")
    .map((match) => match.candidate);
  const company = await store.createCompany(input, candidates.map((candidate) => candidate.id));
  await store.attachDeal(input.dealId, company.id);
  const reference = referenceCompany(company);
  return candidates.length > 0
    ? { mode: "created_needs_review", company, candidates, reference }
    : { mode: "created", company, reference };
}
