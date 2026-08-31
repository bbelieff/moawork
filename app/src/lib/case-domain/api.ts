import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseId } from "@/lib/types";
import type { ActivityCategoryId, ActivityTypeId } from "./registry";

export type RequestIdentity = { requestId: string };
export type CaseRef = { orgId: string; caseId: CaseId };
/** Boundary-only alias for callers not yet renamed. New APIs always return caseId. */
export type LegacyDealRef = { orgId: string; dealId: string };

export type CanonicalCase = {
  caseId: CaseId;
  /** Legacy rows may be unbound; canonical mutations remain fail-closed. */
  companyId: string | null;
  orgId: string;
  pipelineId: string | null;
  stageId: string | null;
  assignedTo: string | null;
  title: string;
  version: number;
  /** Legacy rows may predate the active board projection invariant. */
  itemId: string | null;
};

export type CaseMutationResult = {
  caseId: CaseId;
  version: number;
  replayed: boolean;
};

export class CaseApiError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`[case/${operation}] ${message}`);
    this.name = "CaseApiError";
  }
}

function rowOf(data: unknown): Record<string, unknown> {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new CaseApiError("decode", undefined, "empty RPC response");
  return row as Record<string, unknown>;
}

function stringOf(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string" || row[key] === "") {
    throw new CaseApiError("decode", undefined, `${key} missing`);
  }
  return row[key] as string;
}

function numberOf(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CaseApiError("decode", undefined, `${key} invalid`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  return row[key] == null ? null : String(row[key]);
}

export class CanonicalCaseApi {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc(operation: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc(operation, args);
    if (error) throw new CaseApiError(operation, error.code, error.message);
    return rowOf(data);
  }

  async read(ref: CaseRef | LegacyDealRef): Promise<CanonicalCase> {
    const caseId = "caseId" in ref ? ref.caseId : ref.dealId;
    const row = await this.rpc("read_case", { p_org_id: ref.orgId, p_case_id: caseId });
    return {
      caseId: stringOf(row, "case_id"),
      companyId: optionalString(row, "company_id"),
      orgId: stringOf(row, "org_id"),
      pipelineId: optionalString(row, "pipeline_id"),
      stageId: optionalString(row, "stage_id"),
      assignedTo: optionalString(row, "assigned_to"),
      title: stringOf(row, "title"),
      version: numberOf(row, "version"),
      itemId: optionalString(row, "item_id"),
    };
  }

  async createForCompany(input: {
    orgId: string;
    companyId: string;
    groupId?: string | null;
  } & RequestIdentity): Promise<CaseMutationResult & { itemId: string }> {
    const row = await this.rpc("create_company_case", {
      p_org_id: input.orgId,
      p_company_id: input.companyId,
      p_request_id: input.requestId,
      p_group_id: input.groupId ?? null,
    });
    return {
      caseId: stringOf(row, "case_id"),
      itemId: stringOf(row, "item_id"),
      version: numberOf(row, "version"),
      replayed: row.replayed === true,
    };
  }

  async appendActivity(input: CaseRef & RequestIdentity & {
    typeId: ActivityTypeId;
    categoryId: ActivityCategoryId;
    content?: string | null;
  }): Promise<{ activityId: string; replayed: boolean }> {
    const row = await this.rpc("append_case_activity", {
      p_org_id: input.orgId,
      p_case_id: input.caseId,
      p_request_id: input.requestId,
      p_type_id: input.typeId,
      p_category_id: input.categoryId,
      p_content: input.content ?? null,
    });
    return { activityId: stringOf(row, "activity_id"), replayed: row.replayed === true };
  }

  async moveStage(input: CaseRef & RequestIdentity & {
    stageId: string;
    expectedVersion: number;
    content?: string | null;
  }): Promise<CaseMutationResult & { activityId: string; stageId: string; pipelineId: string }> {
    const row = await this.rpc("move_case_stage_with_activity", {
      p_org_id: input.orgId,
      p_case_id: input.caseId,
      p_stage_id: input.stageId,
      p_expected_version: input.expectedVersion,
      p_request_id: input.requestId,
      p_content: input.content ?? null,
    });
    return {
      caseId: stringOf(row, "case_id"),
      version: numberOf(row, "version"),
      activityId: stringOf(row, "activity_id"),
      stageId: stringOf(row, "stage_id"),
      pipelineId: stringOf(row, "pipeline_id"),
      replayed: row.replayed === true,
    };
  }

  async mutateChecklist(input: CaseRef & RequestIdentity & {
    expectedVersion: number;
    productId: string | null;
    items: readonly unknown[];
  }): Promise<CaseMutationResult> {
    const row = await this.rpc("mutate_case_checklist", {
      p_org_id: input.orgId,
      p_case_id: input.caseId,
      p_expected_version: input.expectedVersion,
      p_request_id: input.requestId,
      p_product_id: input.productId,
      p_items: input.items,
    });
    return {
      caseId: stringOf(row, "case_id"),
      version: numberOf(row, "version"),
      replayed: row.replayed === true,
    };
  }
}
