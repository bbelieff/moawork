export type NewLeadIntakeState = Readonly<{
  ok: boolean;
  message: string;
  field?: "title" | "business_registration_type" | "phone" | "revenue_band" | "region_sido" | "region_sigungu" | "form";
  itemId?: string;
}>;

export const INITIAL_NEW_LEAD_INTAKE_STATE: NewLeadIntakeState = { ok: false, message: "" };
