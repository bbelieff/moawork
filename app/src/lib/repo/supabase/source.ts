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

  // 딜 (담당범위 적용)
  listDeals(ctx: Ctx): Promise<Deal[]>;
  getDeal(ctx: Ctx, id: string): Promise<Deal | undefined>;
  createDeal(ctx: Ctx, input: NewDeal): Promise<Deal>;
  /** 부분수정. `custom` 은 키 단위 병합(공용 `DealPatch` 규약과 동일). */
  updateDeal(ctx: Ctx, id: string, patch: DealPatch): Promise<Deal | undefined>;
  /** 단계 이동 + 활동로그 — stage_id 를 바꾸는 유일한 경로(공용 `Repo.moveDeal` 과 동일). */
  moveDeal(ctx: Ctx, id: string, toStageId: string): Promise<Deal | undefined>;

  // 활동기록
  listActivities(ctx: Ctx, dealId: string): Promise<Activity[]>;
  createActivity(ctx: Ctx, input: NewActivity): Promise<Activity>;
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
