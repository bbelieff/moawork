/** 신규리드 등록 시 사용하는 매출 구간. 기존 저장값은 변경하지 않는다. */
export const NEW_LEAD_REVENUE_BANDS = [
  "~ 1억 미만",
  "1억 이상 ~ 3억 미만",
  "3억 이상 ~ 10억 미만",
  "10억 이상 ~",
  "그외",
] as const;

// 이미 열린 등록 폼의 제출 값도 보존한다.
const LEGACY_REVENUE_BANDS = ["1,000만원~2,000만원", "2,000만원~4,000만원", "6,000만원~9,000만원"];
export const NEW_LEAD_CUSTOM_REVENUE_LABEL = "정확한 수치를 알고 있어요";

export function resolveNewLeadRevenueBand(selected: string, custom: string): string | null {
  if (!selected) return null;
  if (!NEW_LEAD_REVENUE_BANDS.includes(selected as (typeof NEW_LEAD_REVENUE_BANDS)[number]) && !LEGACY_REVENUE_BANDS.includes(selected)) {
    return null;
  }
  if (selected !== "그외") return selected;
  const value = custom.trim();
  return value || null;
}
