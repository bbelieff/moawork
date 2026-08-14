/**
 * 업체 마스터 도메인 배럴 (BBE-125).
 *
 * 검색·중복판정, 참조 기반 자동 채움, 계약 이관 경계를 한 곳에서 제공한다.
 */

export * from "./types";
export { chosung, matchesQuery } from "./chosung";
export {
  normalizeCompanyName,
  normalizeBizNo,
  searchCompanies,
  findDuplicateMatches,
  referenceCompany,
} from "./match";
export { handoffCompany, type CompanyHandoffStore } from "./handoff";
export {
  handoffCompanyWithSupabase,
  type CompanyHandoffRpcClient,
  type SupabaseCompanyHandoffResult,
} from "./supabase-handoff";
