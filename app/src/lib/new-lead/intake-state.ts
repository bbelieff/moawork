export type NewLeadIntakeState = Readonly<{
  ok: boolean;
  message: string;
  field?: "title" | "business_registration_type" | "form";
  itemId?: string;
}>;

export const INITIAL_NEW_LEAD_INTAKE_STATE: NewLeadIntakeState = { ok: false, message: "" };
