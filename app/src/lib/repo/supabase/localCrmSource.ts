import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import {
  getRepo,
  type Repo,
  type CompanyPatch,
  type DealPatch,
  type NewActivity,
  type NewCompany,
  type NewDeal,
} from "@/lib/repo";
import type { CaseTaskMutationInput, CaseTaskMutationResult, CrmSource } from "./source";
import { CaseTaskMutationError, canSeeAll, caseTaskMutationContract } from "./source";
import { db } from "@/lib/repo/local/store";
import { ACTIVITY_TYPES, canonicalActivityType, stageMoveContent } from "@/lib/crm/activity";

type LocalReceipt = {
  operation: "stage";
  actorId: string;
  digest: string;
  result: Deal;
} | {
  operation: "activity";
  actorId: string;
  digest: string;
  result: Activity;
} | {
  operation: "task";
  actorId: string;
  digest: string;
  result: CaseTaskMutationResult;
};
const localReceiptState = globalThis as typeof globalThis & {
  __moaworkCaseReceipts?: Map<string, LocalReceipt>;
};
const receipts = () => (localReceiptState.__moaworkCaseReceipts ??= new Map());
const digest = (value: unknown) => JSON.stringify(value);

/**
 * 공용 동기 `Repo`(인메모리) 를 비동기 포트에 맞춰 감싼 폴백 소스 (T02 · B2).
 *
 * Supabase 환경변수가 없을 때 쓰인다 — 덕분에 연결 전에도 화면이 그대로 돌아가고,
 * 연결 후에는 팩토리에서 구현체만 바뀐다(호출부 무수정).
 * 담당범위 규칙은 감싸는 Repo 안에 이미 있으므로 여기서 중복 적용하지 않는다.
 */
export class LocalCrmSource implements CrmSource {
  readonly kind = "local" as const;

  private readonly repo: Repo;
  constructor(repo?: Repo) {
    if (repo) this.repo = repo;
    else if (process.env.NODE_ENV !== "production") this.repo = getRepo();
    else throw new Error("Local CRM source is disabled in production");
  }

  private canonicalCase(ctx: Ctx, id: string): Deal {
    const current = this.repo.getDeal(ctx, id);
    if (!current?.company_id) throw new Error("case unavailable");
    const company = db().companies.find((row) => row.org_id === ctx.org.id && row.id === current.company_id);
    const mergedInto = (company as typeof company & { merged_into?: string | null } | undefined)?.merged_into;
    const activeProjectionCount = db().boardItems.filter(
      (row) => row.org_id === ctx.org.id && row.deal_id === id && !row.deleted_at,
    ).length;
    if (!company || mergedInto || activeProjectionCount !== 1) throw new Error("case unavailable");
    return current;
  }

  async listPipelines(orgId: string): Promise<Pipeline[]> {
    return this.repo.listPipelines(orgId);
  }
  async listStages(pipelineId: string): Promise<Stage[]> {
    return this.repo.listStages(pipelineId);
  }
  async getStage(stageId: string): Promise<Stage | undefined> {
    return this.repo.getStage(stageId);
  }

  async listCompanies(ctx: Ctx): Promise<Company[]> {
    return this.repo.listCompanies(ctx);
  }
  async getCompany(ctx: Ctx, id: string): Promise<Company | undefined> {
    return this.repo.getCompany(ctx, id);
  }
  async createCompany(ctx: Ctx, input: NewCompany): Promise<Company> {
    return this.repo.createCompany(ctx, input);
  }
  async updateCompany(
    ctx: Ctx,
    id: string,
    patch: CompanyPatch,
  ): Promise<Company | undefined> {
    return this.repo.updateCompany(ctx, id, patch);
  }
  async deleteCompany(ctx: Ctx, id: string): Promise<boolean> {
    return this.repo.deleteCompany(ctx, id);
  }

  async listDeals(ctx: Ctx): Promise<Deal[]> {
    return this.repo.listDeals(ctx);
  }
  async getDeal(ctx: Ctx, id: string): Promise<Deal | undefined> {
    return this.repo.getDeal(ctx, id);
  }
  async createDeal(ctx: Ctx, input: NewDeal): Promise<Deal> {
    void ctx; void input;
    throw new Error("Case 생성은 회사의 canonical 업무 시작 작업만 사용하세요");
  }
  async updateDeal(
    ctx: Ctx,
    id: string,
    patch: DealPatch,
  ): Promise<Deal | undefined> {
    if ("stage_id" in patch) {
      throw new Error("단계 변경은 canonical Case 이동 작업만 사용하세요");
    }
    if ("company_id" in patch || "pipeline_id" in patch || "assigned_to" in patch) {
      throw new Error("Case 소유권 변경은 canonical 전용 작업만 사용하세요");
    }
    return this.repo.updateDeal(ctx, id, patch);
  }
  async reassignDealWithActivity(
    ctx: Ctx,
    id: string,
    assignedTo: string | null,
    activityContent: string,
  ): Promise<Deal | undefined> {
    const current = this.canonicalCase(ctx, id);
    if (!canSeeAll(ctx)) return current;
    if (assignedTo !== null && !db().members.some(
      (member) => member.org_id === ctx.org.id && member.user_id === assignedTo,
    )) {
      throw new Error("assignee is not an active member of this organization");
    }
    if (current.assigned_to === assignedTo) return current;

    // 로컬 저장소는 프로세스 메모리라 실패 지점이 없지만, 원격 RPC와 같은 단일 포트로
    // 노출해 서비스가 update→log 두 단계 쓰기를 다시 만들지 못하게 한다.
    const previousAssignedTo = current.assigned_to;
    const previousUpdatedAt = current.updated_at;
    const previousVersion = current.case_version ?? 0;
    const updated = this.repo.updateDeal(ctx, id, { assigned_to: assignedTo });
    if (!updated) return undefined;
    updated.case_version = previousVersion + 1;
    try {
      this.repo.createActivity(ctx, {
        deal_id: id,
        type: "assignment",
        content: activityContent,
      });
    } catch (error) {
      // 메모리 어댑터도 포트의 원자성 계약을 지킨다. 활동 기록 실패를 주입한 테스트나
      // 향후 로컬 저장 구현에서도 담당자만 바뀐 부분 성공을 남기지 않는다.
      this.repo.updateDeal(ctx, id, { assigned_to: previousAssignedTo });
      current.updated_at = previousUpdatedAt;
      current.case_version = previousVersion;
      throw error;
    }
    return updated;
  }
  async moveDeal(
    ctx: Ctx,
    id: string,
    toStageId: string,
    identity: { requestId: string; expectedVersion: number },
  ): Promise<Deal | undefined> {
    const key = `${ctx.org.id}/${identity.requestId}`;
    const intended = digest({ id, toStageId, expectedVersion: identity.expectedVersion });
    const current = this.canonicalCase(ctx, id);
    const prior = receipts().get(key);
    if (prior) {
      if (prior.operation !== "stage" || prior.actorId !== ctx.user.id || prior.digest !== intended) {
        throw new Error("case move request mismatch");
      }
      return structuredClone(prior.result);
    }
    const to = this.repo.getStage(toStageId);
    if (!to) throw new Error(`단계 이동 불가: 존재하지 않는 단계 (${toStageId})`);
    if (!this.repo.listPipelines(ctx.org.id).some((pipeline) => pipeline.id === to.pipeline_id)) {
      throw new Error("case stage unavailable");
    }
    if ((current.case_version ?? 0) !== identity.expectedVersion) throw new Error("case version conflict");
    const from = current.stage_id ? this.repo.getStage(current.stage_id) : undefined;
    const before = { stage_id: current.stage_id, pipeline_id: current.pipeline_id, updated_at: current.updated_at, case_version: current.case_version };
    const activityCount = db().activities.length;
    try {
      current.stage_id = to.id;
      current.pipeline_id = to.pipeline_id;
      current.case_version = identity.expectedVersion + 1;
      current.updated_at = new Date().toISOString();
      this.repo.createActivity(ctx, {
        deal_id: id,
        type: ACTIVITY_TYPES.status,
        content: stageMoveContent(from?.name ?? null, to.name),
      });
      receipts().set(key, { operation: "stage", actorId: ctx.user.id, digest: intended, result: structuredClone(current) });
      return current;
    } catch (error) {
      Object.assign(current, before);
      db().activities.splice(activityCount);
      throw error;
    }
  }
  async mutateCaseTask(
    ctx: Ctx,
    caseId: string,
    input: CaseTaskMutationInput,
  ): Promise<CaseTaskMutationResult> {
    const contract = caseTaskMutationContract(input);
    const key = `${ctx.org.id}/${contract.requestId}`;
    const intended = digest({ caseId, patch: contract.patch });
    const current = this.canonicalCase(ctx, caseId);
    const prior = receipts().get(key);
    if (prior) {
      if (prior.operation !== "task" || prior.actorId !== ctx.user.id || prior.digest !== intended) {
        throw new CaseTaskMutationError("case task request mismatch", "terminal", "22023");
      }
      return { ...prior.result, replayed: true };
    }

    const before = {
      custom: structuredClone(current.custom ?? {}),
      updatedAt: current.updated_at,
      activityCount: db().activities.length,
    };
    try {
      const storedPatch = input.kind === "complete"
        ? { ...contract.patch, task_completed_at: new Date().toISOString() }
        : contract.patch;
      const updated = this.repo.updateDeal(ctx, caseId, { custom: storedPatch });
      if (!updated) throw new Error("case unavailable");
      const activity = this.repo.createActivity(ctx, {
        deal_id: caseId,
        type: ACTIVITY_TYPES.status,
        content: contract.content,
      });
      const result = { activityId: activity.id, replayed: false };
      receipts().set(key, {
        operation: "task",
        actorId: ctx.user.id,
        digest: intended,
        result,
      });
      return result;
    } catch (error) {
      current.custom = before.custom;
      current.updated_at = before.updatedAt;
      db().activities.splice(before.activityCount);
      receipts().delete(key);
      throw error;
    }
  }
  async deleteDeal(ctx: Ctx, id: string): Promise<boolean> {
    void ctx; void id;
    throw new Error("canonical Case deletion is not supported");
  }

  async listActivities(ctx: Ctx, dealId: string): Promise<Activity[]> {
    return this.repo.listActivities(ctx, dealId);
  }
  async createActivity(ctx: Ctx, input: NewActivity, requestId: string): Promise<Activity> {
    const typeId = canonicalActivityType(input.type);
    if (!typeId) throw new Error(`활동 기록 불가: 지원하지 않는 type (${input.type})`);
    const key = `${ctx.org.id}/${requestId}`;
    const intended = digest({ caseId: input.deal_id, typeId, content: input.content ?? null });
    this.canonicalCase(ctx, input.deal_id);
    const prior = receipts().get(key);
    if (prior) {
      if (prior.operation !== "activity" || prior.actorId !== ctx.user.id || prior.digest !== intended) {
        throw new Error("activity request mismatch");
      }
      return structuredClone(prior.result);
    }
    const activity = this.repo.createActivity(ctx, input);
    receipts().set(key, { operation: "activity", actorId: ctx.user.id, digest: intended, result: structuredClone(activity) });
    return activity;
  }
}
