import type {
  Activity,
  Company,
  Ctx,
  Deal,
  FieldDef,
  FieldEntity,
  FieldOption,
  MemberRole,
  MemberScope,
  Org,
  OrgEntitlement,
  OrgMember,
  Pipeline,
  SavedView,
  Settlement,
  Stage,
  User,
} from "@/lib/types";
import { LocalRepo } from "./local/localRepo";

// custom(jsonb) 병합 규약 — 구현체·소비 트랙 모두 이 한 곳만 쓴다.
export { mergeCustom } from "./custom-merge";

// ── core.crm 쓰기 입력 타입 (T02) ──
// id/org_id/타임스탬프는 repo 가 채운다. assigned_to 는 담당범위 규칙으로 보정될 수 있다.
export interface NewCompany {
  name: string;
  biz_type?: string | null;
  region?: string | null;
  owner_name?: string | null;
  phone?: string | null;
  email?: string | null;
  revenue?: number | null;
  founded_on?: string | null;
  homepage?: string | null;
  assigned_to?: string | null;
}
export type CompanyPatch = Partial<NewCompany>;

export interface NewDeal {
  title: string;
  company_id?: string | null;
  pipeline_id?: string | null;
  /** 생성 시 최초 배치 전용. 이후 단계 변경은 `moveDeal()` 만 쓴다. */
  stage_id?: string | null;
  assigned_to?: string | null;
  amount?: number | null;
  status_note?: string | null;
  fee_terms?: string | null;
  applied_on?: string | null;
  custom?: Record<string, unknown>;
}

/**
 * 딜 부분수정 패치.
 *
 * ⚠ `stage_id` 가 **의도적으로 빠져 있다** — 단계 변경은 `moveDeal()` 전용이다.
 *   updateDeal 로 단계를 바꾸면 이동 활동로그가 남지 않는다("단계 변경은 move 전용"
 *   불변식). 서비스 계층 검사만으로는 `getRepo()` 직접 호출을 막지 못해 타입에서 뺐고,
 *   런타임으로 섞여 들어오면 구현체가 throw 한다.
 *
 * ⚠ `custom` 은 **키 단위 병합**이다 — 통째 교체가 아니다. patch.custom 에 없는 키는
 *   그대로 남고, 있는 키만 새 값으로 대체되며, 값이 `null` 이면 그 키를 삭제한다.
 *   깊이는 한 겹뿐(값은 통째 대체) — 근거와 상세는 `./custom-merge` 참고.
 *   모든 구현체는 `mergeCustom()` 을 써서 이 규약을 동일하게 지켜야 한다.
 */
export type DealPatch = Partial<Omit<NewDeal, "stage_id">>;

// ── core.custom 쓰기 입력 타입 (T05) ──
// key/type 은 불변(변경 시 저장값 해석이 깨짐) → 패치에 포함하지 않는다.
export interface FieldDefPatch {
  label?: string;
  /** null 이면 옵션 제거. 옵션 id 안정성은 custom/options.ts 가 보장. */
  options?: FieldOption[] | null;
  sort_order?: number;
}

export interface SavedViewPatch {
  name?: string;
  filters_jsonb?: Record<string, unknown>;
  sort_jsonb?: unknown[];
  columns_jsonb?: unknown[];
  shared?: boolean;
}

export interface NewActivity {
  deal_id: string;
  type: string;
  content?: string | null;
}

// ── 정산(settlements) 쓰기 입력 타입 (포트=T03 / 구현·업무로직=T09 / 소비=T04) ──
// base 컬럼만 입력받는다. fee_amount·total_revenue·d180·d365 는 001 의 generated
// column 이라 **입력 불가**(읽기 전용). 구현체가 동일 식으로 파생값을 채운다.
export interface NewSettlement {
  deal_id: string | null;
  down_payment?: number | null; // 계약금
  down_paid_at?: string | null;
  exec_amount?: number | null; // 실행액
  fee_pct?: number | null; // 수수료(정수 %)
  fee_paid_at?: string | null; // 수수료 입금일
}
export type SettlementPatch = Partial<NewSettlement>;

// 저장소 포트(Port). 소비 트랙(T02/T04)은 이 인터페이스만 의존한다.
// 현재 구현 = LocalRepo(인메모리). Supabase 연결 후 SupabaseRepo 로 교체(어댑터 스왑).
//
// 스코프 규칙: ctx 를 받는 조회(listCompanies/listDeals)는 담당범위를 적용한다 —
// owner/admin 또는 scope='all' 은 조직 전체, member+assigned 는 본인 담당(assigned_to)만.
export interface Repo {
  // 조직 / 멤버십
  getOrg(orgId: string): Org | undefined;
  createOrg(
    input: { name: string; plan_tier?: string },
    creator: User,
  ): { org: Org; member: OrgMember };
  listMembers(orgId: string): Array<OrgMember & { user: User | undefined }>;
  addMember(
    orgId: string,
    user: User,
    role: MemberRole,
    scope: MemberScope,
  ): OrgMember;
  setMemberRole(
    orgId: string,
    userId: string,
    role: MemberRole,
  ): OrgMember | undefined;
  setMemberScope(
    orgId: string,
    userId: string,
    scope: MemberScope,
  ): OrgMember | undefined;

  // 사용자
  getUser(userId: string): User | undefined;
  listUsers(): User[];
  upsertUser(user: User): User;

  // 엔타이틀먼트
  listEntitlements(orgId: string): OrgEntitlement[];
  isFeatureEnabled(orgId: string, featureKey: string): boolean;
  setEntitlement(orgId: string, featureKey: string, enabled: boolean): void;

  // 파이프라인 / 단계
  listPipelines(orgId: string): Pipeline[];
  listStages(pipelineId: string): Stage[];
  getStage(stageId: string): Stage | undefined;

  // 고객사 (담당범위 적용) — 조회 + 쓰기 (T02 core.crm)
  listCompanies(ctx: Ctx): Company[];
  getCompany(ctx: Ctx, id: string): Company | undefined;
  createCompany(ctx: Ctx, input: NewCompany): Company;
  updateCompany(ctx: Ctx, id: string, patch: CompanyPatch): Company | undefined;
  deleteCompany(ctx: Ctx, id: string): boolean;

  // 딜 (담당범위 적용) — 조회 + 쓰기 (T02 core.crm)
  listDeals(ctx: Ctx): Deal[];
  getDeal(ctx: Ctx, id: string): Deal | undefined;
  createDeal(ctx: Ctx, input: NewDeal): Deal;
  /**
   * 부분수정. `custom` 은 키 단위 병합(DealPatch 주석 참고).
   * @throws 런타임으로 `stage_id` 가 섞여 들어오면 Error — 단계 변경은 `moveDeal()` 전용.
   */
  updateDeal(ctx: Ctx, id: string, patch: DealPatch): Deal | undefined;
  /**
   * 단계 이동 — `stage_id` 를 바꾸는 **유일한** 경로.
   * 구현체는 단계 갱신과 이동 활동로그(type='status') 기록을 **함께** 수행한다.
   * 그래야 `getRepo()` 를 직접 쓰는 호출부에서도 로그 없는 이동이 생기지 않는다.
   * @returns 딜이 없거나 담당범위 밖이면 undefined.
   * @throws 존재하지 않는 단계면 Error.
   */
  moveDeal(ctx: Ctx, id: string, toStageId: string): Deal | undefined;
  deleteDeal(ctx: Ctx, id: string): boolean;

  // 활동기록 (딜 하위) — 단계 이동/통화/미팅/메모
  listActivities(ctx: Ctx, dealId: string): Activity[];
  createActivity(ctx: Ctx, input: NewActivity): Activity;

  // 커스텀필드 (core.custom — 소유: T05). 값 정규화·옵션 규약·뷰 적용은
  // app/src/lib/custom 엔진이 담당하고, 이 포트는 영속성만 책임진다.
  listFieldDefs(orgId: string, entity?: FieldEntity): FieldDef[];
  getFieldDef(orgId: string, defId: string): FieldDef | undefined;
  createFieldDef(input: Omit<FieldDef, "id">): FieldDef;
  updateFieldDef(orgId: string, defId: string, patch: FieldDefPatch): FieldDef | undefined;
  reorderFieldDefs(orgId: string, entity: FieldEntity, orderedIds: string[]): void;
  /** 정의만 삭제한다. 해당 field_key 값은 재생성 복구를 위해 보존한다. */
  deleteFieldDef(orgId: string, defId: string): boolean;

  // 커스텀필드 값 (entity_id = company.id | deal.id, PK(entity_id, field_key))
  getFieldValues(orgId: string, entity: FieldEntity, entityId: string): Record<string, unknown>;
  /** value === null 이면 셀 삭제(빈 값). */
  setFieldValue(orgId: string, entity: FieldEntity, entityId: string, fieldKey: string, value: unknown): void;

  // 저장뷰 (가시성: 공유 뷰 ∪ 본인 개인 뷰)
  listSavedViews(orgId: string, userId: string | null, entity?: FieldEntity): SavedView[];
  getSavedView(orgId: string, viewId: string): SavedView | undefined;
  createSavedView(input: Omit<SavedView, "id">): SavedView;
  updateSavedView(orgId: string, viewId: string, patch: SavedViewPatch): SavedView | undefined;
  deleteSavedView(orgId: string, viewId: string): boolean;

  // 정산 (담당범위 적용 — 상위 deal 가시성 기준)
  // 소유: T09(업무 로직) · 소비: T04(대시보드). 소비 트랙은 이 포트만 쓰고
  // 인터페이스를 직접 수정하지 않는다(변경 필요 시 T03 에 요청).
  listSettlements(ctx: Ctx): Settlement[];
  getSettlement(ctx: Ctx, id: string): Settlement | undefined;
  getSettlementByDeal(ctx: Ctx, dealId: string): Settlement | undefined;
  createSettlement(ctx: Ctx, input: NewSettlement): Settlement;
  updateSettlement(
    ctx: Ctx,
    id: string,
    patch: SettlementPatch,
  ): Settlement | undefined;
  deleteSettlement(ctx: Ctx, id: string): boolean;
}

// 단일 인스턴스(인메모리 store 를 공유).
const globalRepo = globalThis as unknown as { __moaworkRepo?: Repo };

export function getRepo(): Repo {
  if (process.env.NODE_ENV !== "production") {
    if (!globalRepo.__moaworkRepo) globalRepo.__moaworkRepo = new LocalRepo();
    return globalRepo.__moaworkRepo;
  }
  throw new Error("LocalRepo is disabled in production; use a request-scoped persistent port");
}
