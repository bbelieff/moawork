/**
 * 업체 마스터 도메인 배럴 (BBE-125).
 *
 * ⚠️ DB 연동 없음. `companies`/`deals` 스키마 확장은 BBE-108(회계 원장, 미착수·blocked_by)
 * 착수 순서와 얽혀 있어 이 카드 범위에서 제외했다 — 근거는 `docs/worklog.md` BBE-125 START 항목과
 * `docs/design/업체·자금건_데이터모델_v1.md` §8 참조. 여기 있는 것은 DB 없이도 안전한
 * 검색·중복판정 순수 로직과, 그 위에 얹는 프레젠테이션 전용 픽커 UI뿐이다.
 */

export * from "./types";
export { chosung, matchesQuery } from "./chosung";
export {
  normalizeCompanyName,
  searchCompanies,
  findDuplicateMatches,
  autoFillFrom,
} from "./match";
