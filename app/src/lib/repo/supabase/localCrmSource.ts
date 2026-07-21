import type { Activity, Company, Ctx, Deal, Pipeline, Stage } from "@/lib/types";
import {
  getRepo,
  type CompanyPatch,
  type DealPatch,
  type NewActivity,
  type NewCompany,
  type NewDeal,
} from "@/lib/repo";
import type { CrmSource } from "./source";

/**
 * 공용 동기 `Repo`(인메모리) 를 비동기 포트에 맞춰 감싼 폴백 소스 (T02 · B2).
 *
 * Supabase 환경변수가 없을 때 쓰인다 — 덕분에 연결 전에도 화면이 그대로 돌아가고,
 * 연결 후에는 팩토리에서 구현체만 바뀐다(호출부 무수정).
 * 담당범위 규칙은 감싸는 Repo 안에 이미 있으므로 여기서 중복 적용하지 않는다.
 */
export class LocalCrmSource implements CrmSource {
  readonly kind = "local" as const;

  private get repo() {
    return getRepo();
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

  async listDeals(ctx: Ctx): Promise<Deal[]> {
    return this.repo.listDeals(ctx);
  }
  async getDeal(ctx: Ctx, id: string): Promise<Deal | undefined> {
    return this.repo.getDeal(ctx, id);
  }
  async createDeal(ctx: Ctx, input: NewDeal): Promise<Deal> {
    return this.repo.createDeal(ctx, input);
  }
  async updateDeal(
    ctx: Ctx,
    id: string,
    patch: DealPatch,
  ): Promise<Deal | undefined> {
    return this.repo.updateDeal(ctx, id, patch);
  }

  async listActivities(ctx: Ctx, dealId: string): Promise<Activity[]> {
    return this.repo.listActivities(ctx, dealId);
  }
  async createActivity(ctx: Ctx, input: NewActivity): Promise<Activity> {
    return this.repo.createActivity(ctx, input);
  }
}
