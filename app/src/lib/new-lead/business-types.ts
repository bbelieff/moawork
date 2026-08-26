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
  const value = selected.trim();
  if (!value) return null;
  if (value !== NEW_LEAD_CUSTOM_BUSINESS_TYPE) return value;
  const legacyCustom = custom.trim();
  return legacyCustom || value;
}
