import type { Company, Ctx, Deal, StageKind } from "@/lib/types";
import type { NewCompany } from "@/lib/repo";

export const CONTACT_MOVE_LABEL = "컨택 이동";
export const WORK_MOVE_LABEL = "업무관리 이동";
export const SEAL_APPROVAL_KEY = "seal_approval";
export const SEAL_APPROVED_VALUE = "완료";

const MARKER_KEY = "contact_pipeline_transition";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;

export type ContactTransitionKind = "lead_to_contact" | "contact_to_work";
export type ContactRequestStatus =
  | "committed"
  | "rejected"
  | "failed"
  | "rolled_back"
  | "repair_required";

type PipelineStage = Readonly<{
  id: string;
  pipeline_id: string;
  kind: StageKind;
}>;

export class ContactPipelineError extends Error {
  constructor(
    readonly code:
      | "invalid_request"
      | "not_allowed"
      | "stage_contract"
      | "seal_required"
      | "conflict"
      | "rollback_failed",
    message: string,
  ) {
    super(message);
    this.name = "ContactPipelineError";
  }
}

/**
 * CRM CRUD와 별개로 requestId 및 진행 중 dealId를 DB unique/CAS로 예약해야 한다.
 * read-before-write 또는 프로세스 메모리 잠금 구현은 이 포트를 만족하지 않는다.
 */
export interface ContactPipelineSource {
  listPipelines(ctx: Ctx): Promise<ReadonlyArray<{ id: string; stages: PipelineStage[] }>>;
  getDeal(ctx: Ctx, id: string): Promise<Deal>;
  getCompany(ctx: Ctx, id: string): Promise<Company>;
  createCompany(ctx: Ctx, input: NewCompany): Promise<Company>;
  deleteCompany(ctx: Ctx, id: string): Promise<void>;
  updateDeal(
    ctx: Ctx,
    id: string,
    patch: { company_id?: string | null; custom?: Record<string, unknown> },
  ): Promise<Deal>;
  moveDealStage(ctx: Ctx, id: string, toStageId: string): Promise<Deal>;
  beginContactPipelineRequest(
    ctx: Ctx,
    input: { requestId: string; dealId: string; kind: ContactTransitionKind },
  ): Promise<
    | { state: "acquired" }
    | { state: "busy" }
    | {
        state: "replay";
        status: ContactRequestStatus;
        errorCode: ContactPipelineError["code"] | null;
      }
  >;
  finishContactPipelineRequest(
    ctx: Ctx,
    input: {
      requestId: string;
      dealId: string;
      kind: ContactTransitionKind;
      status: ContactRequestStatus;
      errorCode: ContactPipelineError["code"] | null;
    },
  ): Promise<void>;
  /**
   * 단계·업체 링크·신규 업체 삭제·marker·request 상태를 한 DB transaction에서 되돌린다.
   * 실패 시 고객 데이터는 committed 상태 그대로이고 request만 repair_required로 종결돼야 한다.
   */
  rollbackContactPipelineTransition(
    ctx: Ctx,
    input: {
      requestId: string;
      dealId: string;
      marker: TransitionMarker;
    },
  ): Promise<{
    state: "rolled_back" | "replay" | "repair_required";
    deal: Deal;
  }>;
}

export type ContactTransitionResult = Readonly<{
  deal: Deal;
  replayed: boolean;
  kind: ContactTransitionKind;
}>;

export type TransitionMarker = Readonly<{
  version: 1;
  requestId: string;
  kind: ContactTransitionKind;
  fromStageId: string;
  toStageId: string;
  previousCompanyId: string | null;
  companyId: string | null;
  companyCreated: boolean;
  status: "committed" | "rolled_back";
}>;

const SPECS: Record<ContactTransitionKind, { from: StageKind; to: StageKind }> = {
  lead_to_contact: { from: "marketing", to: "meeting" },
  contact_to_work: { from: "meeting", to: "work" },
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function markerFrom(deal: Deal): TransitionMarker | null {
  const value = record(deal.custom[MARKER_KEY]);
  if (!value) return null;
  if (
    value.version !== 1 ||
    typeof value.requestId !== "string" ||
    (value.kind !== "lead_to_contact" && value.kind !== "contact_to_work") ||
    typeof value.fromStageId !== "string" ||
    typeof value.toStageId !== "string" ||
    !(typeof value.previousCompanyId === "string" || value.previousCompanyId === null) ||
    !(typeof value.companyId === "string" || value.companyId === null) ||
    typeof value.companyCreated !== "boolean" ||
    (value.status !== "committed" && value.status !== "rolled_back")
  ) {
    throw new ContactPipelineError("conflict", "저장된 이동 기록을 확인할 수 없습니다.");
  }
  return value as unknown as TransitionMarker;
}

function assertRequestId(requestId: string): void {
  if (!REQUEST_ID.test(requestId)) {
    throw new ContactPipelineError("invalid_request", "요청 식별자가 올바르지 않습니다.");
  }
}

function exactStage(
  pipelines: Awaited<ReturnType<ContactPipelineSource["listPipelines"]>>,
  pipelineId: string,
  kind: StageKind,
): PipelineStage {
  const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);
  const matches = pipeline?.stages.filter((stage) => stage.kind === kind) ?? [];
  if (matches.length !== 1) {
    throw new ContactPipelineError("stage_contract", "이동할 단계를 하나로 확인할 수 없습니다.");
  }
  return matches[0];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function newCompanyFrom(deal: Deal): NewCompany {
  const name = text(deal.title);
  if (!name) {
    throw new ContactPipelineError("invalid_request", "업체명이 없어 업무로 이동할 수 없습니다.");
  }
  return {
    name,
    biz_type: text(deal.custom.biz_type),
    region: text(deal.custom.region),
    owner_name: text(deal.custom.owner_name),
    phone: text(deal.custom.phone),
    email: text(deal.custom.email),
    revenue: finiteNumber(deal.custom.revenue),
    assigned_to: deal.assigned_to,
  };
}

async function mappedFields(
  source: ContactPipelineSource,
  ctx: Ctx,
  deal: Deal,
): Promise<Readonly<Record<string, unknown>>> {
  const company = deal.company_id ? await source.getCompany(ctx, deal.company_id) : null;
  return {
    adName: deal.custom.ad_name ?? null,
    appliedOn: deal.applied_on,
    phone: company?.phone ?? deal.custom.phone ?? null,
    ownerName: company?.owner_name ?? deal.custom.owner_name ?? null,
    revenue: company?.revenue ?? deal.custom.revenue ?? null,
    email: company?.email ?? deal.custom.email ?? null,
    assignedTo: deal.assigned_to,
  };
}

function sameRecord(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function bestEffortCompensation(
  source: ContactPipelineSource,
  ctx: Ctx,
  dealId: string,
  fromStageId: string,
  previousCompanyId: string | null,
  createdCompanyId: string | null,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    const current = await source.getDeal(ctx, dealId);
    if (current.stage_id !== fromStageId) await source.moveDealStage(ctx, dealId, fromStageId);
  } catch (error) {
    failures.push(error);
  }
  try {
    await source.updateDeal(ctx, dealId, {
      company_id: previousCompanyId,
      custom: { [MARKER_KEY]: null },
    });
  } catch (error) {
    failures.push(error);
  }
  if (createdCompanyId) {
    try {
      await source.deleteCompany(ctx, createdCompanyId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new ContactPipelineError("rollback_failed", "이동을 되돌리지 못했습니다. 관리자 확인이 필요합니다.");
  }
}

function replayResult(
  deal: Deal,
  kind: ContactTransitionKind,
  requestId: string,
): ContactTransitionResult {
  const marker = markerFrom(deal);
  if (
    !marker ||
    marker.requestId !== requestId ||
    marker.kind !== kind ||
    marker.status !== "committed" ||
    deal.stage_id !== marker.toStageId ||
    deal.company_id !== marker.companyId
  ) {
    throw new ContactPipelineError("conflict", "같은 요청의 저장 상태가 일치하지 않습니다.");
  }
  return { deal, replayed: true, kind };
}

export async function moveContactPipeline(
  source: ContactPipelineSource,
  ctx: Ctx,
  input: Readonly<{ dealId: string; kind: ContactTransitionKind; requestId: string }>,
): Promise<ContactTransitionResult> {
  assertRequestId(input.requestId);
  const initial = await source.getDeal(ctx, input.dealId);
  if (initial.org_id !== ctx.org.id) {
    throw new ContactPipelineError("not_allowed", "이 건을 이동할 수 없습니다.");
  }

  const reservation = await source.beginContactPipelineRequest(ctx, input);
  if (reservation.state === "busy") {
    throw new ContactPipelineError("conflict", "같은 건의 이동이 이미 처리 중입니다.");
  }
  if (reservation.state === "replay") {
    if (reservation.status === "committed") return replayResult(initial, input.kind, input.requestId);
    if (reservation.status === "rejected" && reservation.errorCode === "seal_required") {
      throw new ContactPipelineError("seal_required", "대표 직인 승인이 완료되어야 업무로 이동할 수 있습니다.");
    }
    throw new ContactPipelineError("conflict", "이미 종료된 요청입니다. 새 요청으로 다시 시도해 주세요.");
  }

  let requestFinished = false;
  const finish = async (
    status: "committed" | "rejected" | "failed",
    errorCode: ContactPipelineError["code"] | null,
  ) => {
    await source.finishContactPipelineRequest(ctx, { ...input, status, errorCode });
    requestFinished = true;
  };

  try {
    const previous = markerFrom(initial);
    if (previous?.status === "committed") {
      throw new ContactPipelineError("conflict", "먼저 이전 이동을 되돌리거나 새 화면에서 다시 시도해 주세요.");
    }
    if (!initial.pipeline_id || !initial.stage_id) {
      throw new ContactPipelineError("stage_contract", "현재 단계를 확인할 수 없습니다.");
    }

    const pipelines = await source.listPipelines(ctx);
    const spec = SPECS[input.kind];
    const from = exactStage(pipelines, initial.pipeline_id, spec.from);
    const to = exactStage(pipelines, initial.pipeline_id, spec.to);
    if (from.id !== initial.stage_id) {
      throw new ContactPipelineError("stage_contract", "현재 단계에서는 이 이동을 할 수 없습니다.");
    }

    if (input.kind === "contact_to_work" && initial.custom[SEAL_APPROVAL_KEY] !== SEAL_APPROVED_VALUE) {
      await finish("rejected", "seal_required");
      throw new ContactPipelineError("seal_required", "대표 직인 승인이 완료되어야 업무로 이동할 수 있습니다.");
    }

    const beforeFields = await mappedFields(source, ctx, initial);
    let companyId = initial.company_id;
    let createdCompanyId: string | null = null;
    try {
      if (input.kind === "contact_to_work" && !companyId) {
        const company = await source.createCompany(ctx, newCompanyFrom(initial));
        if (company.org_id !== ctx.org.id) {
          throw new ContactPipelineError("not_allowed", "생성된 업체의 회사 범위를 확인할 수 없습니다.");
        }
        companyId = company.id;
        createdCompanyId = company.id;
        await source.updateDeal(ctx, initial.id, { company_id: company.id });
      }

      const moved = await source.moveDealStage(ctx, initial.id, to.id);
      const afterFields = await mappedFields(source, ctx, moved);
      if (input.kind === "lead_to_contact" && !sameRecord(beforeFields, afterFields)) {
        throw new ContactPipelineError("conflict", "컨택 이동 중 기본정보 보존 확인에 실패했습니다.");
      }

      const marker: TransitionMarker = {
        version: 1,
        requestId: input.requestId,
        kind: input.kind,
        fromStageId: from.id,
        toStageId: to.id,
        previousCompanyId: initial.company_id,
        companyId,
        companyCreated: createdCompanyId !== null,
        status: "committed",
      };
      const committed = await source.updateDeal(ctx, initial.id, {
        company_id: companyId,
        custom: { [MARKER_KEY]: marker },
      });
      if (committed.stage_id !== to.id || committed.company_id !== companyId) {
        throw new ContactPipelineError("conflict", "이동 결과를 확인할 수 없습니다.");
      }
      await finish("committed", null);
      return { deal: committed, replayed: false, kind: input.kind };
    } catch (error) {
      await bestEffortCompensation(source, ctx, initial.id, from.id, initial.company_id, createdCompanyId);
      throw error;
    }
  } catch (error) {
    if (!requestFinished) {
      const code = error instanceof ContactPipelineError ? error.code : "conflict";
      await finish("failed", code);
    }
    throw error;
  }
}

export async function rollbackContactPipeline(
  source: ContactPipelineSource,
  ctx: Ctx,
  input: Readonly<{ dealId: string; requestId: string }>,
): Promise<ContactTransitionResult> {
  assertRequestId(input.requestId);
  const deal = await source.getDeal(ctx, input.dealId);
  if (deal.org_id !== ctx.org.id) {
    throw new ContactPipelineError("not_allowed", "이 건을 되돌릴 수 없습니다.");
  }
  const marker = markerFrom(deal);
  if (!marker || marker.requestId !== input.requestId) {
    throw new ContactPipelineError("conflict", "되돌릴 이동 기록을 확인할 수 없습니다.");
  }
  if (
    marker.status === "committed" &&
    (deal.stage_id !== marker.toStageId || deal.company_id !== marker.companyId)
  ) {
    throw new ContactPipelineError("conflict", "현재 상태가 이동 기록과 달라 되돌릴 수 없습니다.");
  }
  if (
    marker.status === "rolled_back" &&
    (deal.stage_id !== marker.fromStageId || deal.company_id !== marker.previousCompanyId)
  ) {
    throw new ContactPipelineError("conflict", "되돌린 상태가 이동 기록과 일치하지 않습니다.");
  }

  const outcome = await source.rollbackContactPipelineTransition(ctx, {
    requestId: input.requestId,
    dealId: input.dealId,
    marker,
  });
  if (outcome.state === "repair_required") {
    throw new ContactPipelineError("rollback_failed", "되돌리기를 완료하지 못했습니다. 관리자 확인이 필요합니다.");
  }
  if (
    outcome.deal.stage_id !== marker.fromStageId ||
    outcome.deal.company_id !== marker.previousCompanyId ||
    markerFrom(outcome.deal)?.status !== "rolled_back"
  ) {
    throw new ContactPipelineError("rollback_failed", "되돌린 결과를 확인할 수 없습니다.");
  }
  return { deal: outcome.deal, replayed: outcome.state === "replay", kind: marker.kind };
}
