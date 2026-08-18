import type { SupabaseClient } from "@supabase/supabase-js";

export type NewLeadAdvanceResult = Readonly<{
  status: "committed" | "blocked" | "rolled_back";
  dealId: string;
  companyId: string | null;
  reason: string | null;
}>;

type AdvanceRow = Readonly<{
  status: unknown;
  deal_id: unknown;
  company_id: unknown;
  reason: unknown;
}>;

export class NewLeadAdvanceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "NewLeadAdvanceError";
  }
}

function userMessage(code: string | undefined): string {
  if (code === "42501") return "컨택 이동 권한이 없습니다.";
  if (code === "22023") return "컨택 이동 대상 또는 보드 구성을 확인해 주세요.";
  return "컨택 이동을 완료하지 못했습니다. 다시 시도해 주세요.";
}

function parseRow(value: unknown): NewLeadAdvanceResult {
  const row = value as AdvanceRow | null;
  if (!row || !["committed", "blocked", "rolled_back"].includes(String(row.status))) {
    throw new NewLeadAdvanceError("컨택 이동 결과를 확인하지 못했습니다.");
  }
  if (typeof row.deal_id !== "string") {
    throw new NewLeadAdvanceError("컨택 이동 결과를 확인하지 못했습니다.");
  }
  return {
    status: row.status as NewLeadAdvanceResult["status"],
    dealId: row.deal_id,
    companyId: typeof row.company_id === "string" ? row.company_id : null,
    reason: typeof row.reason === "string" && row.reason ? row.reason : null,
  };
}

export async function advanceNewLeadToContact(
  client: SupabaseClient,
  input: Readonly<{ itemId: string; requestId: string }>,
): Promise<NewLeadAdvanceResult> {
  const result = await client.rpc("advance_new_lead_to_contact", {
    p_item_id: input.itemId,
    p_request_id: input.requestId,
  });
  if (result.error) {
    throw new NewLeadAdvanceError(userMessage(result.error.code), result.error.code);
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return parseRow(row);
}
