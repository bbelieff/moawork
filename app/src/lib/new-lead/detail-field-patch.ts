/**
 * 신규리드 상세 자동 저장의 정본 필드 매핑 (단일 정의).
 *
 * `app/(app)/boards/new-lead-actions.ts`의 DETAIL_FIELD_PATCH와 같은
 * 객체다 — 복제가 아니라 그쪽이 이 파일을 import해 쓴다. OCR 저장 분기도
 * 같은 의미를 재사용하므로, 총괄 통합 시 shared helper로 합치면 된다.
 * 키 의미: 보드 컬럼/상세 키 → canonical deal patch 키.
 */
export const NEW_LEAD_DETAIL_FIELD_PATCH = {
  rep_name: "representative_name",
  phone: "phone",
  email: "email",
  biz_reg_type: "business_registration_type",
  industry: "industry",
  revenue_band: "revenue_band",
  sido: "region_sido",
  sigungu: "region_sigungu",
  ad_name: "acquisition_source",
} as const;
