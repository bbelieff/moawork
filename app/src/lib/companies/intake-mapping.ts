/**
 * 계약 실무 «새 회사» intake의 정본 매핑 — 화면·서버 액션이 공유하는 순수 규칙.
 *
 * `"use server"` 파일에 두면 Next가 async 외 export를 금지하므로
 * 여기 둔다 (`scripts/check-use-server-exports.mjs` 게이트).
 *
 * ① 이름 비교 정규화 — 후보 보여주기용. 합치지 않는다(자동 병합 없음).
 * ② 창업연월(`YYYY-MM`, 승인 입력) → 회사 저장(`founded_on` 일자). 월의 첫날로 둔다.
 * ③ 시도+시군구(RegionFields 정본) → 회사 저장(`region` 단일 카탈로그 값).
 *    강원처럼 시도값과 카탈로그 접두사가 다른 경우도 카탈로그에서 찾아 맞춘다.
 */

import { normalizeRegion } from "@/lib/structure-packs/region-options";
import { canonicalSido, canonicalSigungu } from "@/lib/new-lead/region-search";

/**
 * 이름 비교용 정규화 — 띄어쓰기·대소문자 표기 차이만으로 «다른 회사» 가 되지 않게.
 * 합치는 용도가 아니라 «이미 있는 후보를 보여주는» 용도다(자동 병합 없음).
 */
export function normalizeCompanyNameForDuplicateCheck(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 창업연월 입력(`YYYY-MM`)인가. 빈값은 미입력(null)으로 둔다. */
export function parseFoundedMonthInput(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
    throw new Error(`창업연월은 YYYY-MM 형식이어야 합니다: ${trimmed}`);
  }
  return trimmed;
}

/** 창업연월(`YYYY-MM`) → 회사 저장값(`founded_on`, 그 달 1일). */
export function foundedMonthToFoundedOn(month: string | null | undefined): string | null {
  const parsed = parseFoundedMonthInput(month);
  return parsed === null ? null : `${parsed}-01`;
}

/**
 * 시도+시군구 → 회사 저장값(`region`, 단일 카탈로그 `시도_시군구`).
 * 둘 중 하나라도 비었으면 미입력(null). 카탈로그에 없으면 Error — 호출부가
 * 입력을 돌려주고 실패 뒤에도 값을 유지한다. 새로 지어내지 않는다.
 */
export function joinCanonicalRegion(
  sido: string | null | undefined,
  sigungu: string | null | undefined,
): string | null {
  const rawSido = (sido ?? "").trim();
  const rawSigungu = (sigungu ?? "").trim();
  if (rawSido === "" && rawSigungu === "") return null;
  const canonicalSidoValue = canonicalSido(rawSido);
  if (!canonicalSidoValue) {
    throw new Error("시도를 추천 목록에서 선택해 주세요. 입력은 유지됩니다.");
  }
  const canonicalSigunguValue = canonicalSigungu(canonicalSidoValue, rawSigungu);
  if (!canonicalSigunguValue) {
    throw new Error("시군구를 추천 목록에서 선택해 주세요. 입력은 유지됩니다.");
  }
  // 시도값과 카탈로그 접두사가 다를 수 있다(«강원» → «강원도_…»).
  // 직접 이어 붙이지 않고 카탈로그에서 찾아 맞춘다.
  const candidates = [`${canonicalSidoValue}_${canonicalSigunguValue}`];
  if (canonicalSidoValue === "강원") candidates.push(`강원도_${canonicalSigunguValue}`);
  for (const candidate of candidates) {
    const matched = normalizeRegion(candidate);
    if (matched) return matched;
  }
  throw new Error("지역을 추천 목록에서 선택해 주세요. 입력은 유지됩니다.");
}
