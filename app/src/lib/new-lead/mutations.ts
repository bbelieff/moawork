import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPhone } from "@/lib/format/phone";
import type {
  CreateNewLeadArgs,
  CreateNewLeadRow,
  CreateNewLeadWithFoundedMonthArgs,
  NewLeadFieldPatch,
  NewLeadValueSource,
  OcrCompanyBizNoRow,
  OcrCompanyNameSyncRow,
  OcrPrecompanyMetaRow,
  OcrPrecompanyPatch,
  UpdateNewLeadRow,
  UpdateNewLeadTitleRow,
  UpdateNewLeadMetaRow,
} from "./canonical-contract";
import { NEW_LEAD_RPC } from "./canonical-contract";

export class NewLeadMutationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "NewLeadMutationError";
  }
}

export async function updateCanonicalNewLeadTitle(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; dealId: string; requestId: string; title: string; valueSource?: NewLeadValueSource }>,
): Promise<UpdateNewLeadTitleRow> {
  const result = await client.rpc(NEW_LEAD_RPC.updateTitle, {
    p_org_id: input.orgId, p_deal_id: input.dealId, p_request_id: input.requestId,
    p_title: input.title.trim(), p_value_source: input.valueSource ?? "manual",
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<UpdateNewLeadTitleRow>(result.data, ["deal_id", "item_id", "replayed"]);
}

export async function updateCanonicalNewLeadMeta(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; dealId: string; requestId: string; patch: Record<string, unknown> }>,
): Promise<UpdateNewLeadMetaRow> {
  const result = await client.rpc(NEW_LEAD_RPC.updateMeta, {
    p_org_id: input.orgId, p_deal_id: input.dealId, p_request_id: input.requestId, p_patch: input.patch,
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<UpdateNewLeadMetaRow>(result.data, ["deal_id", "item_id", "changed_fields", "replayed"]);
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

export function canonicalAssignee(actorId: string, selectedId: string | null | undefined): string | null {
  const selected = selectedId?.trim();
  return selected && selected !== actorId ? selected : null;
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

/**
 * 창업연월 포함 원자 생성(v17-detail-repair).
 * 월 형식·컬럼 존재를 서버 wrapper가 어떤 INSERT보다 먼저 판정하고,
 * 같은 트랜잭션·같은 요청 payload에 넣어 기록한다. 기존 create RPC는 그대로 둔다.
 */
export async function createCanonicalNewLeadWithFoundedMonth(
  client: SupabaseClient,
  input: CreateNewLeadWithFoundedMonthArgs,
): Promise<CreateNewLeadRow> {
  const result = await client.rpc(NEW_LEAD_RPC.createWithFoundedMonth, {
    ...input,
    p_phone: canonicalPhone(input.p_phone),
    p_founded_month: input.p_founded_month ?? null,
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<CreateNewLeadRow>(result.data, ["deal_id", "item_id", "replayed"]);
}

/**
 * 154 초안(미적용) intake meta — 생년월일/종목/미연계 사업자번호의
 * 회사-생기기-전 보관분. 마이그레이션 적용 전에는 RPC 부재 오류(코드 없음·
 * 메시지는 그대로)로 실패하며 조용히 성공하지 않는다.
 */
export async function updateOcrPrecompanyMeta(
  client: SupabaseClient,
  input: Readonly<{
    orgId: string;
    dealId: string;
    requestId: string;
    patch: OcrPrecompanyPatch;
    valueSource?: NewLeadValueSource;
  }>,
): Promise<OcrPrecompanyMetaRow> {
  const result = await client.rpc(NEW_LEAD_RPC.ocrMeta, {
    p_org_id: input.orgId,
    p_deal_id: input.dealId,
    p_request_id: input.requestId,
    p_patch: input.patch,
    p_value_source: input.valueSource ?? "manual",
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<OcrPrecompanyMetaRow>(result.data, ["deal_id", "item_id", "changed_fields", "replayed"]);
}

/**
 * 154 초안(미적용) — 연계된 회사 원본의 사업자번호 동기화.
 * confirmed가 false면 호출하지 않는다 (서버도 22023으로 막는다).
 * 회사 신규 생성·재연계는 하지 않는다.
 */
export async function updateLinkedCompanyBizNo(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; dealId: string; requestId: string; bizNo: string; confirmed: boolean }>,
): Promise<OcrCompanyBizNoRow> {
  if (!input.confirmed) {
    throw new NewLeadMutationError("사업자등록번호는 체크섬 통과와 사용자 확정이 함께 있어야 저장됩니다.", "22023");
  }
  const result = await client.rpc(NEW_LEAD_RPC.companyBizNo, {
    p_org_id: input.orgId,
    p_deal_id: input.dealId,
    p_request_id: input.requestId,
    p_biz_no: input.bizNo,
    p_confirmed: true,
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<OcrCompanyBizNoRow>(result.data, ["deal_id", "company_id", "replayed"]);
}

/**
 * 154 초안(미적용) — 연계 회사명 정정.
 * confirmed(사용자 선택 확정)가 false면 호출하지 않는다 (서버도 22023).
 * expected는 비교 화면에서 본 이전 회사명이다 — 빈 문자열이면 "비어 있었음"
 * 관찰이며, null이면 비교 기준 없이 저장하지 않는다 (서버도 22023).
 * 확정+CAS 일치가 있으면 틀린 원본을 갱신한다. 생성·재연계·자동 병합 없음.
 */
export async function syncLinkedCompanyName(
  client: SupabaseClient,
  input: Readonly<{ orgId: string; dealId: string; requestId: string; title: string; expected: string | null; confirmed: boolean }>,
): Promise<OcrCompanyNameSyncRow> {
  if (!input.confirmed) {
    throw new NewLeadMutationError("연계 회사명은 비교 화면에서 확인해야 저장됩니다.", "22023");
  }
  const result = await client.rpc(NEW_LEAD_RPC.companyNameSync, {
    p_org_id: input.orgId,
    p_deal_id: input.dealId,
    p_request_id: input.requestId,
    p_title: input.title.trim(),
    p_expected: input.expected,
    p_confirmed: true,
  });
  if (result.error) throw new NewLeadMutationError(messageFor(result.error.code), result.error.code);
  return oneRow<OcrCompanyNameSyncRow>(result.data, ["deal_id", "company_id", "skipped", "replayed"]);
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
