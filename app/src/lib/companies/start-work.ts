export interface CompanyStartWorkClient {
  rpc(
    name: "start_company_work_v2" | "create_company_and_start_work",
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export interface CompanyStartWorkResult {
  dealId: string;
  itemId: string;
  replayed: boolean;
}

export class CompanyStartWorkError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export interface CompanyIntakeResult {
  companyId: string;
  dealId: string;
  itemId: string;
  replayed: boolean;
}

export class CompanyIntakeError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 155 원자 intake — 회사 등록 + 업무 시작을 한 트랜잭션으로 잇는다.
 * 같은 열쇠+같은 내용의 재시도는 같은 회사·딜을 돌려준다(replayed).
 * 155가 아직 적용되지 않은 환경에서는 호출부가 쓰기 없이 실패로 끝낸다.
 */
export async function createCompanyAndStartWork(
  client: CompanyStartWorkClient,
  input: {
    orgId: string;
    boardId: string;
    groupId?: string | null;
    requestId: string;
    name: string;
    bizType?: string | null;
    foundedOn?: string | null;
    region?: string | null;
    phone?: string | null;
    ownerName?: string | null;
  },
): Promise<CompanyIntakeResult> {
  const { data, error } = await client.rpc("create_company_and_start_work", {
    p_org_id: input.orgId,
    p_board_id: input.boardId,
    p_group_id: input.groupId ?? null,
    p_request_id: input.requestId,
    p_name: input.name,
    p_biz_type: input.bizType ?? null,
    p_founded_on: input.foundedOn ?? null,
    p_region: input.region ?? null,
    p_phone: input.phone ?? null,
    p_owner_name: input.ownerName ?? null,
  });
  if (error) throw new CompanyIntakeError(error.message || "회사를 등록하지 못했습니다.", error.code);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!isRecord(row) || typeof row.company_id !== "string" || typeof row.deal_id !== "string"
      || typeof row.item_id !== "string" || typeof row.replayed !== "boolean") {
    throw new CompanyIntakeError("등록 결과를 확인하지 못했습니다.");
  }
  return { companyId: row.company_id, dealId: row.deal_id, itemId: row.item_id, replayed: row.replayed };
}

export async function startCompanyWork(
  client: CompanyStartWorkClient,
  input: { orgId: string; companyId: string; requestId: string; groupId?: string | null },
): Promise<CompanyStartWorkResult> {
  const { data, error } = await client.rpc("start_company_work_v2", {
    p_org_id: input.orgId,
    p_company_id: input.companyId,
    p_request_id: input.requestId,
    // ★ 누른 그룹. 안 넘기면 서버가 «맨 위» 그룹을 고른다 — 마이그레이션 140 의 기본값이다.
    //   회사 상세의 「업무 시작」은 그룹을 모르는 자리라 계속 안 넘긴다(동작 그대로).
    p_group_id: input.groupId ?? null,
  });
  if (error) throw new CompanyStartWorkError(error.message || "업무를 시작하지 못했습니다.", error.code);
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row || typeof row.deal_id !== "string" || typeof row.item_id !== "string" || typeof row.replayed !== "boolean") {
    throw new CompanyStartWorkError("업무 시작 결과를 확인하지 못했습니다.");
  }
  return { dealId: row.deal_id, itemId: row.item_id, replayed: row.replayed };
}
