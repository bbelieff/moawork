import type { NewLeadFieldPatch } from "./canonical-contract";

/** Physical board keys and legacy aliases share the audited intake writer. */
export const NEW_LEAD_FIELD_KEYS: Readonly<Record<string, keyof NewLeadFieldPatch>> = {
  rep_name: "representative_name",
  phone: "phone",
  email: "email",
  biz_reg_type: "business_registration_type",
  business_registration_type: "business_registration_type",
  industry: "industry",
  revenue_band: "revenue_band",
  sido: "region_sido",
  region_sido: "region_sido",
  sigungu: "region_sigungu",
  region_sigungu: "region_sigungu",
  ad_name: "acquisition_source",
  acquisition_source: "acquisition_source",
};

// Owner is deliberately absent: assignment must use the lineage action.
export const NEW_LEAD_META_KEYS = new Set(["collaborators", "applied_on", "address_detail"]);
