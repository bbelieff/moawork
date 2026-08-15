import type { ContactTransitionKind } from "./contactPipeline";

export type ContactPipelineRpcClient = Readonly<{
  rpc(name: "execute_contact_pipeline_transition", args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}>;

export type ContactPipelineExecution = Readonly<{
  status: "committed" | "blocked";
  dealId: string | null;
  companyId: string | null;
  reason: string | null;
}>;

function parseExecution(data: unknown): ContactPipelineExecution {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("이동 결과를 확인할 수 없습니다.");
  const value = row as Record<string, unknown>;
  if (
    (value.status !== "committed" && value.status !== "blocked") ||
    !(typeof value.deal_id === "string" || value.deal_id === null) ||
    !(typeof value.company_id === "string" || value.company_id === null) ||
    !(typeof value.reason === "string" || value.reason === null)
  ) throw new Error("이동 결과 형식이 올바르지 않습니다.");
  return {
    status: value.status,
    dealId: value.deal_id,
    companyId: value.company_id,
    reason: value.reason,
  };
}

/** BBE-152: decision, company handoff and stage mutation share one DB transaction. */
export async function executeContactPipelineTransition(
  client: ContactPipelineRpcClient,
  input: Readonly<{
    orgId: string;
    dealId?: string | null;
    sourceItemId?: string | null;
    requestId: string;
    kind: ContactTransitionKind;
    companyId?: string | null;
    companyName?: string | null;
    bizNo?: string | null;
    ownerName?: string | null;
    businessType?: string | null;
    industry?: string | null;
    regionSido?: string | null;
    regionSigungu?: string | null;
    phone?: string | null;
    foundedOn?: string | null;
    revenue?: string | null;
  }>,
): Promise<ContactPipelineExecution> {
  const { data, error } = await client.rpc("execute_contact_pipeline_transition", {
    p_org_id: input.orgId,
    p_deal_id: input.dealId ?? null,
    p_source_item_id: input.sourceItemId ?? null,
    p_request_id: input.requestId,
    p_kind: input.kind,
    p_company_id: input.companyId ?? null,
    p_company_name: input.companyName ?? null,
    p_biz_no: input.bizNo ?? null,
    p_owner_name: input.ownerName ?? null,
    p_business_type: input.businessType ?? null,
    p_industry: input.industry ?? null,
    p_region_sido: input.regionSido ?? null,
    p_region_sigungu: input.regionSigungu ?? null,
    p_phone: input.phone ?? null,
    p_founded_on: input.foundedOn ?? null,
    p_revenue: input.revenue ?? null,
  });
  if (error) throw new Error(error.message || "이동에 실패했습니다.");
  return parseExecution(data);
}
