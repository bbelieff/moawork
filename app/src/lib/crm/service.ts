/**
 * core.crm 서비스 레이어 (T02).
 * 공유 저장소 포트 `getRepo()` + 세션 컨텍스트 `Ctx` 위에서 오케스트레이션.
 * 담당: 고객사·파이프라인·단계·딜·활동. 단계 이동 시 활동로그(먼데이 "이동" 재현).
 * 경계: 수식/정산=T09, 커스텀필드/저장뷰=T05 (여기서 다루지 않음).
 */

import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import {
  getRepo,
  type CompanyPatch,
  type DealPatch,
  type NewCompany,
  type NewDeal,
  type Repo,
} from "@/lib/repo";
import { ACTIVITY_TYPES, stageMoveContent } from "./activity";
import { ValidationError } from "./validation";

export class NotFoundError extends Error {
  constructor(message = "찾을 수 없습니다") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface PipelineWithStages extends Pipeline {
  stages: Stage[];
}

export class CrmService {
  constructor(private readonly repo: Repo = getRepo()) {}

  // ── 파이프라인 ────────────────────────────────────────
  listPipelines(ctx: Ctx): PipelineWithStages[] {
    return this.repo
      .listPipelines(ctx.org.id)
      .map((p) => ({ ...p, stages: this.repo.listStages(p.id) }));
  }

  // ── 고객사 ────────────────────────────────────────────
  listCompanies(ctx: Ctx): Company[] {
    return this.repo.listCompanies(ctx);
  }

  getCompany(ctx: Ctx, id: string): Company {
    const c = this.repo.getCompany(ctx, id);
    if (!c) throw new NotFoundError("고객사를 찾을 수 없습니다");
    return c;
  }

  createCompany(ctx: Ctx, input: NewCompany): Company {
    return this.repo.createCompany(ctx, input);
  }

  updateCompany(ctx: Ctx, id: string, patch: CompanyPatch): Company {
    const c = this.repo.updateCompany(ctx, id, patch);
    if (!c) throw new NotFoundError("고객사를 찾을 수 없습니다");
    return c;
  }

  deleteCompany(ctx: Ctx, id: string): void {
    if (!this.repo.deleteCompany(ctx, id))
      throw new NotFoundError("고객사를 찾을 수 없습니다");
  }

  // ── 딜 ────────────────────────────────────────────────
  listDeals(ctx: Ctx, filter: { stageId?: string; companyId?: string } = {}): Deal[] {
    let deals = this.repo.listDeals(ctx);
    if (filter.stageId) deals = deals.filter((d) => d.stage_id === filter.stageId);
    if (filter.companyId) deals = deals.filter((d) => d.company_id === filter.companyId);
    return deals;
  }

  getDeal(ctx: Ctx, id: string): Deal {
    const d = this.repo.getDeal(ctx, id);
    if (!d) throw new NotFoundError("딜을 찾을 수 없습니다");
    return d;
  }

  /** 딜 생성. pipeline/stage 미지정 시 조직 기본 파이프라인의 첫 단계로 배치. */
  createDeal(ctx: Ctx, input: NewDeal): Deal {
    const resolved = this.resolveStageDefaults(ctx, input.pipeline_id ?? null, input.stage_id ?? null);
    const deal = this.repo.createDeal(ctx, {
      ...input,
      pipeline_id: resolved.pipelineId,
      stage_id: resolved.stageId,
    });
    // 최초 배치도 활동로그(먼데이 파리티).
    if (resolved.stageId) {
      const to = this.repo.getStage(resolved.stageId);
      if (to)
        this.repo.createActivity(ctx, {
          deal_id: deal.id,
          type: ACTIVITY_TYPES.status,
          content: stageMoveContent(null, to.name),
        });
    }
    return deal;
  }

  updateDeal(ctx: Ctx, id: string, patch: DealPatch): Deal {
    // 단계 변경은 move 로만(활동로그 보장) — patch 에서 stage 제거.
    if (patch.stage_id !== undefined)
      throw new ValidationError("단계 변경은 /move 엔드포인트를 사용하세요");
    const d = this.repo.updateDeal(ctx, id, patch);
    if (!d) throw new NotFoundError("딜을 찾을 수 없습니다");
    return d;
  }

  deleteDeal(ctx: Ctx, id: string): void {
    if (!this.repo.deleteDeal(ctx, id)) throw new NotFoundError("딜을 찾을 수 없습니다");
  }

  /** 파이프라인 단계 이동 + 활동로그. */
  moveDealStage(ctx: Ctx, id: string, toStageId: string): Deal {
    const deal = this.getDeal(ctx, id);
    const toStage = this.repo.getStage(toStageId);
    if (!toStage) throw new ValidationError("존재하지 않는 단계입니다");
    const fromStage = deal.stage_id ? this.repo.getStage(deal.stage_id) : undefined;

    const updated = this.repo.updateDeal(ctx, id, {
      stage_id: toStage.id,
      pipeline_id: deal.pipeline_id ?? toStage.pipeline_id,
    });
    if (!updated) throw new NotFoundError("딜을 찾을 수 없습니다");

    this.repo.createActivity(ctx, {
      deal_id: id,
      type: ACTIVITY_TYPES.status,
      content: stageMoveContent(fromStage?.name ?? null, toStage.name),
    });
    return updated;
  }

  // ── 활동 ──────────────────────────────────────────────
  listActivities(ctx: Ctx, dealId: string): Activity[] {
    this.getDeal(ctx, dealId); // 가시성/존재 확인
    return this.repo.listActivities(ctx, dealId);
  }

  createActivity(
    ctx: Ctx,
    dealId: string,
    input: { type: string; content: string | null },
  ): Activity {
    this.getDeal(ctx, dealId);
    return this.repo.createActivity(ctx, {
      deal_id: dealId,
      type: input.type,
      content: input.content,
    });
  }

  // ── 내부 ──────────────────────────────────────────────
  private resolveStageDefaults(
    ctx: Ctx,
    pipelineId: string | null,
    stageId: string | null,
  ): { pipelineId: string | null; stageId: string | null } {
    if (stageId) {
      const stage = this.repo.getStage(stageId);
      if (!stage) throw new ValidationError("존재하지 않는 단계입니다");
      return { pipelineId: pipelineId ?? stage.pipeline_id, stageId };
    }
    const pipeline = pipelineId
      ? this.repo.listPipelines(ctx.org.id).find((p) => p.id === pipelineId)
      : this.repo.listPipelines(ctx.org.id)[0];
    if (!pipeline) return { pipelineId, stageId: null };
    const firstStage = this.repo.listStages(pipeline.id)[0];
    return { pipelineId: pipeline.id, stageId: firstStage?.id ?? null };
  }
}
