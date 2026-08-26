/**
 * 운영 Monday 신규고객 보드에서 2026-08-26 실제로 확인된 금액 구간.
 * `매출액` 칸에는 사업자 유형도 섞여 있었으므로 금액 구간 패턴만 분리했다.
 */
export const NEW_LEAD_REVENUE_BANDS = [
  "1,000만원~2,000만원",
  "2,000만원~4,000만원",
  "6,000만원~9,000만원",
  "그외",
] as const;

export function resolveNewLeadRevenueBand(selected: string, custom: string): string | null {
  if (!selected) return null;
  if (!NEW_LEAD_REVENUE_BANDS.includes(selected as (typeof NEW_LEAD_REVENUE_BANDS)[number])) {
    return null;
  }
  if (selected !== "그외") return selected;
  const value = custom.trim();
  return value || null;
}
