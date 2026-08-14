import type { CompanyHandoffInput } from "./types";

type HandoffMode = "created" | "existing" | "created_needs_review";

interface HandoffRpcRow {
  company_id: string;
  mode: string;
  duplicate_candidate_ids: string[] | null;
}

export interface CompanyHandoffRpcClient {
  rpc(
    name: "handoff_company_to_work",
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface SupabaseCompanyHandoffResult {
  companyId: string;
  mode: HandoffMode;
  duplicateCandidateIds: readonly string[];
}

function isMode(value: string): value is HandoffMode {
  return value === "created" || value === "existing" || value === "created_needs_review";
}

function readSingleRow(data: unknown): HandoffRpcRow {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("업체 이관 결과가 정확히 1건이 아닙니다.");
  }
  const row = data[0] as Partial<HandoffRpcRow> | null;
  if (!row || typeof row.company_id !== "string" || typeof row.mode !== "string" || !isMode(row.mode)) {
    throw new Error("업체 이관 결과 형식이 올바르지 않습니다.");
  }
  if (row.duplicate_candidate_ids !== null && !Array.isArray(row.duplicate_candidate_ids)) {
    throw new Error("중복 검토 후보 결과 형식이 올바르지 않습니다.");
  }
  return row as HandoffRpcRow;
}

/**
 * BBE-125의 원자적 DB 경계.
 *
 * 호출자는 회사 값을 딜에 복사하지 않고, 이 RPC가 연결한 `deals.company_id`를 기준으로
 * 회사 마스터의 7개 필드를 읽는다. 오류가 나면 부분 성공을 추측하지 않고 실패로 돌린다.
 */
export async function handoffCompanyWithSupabase(
  client: CompanyHandoffRpcClient,
  orgId: string,
  input: CompanyHandoffInput,
): Promise<SupabaseCompanyHandoffResult> {
  const { data, error } = await client.rpc("handoff_company_to_work", {
    p_org_id: orgId,
    p_deal_id: input.dealId,
    p_name: input.name,
    p_biz_no: input.bizNo ?? null,
    p_owner_name: input.ceoName ?? null,
    p_business_type: input.bizType ?? null,
    p_industry: input.industry ?? null,
    p_region_sido: input.regionSido ?? null,
    p_region_sigungu: input.regionSigungu ?? null,
    p_phone: input.phone ?? null,
    p_founded_on: input.foundedOn ?? null,
    p_revenue: input.revenue ?? null,
  });
  if (error) {
    throw new Error(error.message || "업체 이관에 실패했습니다.");
  }

  const row = readSingleRow(data);
  return {
    companyId: row.company_id,
    mode: row.mode as HandoffMode,
    duplicateCandidateIds: row.duplicate_candidate_ids ?? [],
  };
}
