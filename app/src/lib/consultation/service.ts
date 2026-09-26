/**
 * 상담 서비스 — 151 RPC 위의 얇은 조정자.
 *
 * 하는 일:
 * - 체크리스트 확인/취소(`check`)와 상담 보기 전환(`mode`)을 RPC 한 트랜잭션으로 보낸다.
 * - 스냅샷·준비도를 읽고, 인계는 버전 확인 뒤 정식 contact_to_work 파이프라인에 위임한다.
 *   활성 상담행의 4완료는 151 래퍼가 같은 트랜잭션 안에서 강제하므로 UI 우회가 없다.
 *
 * 하지 않는 일:
 * - 순차·CAS·replay 판정을 직접 하지 않는다. RPC가 정본이다.
 * - EAV를 쓰지 않는다. 거울 셀을 손으로 채워도 readiness 가 되지 않는다.
 * - 담당자를 직접 바꾸지 않는다. 다른 담당자 값은 lineage 선행 요구로 돌려준다.
 */

import { incompleteSteps, isChecklistComplete } from "./checklist";
import { assertConsultationRequestId, ConsultationError } from "./errors";
import { assertSchedulable, assertStageTransition, canRequestHandoff } from "./stages";
import { executeContactPipelineTransition } from "../crm/supabaseContactPipeline";
import type { ContactPipelineRpcClient } from "../crm/supabaseContactPipeline";
import type {
  ConsultationSnapshot,
  ConsultationTransitionResult,
} from "./store";
import {
  executeConsultationTransition,
  executeConsultationWorkflow,
  readConsultationSnapshot,
  type ConsultationRpcClient,
} from "./supabaseConsultation";

function rpcCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
}

function rpcMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** SQL errcode/메시지를 입력 보존형 ConsultationError 로 바꾼다. */
export function consultationErrorFromRpc(
  error: unknown,
  echo: Readonly<Record<string, unknown>>,
): ConsultationError {
  const code = rpcCode(error);
  const message = rpcMessage(error);
  if (code === "42501") {
    if (message.includes("assignee")) {
      return new ConsultationError("validation", "담당자가 현재 조직의 활성 멤버가 아닙니다.", {
        field: "assigneeId",
        echo,
      });
    }
    return new ConsultationError("not_allowed", "이 건을 변경할 수 없습니다.", { field: "itemId", echo });
  }
  if (code === "40001" || message.includes("version conflict")) {
    return new ConsultationError("conflict", "다른 담당자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.", {
      field: "version",
      echo,
    });
  }
  if (code === "22P02" || message.includes("idempotency key reuse")) {
    return new ConsultationError("invalid_request", "이미 쓴 요청 식별자입니다. 새 요청으로 다시 시도해 주세요.", {
      field: "requestId",
      echo,
    });
  }
  if (code === "22023" || code === "") {
    if (message.includes("checklist blocked")) {
      const step = typeof echo.step === "string" ? echo.step : null;
      return new ConsultationError("checklist_blocked", "앞 단계를 먼저 확인해 주세요.", {
        field: step,
        echo,
      });
    }
    if (message.includes("schedule meeting") || message.includes("meeting required")) {
      return new ConsultationError("validation", "상담 일시를 입력해 주세요. 입력한 내용은 그대로 둡니다.", {
        field: "meetingAt",
        echo,
      });
    }
    if (message.includes("assignee change requires lineage")) {
      return new ConsultationError(
        "validation",
        "담당자 변경은 담당 계보에서 먼저 처리한 뒤 다시 시도해 주세요. 입력한 값은 그대로 둡니다.",
        { field: "assigneeId", echo },
      );
    }
    if (message.includes("schedule assignee")) {
      return new ConsultationError("validation", "담당자를 지정해 주세요. 입력한 내용은 그대로 둡니다.", {
        field: "assigneeId",
        echo,
      });
    }
    if (
      message.includes("new lead transfer") ||
      message.includes("board unavailable") ||
      message.includes("stage unavailable") ||
      message.includes("canonical association") ||
      message.includes("item unavailable")
    ) {
      return new ConsultationError("stage_contract", "지금 단계에서는 상담 기록을 바꿀 수 없습니다.", {
        field: "stage",
        echo,
      });
    }
    if (message.includes("step unsupported") || message.includes("mode unsupported")) {
      return new ConsultationError("invalid_request", "상담 요청이 올바르지 않습니다.", { field: null, echo });
    }
    return new ConsultationError("invalid_request", message || "상담 요청을 다시 시작해 주세요.", {
      field: null,
      echo,
    });
  }
  return new ConsultationError("invalid_request", message || "상담 요청을 다시 시작해 주세요.", {
    field: null,
    echo,
  });
}

async function runTransition(
  client: ConsultationRpcClient,
  args: Parameters<typeof executeConsultationTransition>[1],
  echo: Readonly<Record<string, unknown>>,
): Promise<ConsultationTransitionResult> {
  assertConsultationRequestId(args.requestId);
  try {
    return await executeConsultationTransition(client, args);
  } catch (error) {
    throw consultationErrorFromRpc(error, echo);
  }
}

export async function setChecklistStep(
  client: ConsultationRpcClient,
  input: Readonly<{
    orgId: string;
    itemId: string;
    step: string;
    confirmed: boolean;
    requestId: string;
    expectedVersion: number;
  }>,
): Promise<ConsultationTransitionResult> {
  const echo = { itemId: input.itemId, step: input.step, confirmed: input.confirmed };
  return runTransition(
    client,
    {
      orgId: input.orgId,
      itemId: input.itemId,
      requestId: input.requestId,
      action: "check",
      step: input.step,
      confirmed: input.confirmed,
      expectedVersion: input.expectedVersion,
    },
    echo,
  );
}

export async function setConsultationMode(
  client: ConsultationRpcClient,
  input: Readonly<{
    orgId: string;
    itemId: string;
    from: ConsultationSnapshot["stage"];
    to: ConsultationSnapshot["stage"];
    meetingAt?: string | null;
    assigneeId?: string | null;
    requestId: string;
    expectedVersion: number;
  }>,
): Promise<ConsultationTransitionResult> {
  const echo = {
    itemId: input.itemId,
    from: input.from,
    to: input.to,
    meetingAt: input.meetingAt ?? null,
    assigneeId: input.assigneeId ?? null,
  };
  // F6: 유실 응답 재시도는 RPC 영수증 replay 가 먼저다. from==to(remote|inperson)는
  // 잠재적 replay/noop 이므로 RPC 에 위임하고, 신규리드·위반 전이만 여기서 막는다.
  const sameViewRetry = input.from === input.to && (input.to === "remote" || input.to === "inperson");
  if (!sameViewRetry) {
    assertStageTransition(input.from, input.to);
  }
  if (input.to !== "remote" && input.to !== "inperson") {
    throw new ConsultationError("stage_contract", "상담 보기는 비대면·대면 중에서 고릅니다.", {
      field: "stage",
      echo,
    });
  }
  assertSchedulable({ meetingAt: input.meetingAt ?? null, assigneeId: input.assigneeId ?? null });
  return runTransition(
    client,
    {
      orgId: input.orgId,
      itemId: input.itemId,
      requestId: input.requestId,
      action: "mode",
      mode: input.to,
      meetingAt: input.meetingAt ?? null,
      assigneeId: input.assigneeId ?? null,
      expectedVersion: input.expectedVersion,
    },
    echo,
  );
}

export interface HandoffReadiness {
  itemId: string;
  version: number;
  ready: boolean;
  missing: string[];
  seal: { approved: boolean; detail: string };
  nextAction: { kind: "contact_to_work"; dealId: string | null; sourceItemId: string } | null;
}

export async function readConsultationSnapshotOrFail(
  client: ConsultationRpcClient,
  input: Readonly<{ orgId: string; itemId: string }>,
): Promise<ConsultationSnapshot> {
  try {
    return await readConsultationSnapshot(client, input);
  } catch (error) {
    throw consultationErrorFromRpc(error, { itemId: input.itemId });
  }
}

export async function readHandoffReadiness(
  client: ConsultationRpcClient,
  input: Readonly<{ orgId: string; itemId: string }>,
): Promise<HandoffReadiness> {
  const snapshot = await readConsultationSnapshotOrFail(client, input);
  const stageReady = canRequestHandoff(snapshot.stage);
  const missing = stageReady
    ? [...snapshot.missing]
    : ["상담 단계", ...snapshot.missing.filter((entry) => entry !== "상담 단계")];
  const ready =
    stageReady &&
    snapshot.ready &&
    isChecklistComplete(snapshot.checklist) &&
    incompleteSteps(snapshot.checklist).length === 0;
  return {
    itemId: snapshot.itemId,
    version: snapshot.version,
    ready,
    missing: ready ? [] : missing,
    seal: snapshot.seal,
    nextAction: ready
      ? { kind: "contact_to_work", dealId: snapshot.dealId, sourceItemId: snapshot.itemId }
      : null,
  };
}

/**
 * 명시적 인계 — 버전 확인 뒤 정식 파이프라인에 위임한다.
 * F2: 스냅샷의 정본 deal/company ID 를 보존해 전달한다(deal null 로 새 계약 생성 금지).
 * F6: 준비도 미달이어도 인증된 영수증 replay 를 먼저 시도한다(유실 응답 재시도).
 * 통과해도 이 함수가 행을 옮기지 않는다. 151 래퍼가 같은 트랜잭션 안에서
 * 활성 상담행의 4완료를 강제하므로 직접 파이프라인 호출 우회가 없다.
 */
export async function requestHandoff(
  client: ConsultationRpcClient,
  pipeline: ContactPipelineRpcClient,
  input: Readonly<{
    orgId: string;
    itemId: string;
    requestId: string;
    expectedVersion: number;
    companyId?: string | null;
    companyName?: string | null;
  }>,
): Promise<HandoffReadiness & { dealId: string | null; companyId: string | null }> {
  assertConsultationRequestId(input.requestId);
  const echo = { itemId: input.itemId, expectedVersion: input.expectedVersion };
  const snapshot = await readConsultationSnapshotOrFail(client, {
    orgId: input.orgId,
    itemId: input.itemId,
  });
  if (snapshot.version !== input.expectedVersion) {
    throw new ConsultationError("conflict", "다른 담당자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.", {
      field: "version",
      echo: { ...echo, currentVersion: snapshot.version },
    });
  }
  // F2: 정본 스냅샷의 deal/company 를 그대로 쓴다. 스냅샷 deal 없이는 인계하지 않는다.
  if (!snapshot.dealId) {
    throw new ConsultationError("stage_contract", "지금 단계에서는 상담 기록을 바꿀 수 없습니다.", {
      field: "stage",
      echo,
    });
  }
  const authoritativeCompanyId = snapshot.companyId ?? input.companyId ?? null;
  const pipelineArgs = {
    orgId: input.orgId,
    dealId: snapshot.dealId,
    sourceItemId: input.itemId,
    requestId: input.requestId,
    kind: "contact_to_work" as const,
    companyId: authoritativeCompanyId,
    companyName: input.companyName ?? null,
  };
  const readiness = await readHandoffReadiness(client, { orgId: input.orgId, itemId: input.itemId });
  if (!readiness.ready) {
    // F6: 미달이어도 같은 requestId 의 커밋 replay 를 먼저 확인한다.
    try {
      const replay = await executeContactPipelineTransition(pipeline, pipelineArgs);
      if (replay.status === "committed") {
        return { ...readiness, ready: true, missing: [], dealId: replay.dealId, companyId: replay.companyId };
      }
    } catch {
      // replay 실패는 원래 차단 사유를 우선한다.
    }
    const reasons = [...readiness.missing, ...(readiness.seal.approved ? [] : [readiness.seal.detail])];
    throw new ConsultationError("handoff_blocked", `인계 조건을 먼저 채워 주세요: ${reasons.join(" · ")}`, {
      field: "handoff",
      echo: { ...echo, missing: readiness.missing, sealApproved: readiness.seal.approved },
    });
  }
  let result;
  try {
    result = await executeContactPipelineTransition(pipeline, pipelineArgs);
  } catch (error) {
    throw consultationErrorFromRpc(error, echo);
  }
  if (result.status === "blocked") {
    throw new ConsultationError("handoff_blocked", result.reason ?? "인계 조건을 확인해 주세요.", {
      field: "handoff",
      echo,
    });
  }
  // F2: DB 가 같은 deal 을 돌려주는지 확인한다. 다른 deal 이면 계약 불일치다.
  if (result.dealId !== null && result.dealId !== snapshot.dealId) {
    throw new ConsultationError("stage_contract", "지금 단계에서는 상담 기록을 바꿀 수 없습니다.", {
      field: "stage",
      echo: { ...echo, dealId: result.dealId },
    });
  }
  return { ...readiness, dealId: result.dealId, companyId: result.companyId };
}

export async function setConsultationWorkflow(client: ConsultationRpcClient, input: Parameters<typeof executeConsultationWorkflow>[1]) {
  assertConsultationRequestId(input.requestId);
  try { return await executeConsultationWorkflow(client, input); }
  catch (error) {
    if (!rpcCode(error)) throw new ConsultationError("invalid_request", "저장 결과를 확인할 수 없습니다. 같은 요청을 다시 확인해 주세요.", { field: "unknown_result", echo: input });
    throw consultationErrorFromRpc(error, input);
  }
}
