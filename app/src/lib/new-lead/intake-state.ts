export type NewLeadIntakeState = Readonly<{
  ok: boolean;
  message: string;
  field?: "title" | "form";
  itemId?: string;
}>;

export const INITIAL_NEW_LEAD_INTAKE_STATE: NewLeadIntakeState = { ok: false, message: "" };
