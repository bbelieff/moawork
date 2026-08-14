/**
 * core.crm 비동기 서비스 (T02 · B2 재개).
 *
 * `CrmService` 와 **같은 의미론**을 비동기 소스(`CrmSource`) 위에서 제공한다.
 * 소스는 환경변수 유무로 정해진다 — Supabase(실DB) 또는 로컬 인메모리.
 * 덕분에 API 라우트 한 벌로 두 경로를 모두 태운다(연결 전후 동작 동일).
 *
 * 동기판(`service.ts`)을 지우지 않은 이유: 공용 `Repo` 포트가 아직 동기라
 * 다른 트랙(T04 대시·T09 정산)이 그 위에서 돈다. 두 구현의 규칙은 동일해야 하며,
 * 차이가 생기면 `asyncService.test.ts` 의 파리티 테스트가 깨진다.
 */

import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import type { CompanyPatch, DealPatch, NewCompany, NewDeal } from "@/lib/repo";
import { getCrmSource, type CrmSource } from "@/lib/repo/supabase";
import { ACTIVITY_TYPES, assignmentChangeContent, stageMoveContent } from "./activity";
import { NotFoundError } from "./service";
import { ValidationError } from "./validation";

export interface PipelineWithStages extends Pipeline {
  stages: Stage[];
}

export class AsyncCrmService {
  constructor(private readonly source: CrmSource = getCrmSource()) {}

  /** 데이터 출처(화면 배지·진단용). */
  get sourceKind(): CrmSource["kind"] {
    return this.source.kind;
  }

  // ── 파이프라인 ────────────────────────────────────────
  async listPipelines(ctx: Ctx): Promise<PipelineWithStages[]> {
    const pipelines = await this.source.listPipelines(ctx.org.id);
    return Promise.all(
      pipelines.map(async (p) => ({
        ...p,
        stages: await this.source.listStages(p.id),
      })),
    );
  }

  // ── 고객사 ────────────────────────────────────────────
  async listCompanies(ctx: Ctx): Promise<Company[]> {
    return this.source.listCompanies(ctx);
  }

  async getCompany(ctx: Ctx, id: string): Promise<Company> {
    const c = await this.source.getCompany(ctx, id);
    if (!c) throw new NotFoundError("고객사를 찾을 수 없습니다");
    return c;
  }

  async createCompany(ctx: Ctx, input: NewCompany): Promise<Company> {
    return this.source.createCompany(ctx, input);
  }

  async updateCompany(ctx: Ctx, id: string, patch: CompanyPatch): Promise<Company> {
    const c = await this.source.updateCompany(ctx, id, patch);
    if (!c) throw new NotFoundError("고객사를 찾을 수 없습니다");
    return c;
  }

  async deleteCompany(ctx: Ctx, id: string): Promise<void> {
    if (!(await this.source.deleteCompany(ctx, id)))
      throw new NotFoundError("고객사를 찾을 수 없습니다");
  }

  // ── 딜 ────────────────────────────────────────────────
  async listDeals(
    ctx: Ctx,
    filter: { stageId?: string; companyId?: string } = {},
  ): Promise<Deal[]> {
    let deals = await this.source.listDeals(ctx);
    if (filter.stageId) deals = deals.filter((d) => d.stage_id === filter.stageId);
    if (filter.companyId)
      deals = deals.filter((d) => d.company_id === filter.companyId);
    return deals;
  }

  async getDeal(ctx: Ctx, id: string): Promise<Deal> {
    const d = await this.source.getDeal(ctx, id);
    if (!d) throw new NotFoundError("딜을 찾을 수 없습니다");
    return d;
  }

  /** 딜 생성. pipeline/stage 미지정 시 조직 기본 파이프라인의 첫 단계로 배치. */
  async createDeal(ctx: Ctx, input: NewDeal): Promise<Deal> {
    const resolved = await this.resolveStageDefaults(
      ctx,
      input.pipeline_id ?? null,
      input.stage_id ?? null,
    );
    const deal = await this.source.createDeal(ctx, {
      ...input,
      pipeline_id: resolved.pipelineId,
      stage_id: resolved.stageId,
    });
    // 최초 배치도 활동로그(먼데이 파리티) — 동기판과 동일.
    if (resolved.stageId) {
      const to = await this.source.getStage(resolved.stageId);
      if (to)
        await this.source.createActivity(ctx, {
          deal_id: deal.id,
          type: ACTIVITY_TYPES.status,
          content: stageMoveContent(null, to.name),
        });
    }
    return deal;
  }

  async updateDeal(ctx: Ctx, id: string, patch: DealPatch): Promise<Deal> {
    // 단계 변경은 move 전용(활동로그 보장). 타입에는 없지만 런타임으로 섞여 들어올 수 있다.
    if ("stage_id" in patch)
      throw new ValidationError("단계 변경은 /move 엔드포인트를 사용하세요");
    const d = await this.source.updateDeal(ctx, id, patch);
    if (!d) throw new NotFoundError("딜을 찾을 수 없습니다");
    return d;
  }

  async deleteDeal(ctx: Ctx, id: string): Promise<void> {
    if (!(await this.source.deleteDeal(ctx, id)))
      throw new NotFoundError("딜을 찾을 수 없습니다");
  }

  /**
   * 파이프라인 단계 이동 + 활동로그.
   * 이동과 로그는 소스(`moveDeal`)가 함께 처리한다 — 서비스를 우회해도 로그 없는 이동이
   * 생기지 않게 하기 위함. 여기서는 사용자용 오류 타입으로 옮기는 일만 한다.
   */
  async moveDealStage(ctx: Ctx, id: string, toStageId: string): Promise<Deal> {
    await this.getDeal(ctx, id); // 가시성/존재 확인 → NotFoundError
    if (!(await this.source.getStage(toStageId)))
      throw new ValidationError("존재하지 않는 단계입니다");

    const updated = await this.source.moveDeal(ctx, id, toStageId);
    if (!updated) throw new NotFoundError("딜을 찾을 수 없습니다");
    return updated;
  }

  /**
   * 담당자 재배정 + 활동로그 (BBE-16). `moveDealStage` 와 같은 이유로 서비스 메서드로
   * 둔다 — 배정 변경에 로그가 없는 경로가 생기지 않게 하기 위함. 이름 표시는
   * 호출부(names 맵)가 넘겨준다(서비스는 조회 책임을 늘리지 않는다).
   *
   * 권한과 원자성은 소스의 단일 `reassignDealWithActivity` 포트가 방어한다.
   */
  async reassignDeal(
    ctx: Ctx,
    id: string,
    newAssignedTo: string | null,
    names: { fromName: string | null; toName: string | null },
  ): Promise<Deal> {
    await this.getDeal(ctx, id); // 가시성/존재 확인

    const updated = await this.source.reassignDealWithActivity(
      ctx,
      id,
      newAssignedTo,
      assignmentChangeContent(names.fromName, names.toName),
    );
    if (!updated) throw new NotFoundError("딜을 찾을 수 없습니다");
    // 변경+로그는 source 의 단일 원자 포트가 닫는다. 서비스가 별도 INSERT 를 하면
    // 로그 실패 뒤 담당자만 바뀐 채 남는 부분 성공이 다시 생긴다.
    return updated;
  }

  // ── 활동 ──────────────────────────────────────────────
  async listActivities(ctx: Ctx, dealId: string): Promise<Activity[]> {
    await this.getDeal(ctx, dealId); // 가시성/존재 확인
    return this.source.listActivities(ctx, dealId);
  }

  async createActivity(
    ctx: Ctx,
    dealId: string,
    input: { type: string; content: string | null },
  ): Promise<Activity> {
    await this.getDeal(ctx, dealId);
    return this.source.createActivity(ctx, {
      deal_id: dealId,
      type: input.type,
      content: input.content,
    });
  }

  // ── 내부 ──────────────────────────────────────────────
  private async resolveStageDefaults(
    ctx: Ctx,
    pipelineId: string | null,
    stageId: string | null,
  ): Promise<{ pipelineId: string | null; stageId: string | null }> {
    if (stageId) {
      const stage = await this.source.getStage(stageId);
      if (!stage) throw new ValidationError("존재하지 않는 단계입니다");
      return { pipelineId: pipelineId ?? stage.pipeline_id, stageId };
    }
    const pipelines = await this.source.listPipelines(ctx.org.id);
    const pipeline = pipelineId
      ? pipelines.find((p) => p.id === pipelineId)
      : pipelines[0];
    if (!pipeline) return { pipelineId, stageId: null };
    const firstStage = (await this.source.listStages(pipeline.id))[0];
    return { pipelineId: pipeline.id, stageId: firstStage?.id ?? null };
  }
}
