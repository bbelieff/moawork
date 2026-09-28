/**
 * 상담 서버 액션 — 보호된 상담 RPC 진입점.
 *
 * 기존 boards/actions.ts·contactPipelineActions.ts 를 건드리지 않고
 * 상담 도메인만의 파일을 둔다. 공개 라우트·CTA는 노출하지 않는다.
 * 모든 실패는 막힌 필드 + 제출값 그대로(echo)로 돌려준다.
 */
"use server";

import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ConsultationRpcClient } from "./supabaseConsultation";

async function rpcClient(): Promise<ConsultationRpcClient> {
  return (await createClient()) as unknown as ConsultationRpcClient;
}
import { ConsultationError } from "./errors";
import {
  readConsultationSnapshotOrFail,
  consultationErrorFromRpc,
  setChecklistStep,
  setConsultationMode,
  setConsultationWorkflow,
} from "./service";
import type { ConsultationSnapshot } from "./store";

export type ConsultationActionState = Readonly<{
  ok: boolean;
  message: string;
  /** 막힌 필드 — 입력 보존용. */
  field?: string | null;
  /** 제출값 그대로 — 화면이 복원한다. */
  echo?: Readonly<Record<string, unknown>>;
  version?: number;
  replayed?: boolean;
  ready?: boolean;
  missing?: readonly string[];
  canApproveSeal?: boolean;
  sealApproved?: boolean;
  mode?: string;
  meetingAt?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  /** 인계 가능 시 호출되는 «정식» 파이프라인의 결과. 이 액션이 직접 옮기지 않는다. */
  nextAction?: { kind: "contact_to_work"; dealId: string | null; sourceItemId: string } | null;
}>;

function fail(error: unknown, fallback: string): ConsultationActionState {
  if (error instanceof ConsultationError) {
    return { ok: false, message: error.message, field: error.field, echo: error.echo };
  }
  return { ok: false, message: fallback };
}

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function versionOf(formData: FormData): number | null {
  const raw = String(formData.get("expectedVersion") ?? "").trim();
  if (!raw) return null;
  const version = Number(raw);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

/** 체크리스트 확인/취소 — 순차·무효 전파·히스토리·멱등·낙관적 버전(RPC 원자). */
export async function mutateConsultationChecklist(
  _previous: ConsultationActionState,
  formData: FormData,
): Promise<ConsultationActionState> {
  void _previous;
  try {
    const ctx = await getSession();
    const itemId = text(formData, "itemId");
    const step = text(formData, "step");
    const requestId = text(formData, "requestId");
    const expectedVersion = versionOf(formData);
    const submitted = {
      itemId,
      step,
      confirmed: String(formData.get("confirmed") ?? "true"),
      requestId,
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
    };
    if (!itemId || !step || !requestId || expectedVersion === null) {
      return { ok: false, message: "체크 요청을 다시 시작해 주세요.", echo: submitted };
    }
    const confirmed = String(formData.get("confirmed") ?? "true") !== "false";
    const result = await setChecklistStep(await rpcClient(), {
      orgId: ctx.org.id,
      itemId,
      step,
      confirmed,
      requestId,
      expectedVersion,
    });
    return {
      ok: true,
      message: confirmed ? "확인했습니다." : "확인을 취소했습니다. 뒤 단계도 함께 무효가 됩니다.",
      version: result.version,
      replayed: result.replayed,
      dealId: result.dealId,
      companyId: result.companyId,
    };
  } catch (error) {
    return fail(error, "확인하지 못했습니다.");
  }
}

/** 상담 보기 전환 — remote ↔ inperson, 같은 행·같은 deal 을 공유한다. 일정 필수. */
export async function mutateConsultationMode(
  _previous: ConsultationActionState,
  formData: FormData,
): Promise<ConsultationActionState> {
  void _previous;
  try {
    const ctx = await getSession();
    const itemId = text(formData, "itemId");
    const to = text(formData, "to");
    const requestId = text(formData, "requestId");
    const expectedVersion = versionOf(formData);
    const meetingAt = text(formData, "meetingAt");
    const assigneeId = text(formData, "assigneeId");
    const submitted = { itemId, to, meetingAt, assigneeId, requestId, expectedVersion: String(formData.get("expectedVersion") ?? "") };
    if (!itemId || (to !== "remote" && to !== "inperson") || !requestId || expectedVersion === null) {
      return { ok: false, message: "보기 이동 요청을 다시 시작해 주세요.", echo: submitted };
    }
    const snapshot = await readConsultationSnapshotOrFail(await rpcClient(), {
      orgId: ctx.org.id,
      itemId,
    });
    const result = await setConsultationMode(await rpcClient(), {
      orgId: ctx.org.id,
      itemId,
      from: snapshot.stage,
      to,
      meetingAt,
      assigneeId,
      requestId,
      expectedVersion,
    });
    return {
      ok: true,
      message: "상담 보기를 옮겼습니다.",
      version: result.version,
      replayed: result.replayed,
      mode: result.mode,
      dealId: result.dealId,
      companyId: result.companyId,
    };
  } catch (error) {
    return fail(error, "보기를 옮기지 못했습니다.");
  }
}

/** 스냅샷 읽기 — 모드·버전·일시·체크·준비도·직인·deal/company 실측. 쓰기 없음. */
export async function readConsultationSnapshot(
  itemId: string,
): Promise<ConsultationActionState & { snapshot?: ConsultationSnapshot }> {
  try {
    const ctx = await getSession();
    const snapshot = await readConsultationSnapshotOrFail(await rpcClient(), {
      orgId: ctx.org.id,
      itemId,
    });
    return {
      ok: true,
      message: "상담 기록을 읽었습니다.",
      version: snapshot.version,
      ready: snapshot.ready,
      missing: snapshot.missing,
      mode: snapshot.stage,
      meetingAt: snapshot.meetingAt,
      dealId: snapshot.dealId,
      companyId: snapshot.companyId,
      snapshot,
    };
  } catch (error) {
    return fail(error, "상담 기록을 읽지 못했습니다.");
  }
}

/**
 * 인계 판정 읽기 — 차단 조건을 그대로 돌려준다.
 * 통과해도 이동하지 않는다. 실제 이동은 mutateConsultationHandoff 가
 * 정식 contact_to_work 호출로 수행한다.
 */
export async function readConsultationHandoff(itemId: string): Promise<ConsultationActionState> {
  try {
    const ctx = await getSession();
    const { data, error } = await (await rpcClient()).rpc("read_consultation_handoff_controls", {
      p_org_id: ctx.org.id, p_item_id: itemId,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.ready !== "boolean") throw new Error("Invalid handoff controls");
    const missing: string[] = Array.isArray(result.missing) ? [...result.missing] : [];
    if (!result.seal_approved) missing.push("대표 직인 승인");
    return {
      ok: true, ready: result.ready, version: result.version, missing,
      canApproveSeal: result.can_approve_seal === true, sealApproved: result.seal_approved === true,
      message: result.ready ? "실무로 인계할 수 있습니다." : `인계 조건: ${missing.join(" · ")}`,
    };
  } catch (error) {
    return fail(error, "인계 조건을 확인하지 못했습니다.");
  }
}

/**
 * 명시적 인계 — 버전 확인 뒤 정식 contact_to_work 파이프라인에 위임한다.
 * 활성 상담행의 4완료는 151 래퍼가 같은 트랜잭션 안에서 강제한다.
 */
export async function mutateConsultationHandoff(
  _previous: ConsultationActionState,
  formData: FormData,
): Promise<ConsultationActionState> {
  void _previous;
  try {
    const itemId = text(formData, "itemId");
    const requestId = text(formData, "requestId");
    const expectedVersion = versionOf(formData);
    const submitted = {
      itemId,
      requestId,
      expectedVersion: String(formData.get("expectedVersion") ?? ""),
      companyName: text(formData, "companyName"),
    };
    if (!itemId || !requestId || expectedVersion === null) {
      return { ok: false, message: "인계 요청을 다시 시작해 주세요.", echo: submitted };
    }
    return await executeSealHandoff("handoff", itemId, requestId, expectedVersion, text(formData, "companyName"));
  } catch (error) {
    return fail(error, "인계하지 못했습니다.");
  }
}

/** 상담 단계/예약 변경/취소. RPC가 현재 권한, CAS와 영수증을 원자로 검증한다. */
export async function mutateConsultationWorkflow(_previous: ConsultationActionState, formData: FormData): Promise<ConsultationActionState> {
  const itemId = text(formData, "itemId");
  const requestId = text(formData, "requestId");
  const expectedVersion = versionOf(formData);
  const mode = text(formData, "mode");
  const phase = text(formData, "phase");
  if (!itemId || !requestId || expectedVersion === null || !mode || !phase) return { ok: false, message: "상담 요청을 다시 시작해 주세요." };
  try {
    const ctx = await getSession();
    const result = await setConsultationWorkflow(await rpcClient(), { orgId: ctx.org.id, itemId, requestId, expectedVersion,
      mode, phase, meetingAt: text(formData, "meetingAt"), assigneeId: text(formData, "assigneeId"), cancel: formData.get("cancel") === "true" });
    return { ok: true, message: "상담 기록을 저장했습니다.", version: result.version, replayed: result.replayed, mode: result.mode };
  } catch (error) { return fail(error, "상담 기록을 저장하지 못했습니다."); }
}

async function executeSealHandoff(operation: "seal_approval" | "handoff", itemId: string, requestId: string, expectedVersion: number, companyName: string | null): Promise<ConsultationActionState> {
  const ctx = await getSession();
  try {
    const { data, error } = await (await rpcClient()).rpc("execute_consultation_seal_handoff", {
      p_org_id: ctx.org.id, p_item_id: itemId, p_request_id: requestId,
      p_expected_version: expectedVersion, p_operation: operation, p_company_name: companyName,
    });
    if (error) {
      if (!error.code) throw new Error("Unknown result");
      if (!["42501", "40001", "22023", "22P02"].includes(error.code)) {
        return { ok: false, message: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
      }
      return fail(consultationErrorFromRpc(Object.assign(new Error(error.message), { code: error.code }), { itemId }), "저장하지 못했습니다.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || typeof result.version !== "number" || typeof result.replayed !== "boolean") throw new Error("Unknown result");
    return { ok: true, message: operation === "seal_approval" ? "직인 승인을 기록했습니다." : "업무관리로 인계했습니다.",
      version: result.version, replayed: result.replayed, dealId: result.deal_id, companyId: result.company_id };
  } catch {
    return { ok: false, field: "unknown_result", message: "저장 결과를 확인할 수 없습니다. 같은 요청을 다시 확인해 주세요." };
  }
}

export async function mutateConsultationSeal(_previous: ConsultationActionState, formData: FormData): Promise<ConsultationActionState> {
  const itemId = text(formData, "itemId"); const requestId = text(formData, "requestId"); const expectedVersion = versionOf(formData);
  if (!itemId || !requestId || expectedVersion === null) return { ok: false, message: "승인 요청을 다시 시작해 주세요." };
  return executeSealHandoff("seal_approval", itemId, requestId, expectedVersion, null);
}
