export interface CompanyStartWorkClient {
  rpc(name: "start_company_work", args: Record<string, unknown>): Promise<{
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

export async function startCompanyWork(
  client: CompanyStartWorkClient,
  input: { orgId: string; companyId: string; requestId: string },
): Promise<CompanyStartWorkResult> {
  const { data, error } = await client.rpc("start_company_work", {
    p_org_id: input.orgId,
    p_company_id: input.companyId,
    p_request_id: input.requestId,
  });
  if (error) throw new CompanyStartWorkError(error.message || "업무를 시작하지 못했습니다.", error.code);
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row || typeof row.deal_id !== "string" || typeof row.item_id !== "string" || typeof row.replayed !== "boolean") {
    throw new CompanyStartWorkError("업무 시작 결과를 확인하지 못했습니다.");
  }
  return { dealId: row.deal_id, itemId: row.item_id, replayed: row.replayed };
}
