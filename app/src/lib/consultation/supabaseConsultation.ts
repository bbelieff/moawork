import { isConsultationPhase, type ConsultationHistory } from "./phases";
import type { ChecklistState } from "./checklist";
import { blankChecklist } from "./checklist";
import type { ConsultationSnapshot, ConsultationTransitionResult } from "./store";
import type { ConsultationStage } from "./stages";

/** 151 RPC 클라이언트 — Supabase `rpc()` 와 같은 모양이면 된다. */
export type ConsultationRpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
}>;

function row(value: unknown): Record<string, unknown> {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw new Error("상담 결과를 확인할 수 없습니다.");
  }
  return first as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function checklistFrom(value: unknown): ChecklistState {
  const base = blankChecklist();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const source = value as Record<string, { confirmed?: unknown; actor?: unknown; at?: unknown }>;
  for (const step of Object.keys(base) as (keyof ChecklistState)[]) {
    const entry = source[step];
    if (!entry || typeof entry !== "object") continue;
    base[step] = {
      confirmed: entry.confirmed === true,
      actorId: typeof entry.actor === "string" ? entry.actor : null,
      at: typeof entry.at === "string" ? entry.at : null,
    };
  }
  return base;
}

function stageFrom(value: unknown): ConsultationStage {
  return value === "remote" || value === "inperson" ? value : "new_lead";
}

export async function executeConsultationTransition(
  client: ConsultationRpcClient,
  input: Readonly<{
    orgId: string;
    itemId: string;
    requestId: string;
    action: "check" | "mode";
    step?: string | null;
    confirmed?: boolean | null;
    mode?: string | null;
    meetingAt?: string | null;
    assigneeId?: string | null;
    expectedVersion: number;
  }>,
): Promise<ConsultationTransitionResult> {
  const { data, error } = await client.rpc("execute_consultation_transition", {
    p_org_id: input.orgId,
    p_item_id: input.itemId,
    p_request_id: input.requestId,
    p_action: input.action,
    p_step: input.step ?? null,
    p_confirmed: input.confirmed ?? null,
    p_mode: input.mode ?? null,
    p_meeting_at: input.meetingAt ?? null,
    p_assignee: input.assigneeId ?? null,
    p_expected_version: input.expectedVersion,
  });
  if (error) {
    const rpcError = new Error(error.message || "상담을 저장하지 못했습니다.");
    (rpcError as { code?: string }).code = error.code ?? "";
    throw rpcError;
  }
  const value = row(data);
  if (typeof value.version !== "number" || typeof value.replayed !== "boolean") {
    throw new Error("상담 결과 형식이 올바르지 않습니다.");
  }
  const mode = value.mode;
  if (mode !== "remote" && mode !== "inperson") throw new Error("상담 결과 형식이 올바르지 않습니다.");
  return {
    itemId: String(value.item_id),
    dealId: typeof value.deal_id === "string" ? value.deal_id : null,
    companyId: typeof value.company_id === "string" ? value.company_id : null,
    mode,
    version: value.version,
    replayed: value.replayed,
  };
}

export async function readConsultationSnapshot(
  client: ConsultationRpcClient,
  input: Readonly<{ orgId: string; itemId: string }>,
): Promise<ConsultationSnapshot> {
  const { data, error } = await client.rpc("read_consultation_snapshot_v2", {
    p_org_id: input.orgId,
    p_item_id: input.itemId,
  });
  if (error) {
    const rpcError = new Error(error.message || "상담 기록을 읽지 못했습니다.");
    (rpcError as { code?: string }).code = error.code ?? "";
    throw rpcError;
  }
  const value = row(data);
  const missing = Array.isArray(value.missing)
    ? value.missing.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    itemId: String(value.item_id),
    dealId: typeof value.deal_id === "string" ? value.deal_id : null,
    companyId: typeof value.company_id === "string" ? value.company_id : null,
    boardSource: text(value.board_source),
    stage: stageFrom(value.mode),
    version: typeof value.version === "number" ? value.version : 0,
    meetingAt: text(value.meeting_at),
    phase: isConsultationPhase(value.phase) ? value.phase : undefined,
    assigneeId: text(value.assignee_id),
    history: Array.isArray(value.history) ? value.history as ConsultationHistory[] : [],
    checklist: checklistFrom(value.checklist),
    ready: value.ready === true,
    missing,
    seal: {
      approved: value.seal_approved === true,
      detail: text(value.seal_detail) ?? "",
    },
    dealStageKind: text(value.deal_stage_kind),
  };
}

/** 156 workflow is additive; all existing 151 write signatures stay available. */
export async function executeConsultationWorkflow(client: ConsultationRpcClient, input: Readonly<{
  orgId: string; itemId: string; requestId: string; expectedVersion: number;
  mode: string; phase: string; meetingAt: string | null; assigneeId: string | null; cancel: boolean;
}>): Promise<ConsultationTransitionResult> {
  const { data, error } = await client.rpc("execute_consultation_workflow", {
    p_org_id: input.orgId, p_item_id: input.itemId, p_request_id: input.requestId,
    p_expected_version: input.expectedVersion, p_mode: input.mode, p_phase: input.phase,
    p_meeting_at: input.meetingAt, p_assignee: input.assigneeId, p_cancel: input.cancel,
  });
  if (error) throw Object.assign(new Error(error.message || "상담 저장 결과를 확인하지 못했습니다."), { code: error.code });
  const value = row(data);
  if ((value.mode !== "remote" && value.mode !== "inperson") || typeof value.version !== "number" || typeof value.replayed !== "boolean") {
    throw new Error("상담 저장 결과를 확인하지 못했습니다.");
  }
  return { itemId: String(value.item_id), dealId: text(value.deal_id), companyId: text(value.company_id),
    mode: value.mode, version: value.version, replayed: value.replayed };
}
