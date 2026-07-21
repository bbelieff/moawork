import type {
  Activity,
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
import { isManager } from "@/lib/auth/roles";
import type {
  CompanyPatch,
  DealPatch,
  NewActivity,
  NewCompany,
  NewDeal,
  Repo,
} from "../index";
import { db } from "./store";

function now(): string {
  return new Date().toISOString();
}

// 담당범위 판정: owner/admin 또는 scope='all' → 전체, member+assigned → 본인 것만.
function canSeeAll(ctx: Ctx): boolean {
  return isManager(ctx.role) || ctx.scope === "all";
}

export class LocalRepo implements Repo {
  // ── 조직 / 멤버십 ──
  getOrg(orgId: string): Org | undefined {
    return db().orgs.find((o) => o.id === orgId);
  }

  createOrg(
    input: { name: string; plan_tier?: string },
    creator: User,
  ): { org: Org; member: OrgMember } {
    const org: Org = {
      id: crypto.randomUUID(),
      name: input.name,
      plan_tier: input.plan_tier ?? "t1_3",
      created_at: now(),
    };
    db().orgs.push(org);
    // auto-owner (001 의 add_org_owner 트리거를 앱에서 재현): 생성자를 owner 로 등록.
    const member: OrgMember = {
      org_id: org.id,
      user_id: creator.id,
      role: "owner",
      scope: "all",
      created_at: now(),
    };
    db().members.push(member);
    return { org, member };
  }

  listMembers(
    orgId: string,
  ): Array<OrgMember & { user: User | undefined }> {
    return db()
      .members.filter((m) => m.org_id === orgId)
      .map((m) => ({ ...m, user: this.getUser(m.user_id) }));
  }

  addMember(
    orgId: string,
    user: User,
    role: MemberRole,
    scope: MemberScope,
  ): OrgMember {
    this.upsertUser(user);
    const existing = db().members.find(
      (m) => m.org_id === orgId && m.user_id === user.id,
    );
    if (existing) {
      existing.role = role;
      existing.scope = scope;
      return existing;
    }
    const member: OrgMember = {
      org_id: orgId,
      user_id: user.id,
      role,
      scope,
      created_at: now(),
    };
    db().members.push(member);
    return member;
  }

  setMemberRole(
    orgId: string,
    userId: string,
    role: MemberRole,
  ): OrgMember | undefined {
    const m = db().members.find(
      (x) => x.org_id === orgId && x.user_id === userId,
    );
    if (m) m.role = role;
    return m;
  }

  setMemberScope(
    orgId: string,
    userId: string,
    scope: MemberScope,
  ): OrgMember | undefined {
    const m = db().members.find(
      (x) => x.org_id === orgId && x.user_id === userId,
    );
    if (m) m.scope = scope;
    return m;
  }

  // ── 사용자 ──
  getUser(userId: string): User | undefined {
    return db().users.find((u) => u.id === userId);
  }

  listUsers(): User[] {
    return [...db().users];
  }

  upsertUser(user: User): User {
    const i = db().users.findIndex((u) => u.id === user.id);
    if (i >= 0) {
      db().users[i] = { ...db().users[i], ...user };
      return db().users[i];
    }
    db().users.push(user);
    return user;
  }

  // ── 엔타이틀먼트 ──
  listEntitlements(orgId: string): OrgEntitlement[] {
    return db().entitlements.filter((e) => e.org_id === orgId);
  }

  isFeatureEnabled(orgId: string, featureKey: string): boolean {
    const e = db().entitlements.find(
      (x) => x.org_id === orgId && x.feature_key === featureKey,
    );
    return e?.enabled === true;
  }

  setEntitlement(orgId: string, featureKey: string, enabled: boolean): void {
    const e = db().entitlements.find(
      (x) => x.org_id === orgId && x.feature_key === featureKey,
    );
    if (e) {
      e.enabled = enabled;
      return;
    }
    db().entitlements.push({
      org_id: orgId,
      feature_key: featureKey,
      enabled,
      limit_value: null,
      source: "manual",
      expires_at: null,
    });
  }

  // ── 파이프라인 / 단계 ──
  listPipelines(orgId: string): Pipeline[] {
    return db().pipelines.filter((p) => p.org_id === orgId);
  }

  listStages(pipelineId: string): Stage[] {
    return db()
      .stages.filter((s) => s.pipeline_id === pipelineId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  getStage(stageId: string): Stage | undefined {
    return db().stages.find((s) => s.id === stageId);
  }

  // ── 고객사 (담당범위 적용) ──
  listCompanies(ctx: Ctx): Company[] {
    const all = db().companies.filter((c) => c.org_id === ctx.org.id);
    return canSeeAll(ctx)
      ? all
      : all.filter((c) => c.assigned_to === ctx.user.id);
  }

  getCompany(ctx: Ctx, id: string): Company | undefined {
    const c = db().companies.find(
      (x) => x.id === id && x.org_id === ctx.org.id,
    );
    if (!c) return undefined;
    return canSeeAll(ctx) || c.assigned_to === ctx.user.id ? c : undefined;
  }

  createCompany(ctx: Ctx, input: NewCompany): Company {
    // member+assigned 는 남에게 배정 불가 → 본인으로 강제.
    const assigned = canSeeAll(ctx)
      ? (input.assigned_to ?? null)
      : ctx.user.id;
    const company: Company = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      name: input.name,
      biz_type: input.biz_type ?? null,
      region: input.region ?? null,
      owner_name: input.owner_name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      revenue: input.revenue ?? null,
      founded_on: input.founded_on ?? null,
      homepage: input.homepage ?? null,
      assigned_to: assigned,
      created_at: now(),
    };
    db().companies.push(company);
    return company;
  }

  updateCompany(
    ctx: Ctx,
    id: string,
    patch: CompanyPatch,
  ): Company | undefined {
    const c = this.getCompany(ctx, id);
    if (!c) return undefined;
    // assigned_to 재배정은 매니저/전체범위만.
    const { assigned_to, ...rest } = patch;
    Object.assign(c, rest);
    if (assigned_to !== undefined && canSeeAll(ctx)) c.assigned_to = assigned_to;
    return c;
  }

  deleteCompany(ctx: Ctx, id: string): boolean {
    const c = this.getCompany(ctx, id);
    if (!c) return false;
    db().companies = db().companies.filter((x) => x.id !== id);
    return true;
  }

  // ── 딜 (담당범위 적용) ──
  listDeals(ctx: Ctx): Deal[] {
    const all = db().deals.filter((d) => d.org_id === ctx.org.id);
    return canSeeAll(ctx)
      ? all
      : all.filter((d) => d.assigned_to === ctx.user.id);
  }

  getDeal(ctx: Ctx, id: string): Deal | undefined {
    const d = db().deals.find((x) => x.id === id && x.org_id === ctx.org.id);
    if (!d) return undefined;
    return canSeeAll(ctx) || d.assigned_to === ctx.user.id ? d : undefined;
  }

  createDeal(ctx: Ctx, input: NewDeal): Deal {
    const assigned = canSeeAll(ctx)
      ? (input.assigned_to ?? ctx.user.id)
      : ctx.user.id;
    const ts = now();
    const deal: Deal = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      company_id: input.company_id ?? null,
      pipeline_id: input.pipeline_id ?? null,
      stage_id: input.stage_id ?? null,
      assigned_to: assigned,
      title: input.title,
      amount: input.amount ?? null,
      status_note: input.status_note ?? null,
      applied_on: input.applied_on ?? null,
      custom: input.custom ?? {},
      created_at: ts,
      updated_at: ts,
    };
    db().deals.push(deal);
    return deal;
  }

  updateDeal(ctx: Ctx, id: string, patch: DealPatch): Deal | undefined {
    const d = this.getDeal(ctx, id);
    if (!d) return undefined;
    const { assigned_to, ...rest } = patch;
    Object.assign(d, rest);
    if (assigned_to !== undefined && canSeeAll(ctx)) d.assigned_to = assigned_to;
    d.updated_at = now();
    return d;
  }

  deleteDeal(ctx: Ctx, id: string): boolean {
    const d = this.getDeal(ctx, id);
    if (!d) return false;
    db().deals = db().deals.filter((x) => x.id !== id);
    db().activities = db().activities.filter((a) => a.deal_id !== id);
    return true;
  }

  // ── 활동기록 ──
  listActivities(ctx: Ctx, dealId: string): Activity[] {
    // 딜 가시성 확인 후 활동 반환(최신순; 동일 시각은 나중 삽입이 최신).
    if (!this.getDeal(ctx, dealId)) return [];
    return db()
      .activities.filter((a) => a.org_id === ctx.org.id && a.deal_id === dealId)
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (x.a.at < y.a.at ? 1 : x.a.at > y.a.at ? -1 : y.i - x.i))
      .map((x) => x.a);
  }

  createActivity(ctx: Ctx, input: NewActivity): Activity {
    const activity: Activity = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      deal_id: input.deal_id,
      type: input.type,
      content: input.content ?? null,
      actor: ctx.user.id,
      at: now(),
    };
    db().activities.push(activity);
    return activity;
  }

  // ── 커스텀필드 ──
  listFieldDefs(orgId: string, entity?: FieldEntity): FieldDef[] {
    return db()
      .fieldDefs.filter(
        (f) => f.org_id === orgId && (entity ? f.entity === entity : true),
      )
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  createFieldDef(input: Omit<FieldDef, "id">): FieldDef {
    const def: FieldDef = { id: crypto.randomUUID(), ...input };
    db().fieldDefs.push(def);
    return def;
  }
}
