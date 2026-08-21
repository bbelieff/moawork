import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPhone } from "@/lib/format/phone";
import type {
  CreateNewLeadArgs,
  CreateNewLeadRow,
  NewLeadFieldPatch,
  NewLeadValueSource,
  UpdateNewLeadRow,
} from "./canonical-contract";
import { NEW_LEAD_RPC } from "./canonical-contract";

export class NewLeadMutationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "NewLeadMutationError";
  }
}

function messageFor(code: string | undefined): string {
  if (code === "42501") return "이 신규리드를 저장할 권한이 없습니다.";
  if (code === "40001") return "직접 고친 값이 있어 자동 입력으로 덮어쓰지 않았습니다.";
  if (code === "22023") return "입력 내용과 신규리드 보드를 확인해 주세요.";
  return "신규리드를 저장하지 못했습니다. 다시 시도해 주세요.";
}

function oneRow<T>(data: unknown, required: readonly string[]): T {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || required.some((key) => !(key in row))) {
    throw new NewLeadMutationError("신규리드 저장 결과를 확인하지 못했습니다.");
  }
  return row as T;
}

export function canonicalPhone(value: string | null | undefined): string | null {
  const formatted = formatPhone(value);
  return formatted && formatted !== "확인 필요" ? formatted : null;
}

export async function createCanonicalNewLead(
  client: SupabaseClient,
  input: CreateNewLeadArgs,
): Promise<CreateNewLeadRow> {
  const result = await client.rpc(NEW_LEAD_RPC.create, {
    ...input,
    p_phone: canonicalPhone(input.p_phone),
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<CreateNewLeadRow>(result.data, ["deal_id", "item_id", "replayed"]);
}

export async function updateCanonicalNewLead(
  client: SupabaseClient,
  input: Readonly<{
    orgId: string;
    dealId: string;
    requestId: string;
    patch: NewLeadFieldPatch;
    valueSource?: NewLeadValueSource;
  }>,
): Promise<UpdateNewLeadRow> {
  const patch = { ...input.patch };
  if ("phone" in patch) patch.phone = canonicalPhone(patch.phone);
  const result = await client.rpc(NEW_LEAD_RPC.update, {
    p_org_id: input.orgId,
    p_deal_id: input.dealId,
    p_request_id: input.requestId,
    p_patch: patch,
    p_value_source: input.valueSource ?? "manual",
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<UpdateNewLeadRow>(result.data, ["deal_id", "changed_fields", "replayed"]);
}
