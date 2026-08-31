export interface CompanyStartWorkClient {
  rpc(name: "create_company_case", args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
}

export interface CompanyStartWorkResult {
  caseId: string;
  /** Compatibility alias for existing routes/query parameters. */
  dealId: string;
  itemId: string;
  version: number;
  replayed: boolean;
}

export type CompanyStartWorkFailureOutcome = "retryable_unknown" | "terminal";

const TERMINAL_POSTGRES_CODES = new Set(["22023", "40001", "42501"]);

export class CompanyStartWorkError extends Error {
  readonly outcome: CompanyStartWorkFailureOutcome;

  constructor(
    message: string,
    readonly code?: string,
    outcome?: CompanyStartWorkFailureOutcome,
  ) {
    super(message);
    this.outcome = outcome ?? (code && TERMINAL_POSTGRES_CODES.has(code) ? "terminal" : "retryable_unknown");
  }
}

/** Raw transport rejection and unverifiable committed results must retain the same request intent. */
export function shouldRetryCompanyStartWork(error: unknown): boolean {
  return !(error instanceof CompanyStartWorkError) || error.outcome === "retryable_unknown";
}

export async function startCompanyWork(
  client: CompanyStartWorkClient,
  input: { orgId: string; companyId: string; requestId: string; groupId?: string | null },
): Promise<CompanyStartWorkResult> {
  const { data, error } = await client.rpc("create_company_case", {
    p_org_id: input.orgId,
    p_company_id: input.companyId,
    p_request_id: input.requestId,
    // ★ 누른 그룹. 안 넘기면 서버가 «맨 위» 그룹을 고른다 — 마이그레이션 140 의 기본값이다.
    //   회사 상세의 「업무 시작」은 그룹을 모르는 자리라 계속 안 넘긴다(동작 그대로).
    p_group_id: input.groupId ?? null,
  });
  if (error) throw new CompanyStartWorkError(error.message || "업무를 시작하지 못했습니다.", error.code);
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row || typeof row.case_id !== "string" || typeof row.item_id !== "string"
      || typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 0
      || typeof row.replayed !== "boolean") {
    throw new CompanyStartWorkError("업무 시작 결과를 확인하지 못했습니다.", undefined, "retryable_unknown");
  }
  return {
    caseId: row.case_id,
    dealId: row.case_id,
    itemId: row.item_id,
    version: row.version,
    replayed: row.replayed,
  };
}
