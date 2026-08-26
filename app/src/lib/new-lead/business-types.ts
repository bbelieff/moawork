/** 신규리드 빠른 등록과 서버 검증이 공유하는 사용자 선택 집합. */
export const NEW_LEAD_BUSINESS_TYPES = [
  "개인사업자",
  "법인사업자",
  "그외",
] as const;

export const NEW_LEAD_CUSTOM_BUSINESS_TYPE = "그외" as const;

export function resolveNewLeadBusinessType(
  selected: string,
  custom: string,
): string | null {
  if (!NEW_LEAD_BUSINESS_TYPES.includes(selected as (typeof NEW_LEAD_BUSINESS_TYPES)[number])) {
    return null;
  }
  if (selected !== NEW_LEAD_CUSTOM_BUSINESS_TYPE) return selected;
  const value = custom.trim();
  return value ? value : null;
}
