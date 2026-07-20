import type {
  Company,
  Ctx,
  Deal,
  FieldDef,
  FieldEntity,
  MemberRole,
  MemberScope,
  Org,
  OrgEntitlement,
  OrgMember,
  Pipeline,
  Stage,
  User,
} from "@/lib/types";
import { LocalRepo } from "./local/localRepo";

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

  // 고객사 / 딜 (담당범위 적용)
  listCompanies(ctx: Ctx): Company[];
  listDeals(ctx: Ctx): Deal[];

  // 커스텀필드
  listFieldDefs(orgId: string, entity?: FieldEntity): FieldDef[];
  createFieldDef(input: Omit<FieldDef, "id">): FieldDef;
}

// 단일 인스턴스(인메모리 store 를 공유).
const globalRepo = globalThis as unknown as { __moaworkRepo?: Repo };

export function getRepo(): Repo {
  if (!globalRepo.__moaworkRepo) {
    globalRepo.__moaworkRepo = new LocalRepo();
  }
  return globalRepo.__moaworkRepo;
}
