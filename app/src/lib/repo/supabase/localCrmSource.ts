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
import type { CrmSource } from "./source";
import { canSeeAll } from "./source";

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
    return this.repo.createDeal(ctx, input);
  }
  async updateDeal(
    ctx: Ctx,
    id: string,
    patch: DealPatch,
  ): Promise<Deal | undefined> {
    return this.repo.updateDeal(ctx, id, patch);
  }
  async reassignDealWithActivity(
    ctx: Ctx,
    id: string,
    assignedTo: string | null,
    activityContent: string,
  ): Promise<Deal | undefined> {
    const current = this.repo.getDeal(ctx, id);
    if (!current || !canSeeAll(ctx) || current.assigned_to === assignedTo) return current;

    // 로컬 저장소는 프로세스 메모리라 실패 지점이 없지만, 원격 RPC와 같은 단일 포트로
    // 노출해 서비스가 update→log 두 단계 쓰기를 다시 만들지 못하게 한다.
    const previousAssignedTo = current.assigned_to;
    const previousUpdatedAt = current.updated_at;
    const updated = this.repo.updateDeal(ctx, id, { assigned_to: assignedTo });
    if (!updated) return undefined;
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
      throw error;
    }
    return updated;
  }
  async moveDeal(
    ctx: Ctx,
    id: string,
    toStageId: string,
  ): Promise<Deal | undefined> {
    return this.repo.moveDeal(ctx, id, toStageId);
  }
  async deleteDeal(ctx: Ctx, id: string): Promise<boolean> {
    return this.repo.deleteDeal(ctx, id);
  }

  async listActivities(ctx: Ctx, dealId: string): Promise<Activity[]> {
    return this.repo.listActivities(ctx, dealId);
  }
  async createActivity(ctx: Ctx, input: NewActivity): Promise<Activity> {
    return this.repo.createActivity(ctx, input);
  }
}
