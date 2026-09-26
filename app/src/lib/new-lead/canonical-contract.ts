export const NEW_LEAD_RPC = {
  create: "create_new_lead",
  createWithFoundedMonth: "create_new_lead_with_founded_month",
  update: "update_new_lead_fields",
  updateTitle: "update_new_lead_title",
  updateMeta: "update_new_lead_intake_meta",
  advance: "advance_new_lead_to_contact",
  /** 154 초안(미적용): OCR intake meta·연계 회사 동기화 (protected chain enrich는 154 wrapper가 소유). */
  ocrMeta: "update_new_lead_ocr_meta",
  companyBizNo: "ocr_update_linked_company_biz_no",
  companyNameSync: "ocr_sync_linked_company_name",
} as const;

export const NEW_LEAD_ERROR = {
  invalidInput: "22023",
  forbidden: "42501",
  manualCorrectionConflict: "40001",
} as const;

export type NewLeadValueSource = "manual" | "system" | "automation" | "import";

export type NewLeadFieldPatch = Partial<Readonly<{
  representative_name: string | null;
  phone: string | null;
  email: string | null;
  business_registration_type: string | null;
  industry: string | null;
  industry_code: string | null;
  revenue_band: string | null;
  region_sido: string | null;
  region_sigungu: string | null;
  acquisition_source: string | null;
  source_external_id: string | null;
}>>;

export type CreateNewLeadArgs = Readonly<{
  p_org_id: string;
  p_board_id: string;
  p_group_id: string;
  p_request_id: string;
  p_title: string;
  p_representative_name?: string | null;
  p_phone?: string | null;
  p_email?: string | null;
  p_business_registration_type?: string | null;
  p_industry?: string | null;
  p_industry_code?: string | null;
  p_revenue_band?: string | null;
  p_region_sido?: string | null;
  p_region_sigungu?: string | null;
  p_address_detail?: string | null;
  p_acquisition_source?: string | null;
  p_source_external_id?: string | null;
  p_assigned_to?: string | null;
  p_collaborator_ids?: string[] | null;
}>;

export type CreateNewLeadRow = Readonly<{
  deal_id: string;
  item_id: string;
  replayed: boolean;
}>;

export type CreateNewLeadWithFoundedMonthArgs = CreateNewLeadArgs &
  Readonly<{ p_founded_month?: string | null }>;

export type UpdateNewLeadArgs = Readonly<{
  p_org_id: string;
  p_deal_id: string;
  p_request_id: string;
  p_patch: NewLeadFieldPatch;
  p_value_source?: NewLeadValueSource;
}>;

export type UpdateNewLeadRow = Readonly<{
  deal_id: string;
  changed_fields: string[];
  replayed: boolean;
}>;

export type UpdateNewLeadTitleRow = Readonly<{ deal_id: string; item_id: string; replayed: boolean }>;
export type UpdateNewLeadMetaRow = Readonly<{ deal_id: string; item_id: string; changed_fields: string[]; replayed: boolean }>;

/**
 * 154 초안 intake meta patch — deal_intake의 회사-생기기-전 보관분.
 * birthdate는 YYYY-MM-DD 날짜만(주민번호 추론 금지), business_item은
 * industry(업태)와 분리된 종목, biz_no는 10자리 정규화 보관분이다.
 */
export type OcrPrecompanyPatch = Partial<Readonly<{
  birthdate: string | null;
  business_item: string | null;
  biz_no: string | null;
}>>;

export type OcrPrecompanyMetaRow = Readonly<{
  deal_id: string;
  item_id: string;
  changed_fields: string[];
  replayed: boolean;
}>;

export type OcrCompanyBizNoRow = Readonly<{
  deal_id: string;
  company_id: string;
  replayed: boolean;
}>;

export type OcrCompanyNameSyncRow = Readonly<{
  deal_id: string;
  company_id: string;
  /**
   * true면 회사명을 쓰지 않았다 — 새 값과 이미 같아 멱등이거나(감사 없음)
   * replay다. 기존 이름이 있다고 무조건 건너뛰지 않는다: 사용자 확정 +
   * 이전값 CAS가 일치하면 틀린 원본을 갱신한다 (P2 정정).
   */
  skipped: boolean;
  replayed: boolean;
}>;

export type AdvanceNewLeadRow = Readonly<{
  status: "committed" | "blocked" | "rolled_back";
  deal_id: string;
  company_id: string | null;
  reason: string | null;
}>;
