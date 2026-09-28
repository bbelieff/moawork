/** 기존 보드 구조와 저장값에 사용한 매출 구간. */
export const NEW_LEAD_REVENUE_BANDS = [
  "1,000만원~2,000만원",
  "2,000만원~4,000만원",
  "6,000만원~9,000만원",
  "그외",
] as const;

/** #770 신규리드 등록 화면의 선택지. 기존 보드 구조는 바꾸지 않는다. */
export const NEW_LEAD_INTAKE_REVENUE_BANDS = [
  "~ 1억 미만",
  "1억 이상 ~ 3억 미만",
  "3억 이상 ~ 10억 미만",
  "10억 이상 ~",
  "그외",
] as const;
export const NEW_LEAD_CUSTOM_REVENUE_LABEL = "정확한 수치를 알고 있어요";

export function resolveNewLeadRevenueBand(selected: string, custom: string): string | null {
  if (!selected) return null;
  const accepted: readonly string[] = [...NEW_LEAD_INTAKE_REVENUE_BANDS, ...NEW_LEAD_REVENUE_BANDS];
  if (!accepted.includes(selected)) return null;
  if (selected !== "그외") return selected;
  const value = custom.trim();
  return value || null;
}
