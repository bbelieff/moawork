import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import type {
  CompanyPatch,
  DealPatch,
  NewActivity,
  NewCompany,
  NewDeal,
} from "@/lib/repo";
import { mergeCustom } from "@/lib/repo/custom-merge";
import {
  canSeeAll,
  caseTaskMutationContract,
  type CaseTaskMutationInput,
  type CaseTaskMutationResult,
  type CrmSource,
} from "./source";
import { CanonicalCaseApi } from "@/lib/case-domain/api";
import { canonicalActivityType } from "@/lib/crm/activity";

/**
 * 001_schema_v1 정본 테이블에 직접 붙는 core.crm 소스 (T02 · B2).
 *
 * 테이블/컬럼은 001 을 그대로 따른다 — companies · pipelines · stages · deals · activities.
 * 새 테이블을 만들지 않는다(스키마 소유 = 기획).
 */

/** PostgREST 오류를 호출부에서 알아볼 수 있는 형태로 올린다. */
export class SupabaseCrmError extends Error {
  constructor(
    readonly op: string,
    readonly cause: { message: string; code?: string },
  ) {
    super(`[crm/${op}] ${cause.message}`);
    this.name = "SupabaseCrmError";
  }
}

/** numeric 은 드라이버/설정에 따라 문자열로 올 수 있어 숫자로 좁힌다. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

type Row = Record<string, unknown>;

function toCompany(r: Row): Company {
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    name: String(r.name),
    biz_type: str(r.biz_type),
    region: str(r.region),
    owner_name: str(r.owner_name),
    phone: str(r.phone),
    email: str(r.email),
    revenue: num(r.revenue),
    founded_on: str(r.founded_on),
    homepage: str(r.homepage),
    assigned_to: str(r.assigned_to),
    created_at: String(r.created_at),
  };
}

function toDeal(r: Row): Deal {
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    company_id: str(r.company_id),
    pipeline_id: str(r.pipeline_id),
    stage_id: str(r.stage_id),
    assigned_to: str(r.assigned_to),
    title: String(r.title),
    amount: num(r.amount),
    status_note: str(r.status_note),
    fee_terms: str(r.fee_terms),
    applied_on: str(r.applied_on),
    // 001: jsonb not null default '{}'
    custom: (r.custom as Record<string, unknown> | null) ?? {},
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
    case_version: Number(r.case_version ?? 0),
  };
}

function toActivity(r: Row): Activity {
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    deal_id: str(r.deal_id),
    type: String(r.type),
    content: str(r.content),
    actor: str(r.actor),
    at: String(r.at),
    company_id: str(r.company_id),
    request_id: str(r.request_id),
    payload_digest: str(r.payload_digest),
    type_key: str(r.type_key),
    category_key: str(r.category_key),
  };
}

function toStage(r: Row): Stage {
  return {
    id: String(r.id),
    pipeline_id: String(r.pipeline_id),
    name: String(r.name),
    sort_order: Number(r.sort_order ?? 0),
    kind: r.kind as Stage["kind"],
  };
}

function toPipeline(r: Row): Pipeline {
  return {
    id: String(r.id),
    org_id: String(r.org_id),
    name: String(r.name),
  };
}

export class SupabaseCrmSource implements CrmSource {
  readonly kind = "supabase" as const;

  constructor(private readonly db: SupabaseClient) {}

  private fail(op: string, error: { message: string; code?: string }): never {
    throw new SupabaseCrmError(op, error);
  }

  // ── 파이프라인 / 단계 ──

  async listPipelines(orgId: string): Promise<Pipeline[]> {
    const { data, error } = await this.db
      .from("pipelines")
      .select("id, org_id, name")
      .eq("org_id", orgId)
      .order("name");
    if (error) this.fail("listPipelines", error);
    return (data ?? []).map(toPipeline);
  }

  async listStages(pipelineId: string): Promise<Stage[]> {
    const { data, error } = await this.db
      .from("stages")
      .select("id, pipeline_id, name, sort_order, kind")
      .eq("pipeline_id", pipelineId)
      .order("sort_order");
    if (error) this.fail("listStages", error);
    return (data ?? []).map(toStage);
  }

  async getStage(stageId: string): Promise<Stage | undefined> {
    const { data, error } = await this.db
      .from("stages")
      .select("id, pipeline_id, name, sort_order, kind")
      .eq("id", stageId)
      .maybeSingle();
    if (error) this.fail("getStage", error);
    return data ? toStage(data) : undefined;
  }

  // ── 고객사 ──

  async listCompanies(ctx: Ctx): Promise<Company[]> {
    let q = this.db.from("companies").select("*").eq("org_id", ctx.org.id);
    if (!canSeeAll(ctx)) q = q.eq("assigned_to", ctx.user.id);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) this.fail("listCompanies", error);
    return (data ?? []).map(toCompany);
  }

  async getCompany(ctx: Ctx, id: string): Promise<Company | undefined> {
    const { data, error } = await this.db
      .from("companies")
      .select("*")
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail("getCompany", error);
    if (!data) return undefined;
    const c = toCompany(data);
    // 미가시 리소스는 존재 자체를 흘리지 않는다(undefined 로 수렴) — 공용 포트 규약과 동일.
    return canSeeAll(ctx) || c.assigned_to === ctx.user.id ? c : undefined;
  }

  async createCompany(ctx: Ctx, input: NewCompany): Promise<Company> {
    // 담당범위 규칙: 매니저만 타인에게 배정할 수 있고, 그 외에는 본인 담당으로 고정.
    const assigned_to = canSeeAll(ctx)
      ? (input.assigned_to ?? ctx.user.id)
      : ctx.user.id;
    const { data, error } = await this.db
      .from("companies")
      .insert({ ...input, org_id: ctx.org.id, assigned_to })
      .select("*")
      .single();
    if (error) this.fail("createCompany", error);
    return toCompany(data as Row);
  }

  async updateCompany(
    ctx: Ctx,
    id: string,
    patch: CompanyPatch,
  ): Promise<Company | undefined> {
    const current = await this.getCompany(ctx, id);
    if (!current) return undefined;
    const { assigned_to, ...rest } = patch;
    const next: Row = { ...rest };
    // 재배정은 매니저 한정 — 일반 멤버의 assigned_to 변경은 무시(권한 상승 방지).
    if (assigned_to !== undefined && canSeeAll(ctx)) next.assigned_to = assigned_to;
    const { data, error } = await this.db
      .from("companies")
      .update(next)
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) this.fail("updateCompany", error);
    return data ? toCompany(data) : undefined;
  }

  async deleteCompany(ctx: Ctx, id: string): Promise<boolean> {
    // 가시성 확인 후 삭제 — 안 보이는 리소스는 false(존재 유출 방지).
    if (!(await this.getCompany(ctx, id))) return false;
    const { error } = await this.db
      .from("companies")
      .delete()
      .eq("org_id", ctx.org.id)
      .eq("id", id);
    if (error) this.fail("deleteCompany", error);
    return true;
  }

  // ── 딜 ──

  async listDeals(ctx: Ctx): Promise<Deal[]> {
    let q = this.db.from("deals").select("*").eq("org_id", ctx.org.id);
    if (!canSeeAll(ctx)) q = q.eq("assigned_to", ctx.user.id);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) this.fail("listDeals", error);
    return (data ?? []).map(toDeal);
  }

  async getDeal(ctx: Ctx, id: string): Promise<Deal | undefined> {
    const { data, error } = await this.db
      .from("deals")
      .select("*")
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .maybeSingle();
    if (error) this.fail("getDeal", error);
    if (!data) return undefined;
    const d = toDeal(data);
    return canSeeAll(ctx) || d.assigned_to === ctx.user.id ? d : undefined;
  }

  async createDeal(ctx: Ctx, input: NewDeal): Promise<Deal> {
    void ctx; void input;
    throw new Error("Case 생성은 회사의 create_company_case 경로만 지원합니다.");
  }

  async updateDeal(
    ctx: Ctx,
    id: string,
    patch: DealPatch,
  ): Promise<Deal | undefined> {
    if ("stage_id" in patch) {
      throw new Error("딜 수정 불가: 단계 변경은 moveDeal() 을 사용하세요");
    }
    if ("company_id" in patch || "pipeline_id" in patch || "assigned_to" in patch) {
      throw new Error("Case 소유·파이프라인·담당 변경은 전용 RPC만 사용하세요");
    }
    const current = await this.getDeal(ctx, id);
    if (!current) return undefined;
    const { custom, ...rest } = patch;
    const next: Row = { ...rest, updated_at: new Date().toISOString() };
    // custom 은 통째 교체 금지 — 읽은 값 위에 키 단위로 병합한다(BUG-0003, 로컬 구현과 동일 규약).
    // TODO(T02): 동시 수정 시 read-modify-write 는 마지막 쓰기가 이긴다. 정확히 하려면
    //   jsonb `||` 병합을 하는 RPC 로 옮긴다(단일 문장 원자성).
    if (custom !== undefined) next.custom = mergeCustom(current.custom, custom);
    const { data, error } = await this.db
      .from("deals")
      .update(next)
      .eq("org_id", ctx.org.id)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) this.fail("updateDeal", error);
    return data ? toDeal(data) : undefined;
  }

  async reassignDealWithActivity(
    ctx: Ctx,
    id: string,
    assignedTo: string | null,
    activityContent: string,
  ): Promise<Deal | undefined> {
    // 원격 DB는 조작 가능한 호출부 문자열 대신 users.name 으로 활동 문구를 직접 만든다.
    void activityContent;
    const { data, error } = await this.db.rpc("reassign_deal_with_activity", {
      p_org_id: ctx.org.id,
      p_deal_id: id,
      p_assigned_to: assignedTo,
    });
    if (error) this.fail("reassignDealWithActivity", error);
    return data ? toDeal(data as Row) : undefined;
  }

  async moveDeal(
    ctx: Ctx,
    id: string,
    toStageId: string,
    identity: { requestId: string; expectedVersion: number },
  ): Promise<Deal | undefined> {
    const current = await this.getDeal(ctx, id);
    if (!current) return undefined;
    const result = await new CanonicalCaseApi(this.db).moveStage({
      orgId: ctx.org.id,
      caseId: id,
      stageId: toStageId,
      expectedVersion: identity.expectedVersion,
      requestId: identity.requestId,
      content: null,
    });
    return { ...current, stage_id: result.stageId, pipeline_id: result.pipelineId, case_version: result.version };
  }

  async mutateCaseTask(
    ctx: Ctx,
    caseId: string,
    input: CaseTaskMutationInput,
  ): Promise<CaseTaskMutationResult> {
    if (!(await this.getDeal(ctx, caseId))) throw new Error("case unavailable");
    const contract = caseTaskMutationContract(input);
    const { data, error } = await this.db.rpc("mutate_case_task_with_activity", {
      p_org_id: ctx.org.id,
      p_case_id: caseId,
      p_request_id: contract.requestId,
      p_patch: contract.patch,
    });
    if (error) this.fail("mutateCaseTask", error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") throw new Error("task mutation result unavailable");
    const activityId = (row as Row).activity_id;
    const replayed = (row as Row).replayed;
    if (typeof activityId !== "string" || typeof replayed !== "boolean") {
      throw new Error("task mutation result unavailable");
    }
    return { activityId, replayed };
  }

  async deleteDeal(ctx: Ctx, id: string): Promise<boolean> {
    void ctx; void id;
    throw new Error("canonical Case deletion is not supported");
  }

  // ── 활동기록 ──

  async listActivities(ctx: Ctx, dealId: string): Promise<Activity[]> {
    // 상위 딜이 안 보이면 활동도 안 보인다(가시성 상속).
    const deal = await this.getDeal(ctx, dealId);
    if (!deal) return [];
    const { data, error } = await this.db
      .from("activities")
      .select("*")
      .eq("org_id", ctx.org.id)
      .eq("deal_id", dealId)
      .order("at", { ascending: false });
    if (error) this.fail("listActivities", error);
    return (data ?? []).map(toActivity);
  }

  async createActivity(ctx: Ctx, input: NewActivity, requestId: string): Promise<Activity> {
    const typeId = canonicalActivityType(input.type);
    if (!typeId) throw new Error(`활동 기록 불가: 지원하지 않는 type (${input.type})`);
    const categoryId = typeId === "activity.status"
      ? "activity.category.workflow"
      : typeId === "activity.assignment"
        ? "activity.category.ownership"
        : typeId === "activity.memo"
          ? "activity.category.note"
          : "activity.category.conversation";
    const result = await new CanonicalCaseApi(this.db).appendActivity({
      orgId: ctx.org.id,
      caseId: input.deal_id,
      requestId,
      typeId,
      categoryId,
      content: input.content,
    });
    const { data, error } = await this.db
      .from("activities")
      .select("*")
      .eq("org_id", ctx.org.id)
      .eq("id", result.activityId)
      .single();
    if (error) this.fail("createActivity", error);
    return toActivity(data as Row);
  }
}
