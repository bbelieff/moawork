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
  Settlement,
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
  NewSettlement,
  Repo,
  SettlementPatch,
} from "../index";
import { db } from "./store";

function now(): string {
  return new Date().toISOString();
}

// 'YYYY-MM-DD' + n일 (UTC 기준으로 계산해 타임존 드리프트 방지). null → null.
function addDays(date: string | null, n: number): string | null {
  if (!date) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

// 001 settlements 의 generated column 을 그대로 재현한다(수식 변경 시 스키마와 동시 수정).
//   fee_amount    = round(exec_amount × fee_pct / 100)
//   total_revenue = down_payment + fee_amount
//   d180 / d365   = fee_paid_at + 180 / 365
type SettlementBase = Pick<
  Settlement,
  "down_payment" | "exec_amount" | "fee_pct" | "fee_paid_at"
>;

function derive(
  s: SettlementBase,
): Pick<Settlement, "fee_amount" | "total_revenue" | "d180" | "d365"> {
  const fee_amount = Math.round((s.exec_amount * s.fee_pct) / 100);
  return {
    fee_amount,
    total_revenue: s.down_payment + fee_amount,
    d180: addDays(s.fee_paid_at, 180),
    d365: addDays(s.fee_paid_at, 365),
  };
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

  // ── 정산 (담당범위는 상위 deal 가시성을 따른다) ──
  // 파생 컬럼은 write 마다 재계산해 001 generated column 과 동일하게 유지한다.
  listSettlements(ctx: Ctx): Settlement[] {
    const all = db().settlements.filter((s) => s.org_id === ctx.org.id);
    if (canSeeAll(ctx)) return all;
    const visible = new Set(this.listDeals(ctx).map((d) => d.id));
    return all.filter((s) => s.deal_id !== null && visible.has(s.deal_id));
  }

  getSettlement(ctx: Ctx, id: string): Settlement | undefined {
    const s = db().settlements.find(
      (x) => x.id === id && x.org_id === ctx.org.id,
    );
    if (!s) return undefined;
    if (canSeeAll(ctx)) return s;
    return s.deal_id && this.getDeal(ctx, s.deal_id) ? s : undefined;
  }

  getSettlementByDeal(ctx: Ctx, dealId: string): Settlement | undefined {
    if (!this.getDeal(ctx, dealId)) return undefined; // 안 보이는 딜 → 정산도 비공개
    return db().settlements.find(
      (s) => s.deal_id === dealId && s.org_id === ctx.org.id,
    );
  }

  createSettlement(ctx: Ctx, input: NewSettlement): Settlement {
    // 담당범위 밖의 딜에는 정산을 만들 수 없다.
    if (input.deal_id && !this.getDeal(ctx, input.deal_id)) {
      throw new Error(`정산 생성 불가: 접근할 수 없는 딜 (${input.deal_id})`);
    }
    const base: SettlementBase = {
      down_payment: input.down_payment ?? 0,
      exec_amount: input.exec_amount ?? 0,
      fee_pct: input.fee_pct ?? 0,
      fee_paid_at: input.fee_paid_at ?? null,
    };
    const settlement: Settlement = {
      id: crypto.randomUUID(),
      org_id: ctx.org.id,
      deal_id: input.deal_id,
      ...base,
      down_paid_at: input.down_paid_at ?? null,
      ...derive(base),
      created_at: now(),
    };
    db().settlements.push(settlement);
    return settlement;
  }

  updateSettlement(
    ctx: Ctx,
    id: string,
    patch: SettlementPatch,
  ): Settlement | undefined {
    const s = this.getSettlement(ctx, id);
    if (!s) return undefined;

    if (patch.deal_id !== undefined) {
      if (patch.deal_id && !this.getDeal(ctx, patch.deal_id)) {
        throw new Error(`정산 수정 불가: 접근할 수 없는 딜 (${patch.deal_id})`);
      }
      s.deal_id = patch.deal_id;
    }
    if (patch.down_payment !== undefined)
      s.down_payment = patch.down_payment ?? 0;
    if (patch.exec_amount !== undefined) s.exec_amount = patch.exec_amount ?? 0;
    if (patch.fee_pct !== undefined) s.fee_pct = patch.fee_pct ?? 0;
    if (patch.fee_paid_at !== undefined)
      s.fee_paid_at = patch.fee_paid_at ?? null;
    if (patch.down_paid_at !== undefined)
      s.down_paid_at = patch.down_paid_at ?? null;

    Object.assign(s, derive(s));
    return s;
  }

  deleteSettlement(ctx: Ctx, id: string): boolean {
    if (!this.getSettlement(ctx, id)) return false;
    db().settlements = db().settlements.filter((x) => x.id !== id);
    return true;
  }
}
