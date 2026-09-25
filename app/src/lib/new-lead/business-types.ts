/** 신규리드 빠른 등록과 서버 검증이 공유하는 사용자 선택 집합. */
export const NEW_LEAD_BUSINESS_TYPES = [
  "개인사업자",
  "법인사업자",
  "그외",
] as const;

export const NEW_LEAD_CUSTOM_BUSINESS_TYPE = "그외" as const;

/**
 * 승인된 과세·형태 하위 구분(가산식). 기존 저장값("개인사업자"·"법인사업자"·
 * "그외"+자유기재)은 그대로 유효하며, 새 값은 접미사로만 확장한다.
 *
 * - 개인: 일반(기본값, 저장값 "개인사업자") · 간이 · 면세 — 한 번 더 눌러 고른다.
 * - 법인: 일반(기본값, 저장값 "법인사업자") · 면세 · 유한.
 * - "유한"은 과세유형이 아니라 법인 형태(유한회사)이므로 세금 구분과 같은
 *   선상에 두지 않는다. 저장값 "법인사업자(유한)"은 형태 표기이며 과세유형
 *   미확정으로 읽는다 — 일반/면세로 임의 환원하지 않는다.
 */
export const NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES = [
  "일반",
  "간이",
  "면세",
] as const;

export const NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES = [
  "일반",
  "면세",
  "유한",
] as const;

export type NewLeadPersonalBusinessSubtype =
  (typeof NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES)[number];
export type NewLeadCorporateBusinessSubtype =
  (typeof NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES)[number];

export function resolveNewLeadBusinessSubtype(
  selected: string,
  subtype: string,
  custom: string,
): string | null {
  const value = selected.trim();
  if (!value) return null;
  if (value === NEW_LEAD_CUSTOM_BUSINESS_TYPE) {
    const legacyCustom = custom.trim();
    return legacyCustom || value;
  }
  const kind = subtype.trim() || "일반";
  if (value === "개인사업자") {
    if (!(NEW_LEAD_PERSONAL_BUSINESS_SUBTYPES as readonly string[]).includes(kind)) return value;
    return kind === "일반" ? value : `${value}(${kind})`;
  }
  if (value === "법인사업자") {
    if (!(NEW_LEAD_CORPORATE_BUSINESS_SUBTYPES as readonly string[]).includes(kind)) return value;
    return kind === "일반" ? value : `${value}(${kind})`;
  }
  // 승인 목록에 없는 과거·외부 저장값도 읽을 수 있게 그대로 둔다.
  return value;
}

export function resolveNewLeadBusinessType(
  selected: string,
  custom: string,
): string | null {
  const value = selected.trim();
  if (!value) return null;
  if (value !== NEW_LEAD_CUSTOM_BUSINESS_TYPE) {
    if (value === "개인사업자" || value === "법인사업자") return value;
    // 접미사 확장값("개인사업자(간이)" 등)과 과거 저장값을 그대로 통과시킨다.
    return value;
  }
  const legacyCustom = custom.trim();
  return legacyCustom || value;
}
