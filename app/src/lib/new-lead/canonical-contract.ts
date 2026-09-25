export const NEW_LEAD_RPC = {
  create: "create_new_lead",
  createWithFoundedMonth: "create_new_lead_with_founded_month",
  update: "update_new_lead_fields",
  updateTitle: "update_new_lead_title",
  updateMeta: "update_new_lead_intake_meta",
  advance: "advance_new_lead_to_contact",
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

export type AdvanceNewLeadRow = Readonly<{
  status: "committed" | "blocked" | "rolled_back";
  deal_id: string;
  company_id: string | null;
  reason: string | null;
}>;
