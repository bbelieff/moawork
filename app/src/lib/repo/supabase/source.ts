import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import type { NewActivity, NewCompany, NewDeal, CompanyPatch, DealPatch } from "@/lib/repo";

/**
 * core.crm 비동기 데이터 소스 포트 (T02 소유).
 *
 * ── 왜 공용 `Repo`(@/lib/repo) 를 그대로 쓰지 않는가 ──
 * 공용 포트는 **동기**다(`listDeals(ctx): Deal[]`). 인메모리 구현에는 맞지만 Supabase 는
 * 네트워크 I/O라 본질적으로 비동기다. 공용 계약 파일(`lib/repo/index.ts`)은 T03 단독 소유이고
 * 동기→비동기 전환은 모든 소비 트랙(T04·T05·T09)을 건드리는 광역 변경이라, 여기서는
 * **별도 비동기 포트**를 두고 구현체만 스왑한다(계약 파일 무수정).
 *
 * 공용 포트가 비동기로 전환되면 이 포트는 그대로 흡수된다 — 시그니처를 일부러 동일하게 맞췄다
 * (인자 순서·이름·반환 도메인 타입 모두 `Repo` 와 1:1, 차이는 Promise 래핑뿐).
 */
export interface CrmSource {
  /** 이 소스가 실제 Supabase 를 보는지(false = 로컬 폴백). 화면 배지 표시용. */
  readonly kind: "supabase" | "local";

  // 파이프라인 / 단계 (조직 공용 — 담당범위 무관)
  listPipelines(orgId: string): Promise<Pipeline[]>;
  listStages(pipelineId: string): Promise<Stage[]>;
  getStage(stageId: string): Promise<Stage | undefined>;

  // 고객사 (담당범위 적용)
  listCompanies(ctx: Ctx): Promise<Company[]>;
  getCompany(ctx: Ctx, id: string): Promise<Company | undefined>;
  createCompany(ctx: Ctx, input: NewCompany): Promise<Company>;
  updateCompany(ctx: Ctx, id: string, patch: CompanyPatch): Promise<Company | undefined>;
  /** 보이지 않는 리소스는 false(존재 유출 방지) — 공용 포트와 동일 규약. */
  deleteCompany(ctx: Ctx, id: string): Promise<boolean>;

  // 딜 (담당범위 적용)
  listDeals(ctx: Ctx): Promise<Deal[]>;
  getDeal(ctx: Ctx, id: string): Promise<Deal | undefined>;
  createDeal(ctx: Ctx, input: NewDeal): Promise<Deal>;
  /** 부분수정. `custom` 은 키 단위 병합(공용 `DealPatch` 규약과 동일). */
  updateDeal(ctx: Ctx, id: string, patch: DealPatch): Promise<Deal | undefined>;
  /** 담당자 변경과 assignment 활동기록을 하나의 원자 작업으로 저장한다. */
  reassignDealWithActivity(
    ctx: Ctx,
    id: string,
    assignedTo: string | null,
    activityContent: string,
  ): Promise<Deal | undefined>;
  /** 단계 이동 + 활동로그 — stage_id 를 바꾸는 유일한 경로(공용 `Repo.moveDeal` 과 동일). */
  moveDeal(
    ctx: Ctx,
    id: string,
    toStageId: string,
    identity: { requestId: string; expectedVersion: number },
  ): Promise<Deal | undefined>;
  /** 오늘 할 일 custom patch + status Activity를 request receipt와 함께 원자 저장한다. */
  mutateCaseTask(
    ctx: Ctx,
    caseId: string,
    input: CaseTaskMutationInput,
  ): Promise<CaseTaskMutationResult>;
  deleteDeal(ctx: Ctx, id: string): Promise<boolean>;

  // 활동기록
  listActivities(ctx: Ctx, dealId: string): Promise<Activity[]>;
  createActivity(ctx: Ctx, input: NewActivity, requestId: string): Promise<Activity>;
}

export type CaseTaskMutationInput =
  | { kind: "complete"; requestId: string }
  | { kind: "postpone"; dueDate: string; requestId: string };

export type CaseTaskMutationResult = {
  activityId: string;
  replayed: boolean;
};

export type CaseTaskMutationFailureOutcome = "retryable_unknown" | "terminal";

const TERMINAL_CASE_TASK_CODES = new Set(["22023", "40001", "42501"]);

export class CaseTaskMutationError extends Error {
  constructor(
    message: string,
    readonly outcome: CaseTaskMutationFailureOutcome,
    readonly code?: string,
  ) {
    super(message);
    this.name = "CaseTaskMutationError";
  }
}

function nestedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("cause" in error)) return undefined;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return undefined;
  return typeof cause.code === "string" ? cause.code : undefined;
}

/** RPC의 권위 있는 terminal code만 intent를 폐기한다. 전송/응답 불명은 동일 requestId로 재확인한다. */
export function toCaseTaskMutationError(error: unknown): CaseTaskMutationError {
  if (error instanceof CaseTaskMutationError) return error;
  const code = nestedErrorCode(error);
  const message = error instanceof Error ? error.message : "task mutation outcome unavailable";
  return new CaseTaskMutationError(
    message,
    code && TERMINAL_CASE_TASK_CODES.has(code) ? "terminal" : "retryable_unknown",
    code,
  );
}

export function shouldRetryCaseTaskMutation(error: unknown): boolean {
  return toCaseTaskMutationError(error).outcome === "retryable_unknown";
}

export type CaseTaskMutationContract = {
  requestId: string;
  patch: Record<string, string | null>;
  content: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Local/Supabase가 같은 whitelist, digest payload, Activity 문구를 쓰게 하는 순수 계약. */
export function caseTaskMutationContract(input: CaseTaskMutationInput): CaseTaskMutationContract {
  if (!UUID.test(input.requestId)) {
    throw new CaseTaskMutationError("task mutation requestId is required", "terminal", "22023");
  }
  if (input.kind === "complete") {
    return {
      requestId: input.requestId,
      patch: {
        task_status: "done",
      },
      content: "오늘 할 일을 완료했어요",
    };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.dueDate)) {
    throw new CaseTaskMutationError("task dueDate is invalid", "terminal", "22023");
  }
  const parsed = new Date(`${input.dueDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.dueDate) {
    throw new CaseTaskMutationError("task dueDate is invalid", "terminal", "22023");
  }
  return {
    requestId: input.requestId,
    patch: {
      due_date: input.dueDate,
      task_status: null,
      task_completed_at: null,
    },
    content: `오늘 할 일을 ${input.dueDate}로 연기했어요`,
  };
}

/**
 * 담당범위 규칙 — 로컬 구현(`repo/local/localRepo.ts`)과 **동일해야 한다**.
 * owner/admin 또는 scope='all' → 조직 전체, 그 외(member+assigned) → 본인 담당만.
 *
 * Supabase 에서는 RLS 가 최종 방어선이지만(소유 T03), 쿼리 단에서도 같은 조건을 걸어
 * 로컬↔원격 결과가 어긋나지 않게 한다(RLS 미적용 상태에서도 동작 동일).
 */
export function canSeeAll(ctx: Ctx): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}
