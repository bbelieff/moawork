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
import { isManager } from "@/lib/auth/roles";
import type { Repo } from "../index";
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

  // ── 고객사 / 딜 (담당범위 적용) ──
  listCompanies(ctx: Ctx): Company[] {
    const all = db().companies.filter((c) => c.org_id === ctx.org.id);
    return canSeeAll(ctx)
      ? all
      : all.filter((c) => c.assigned_to === ctx.user.id);
  }

  listDeals(ctx: Ctx): Deal[] {
    const all = db().deals.filter((d) => d.org_id === ctx.org.id);
    return canSeeAll(ctx)
      ? all
      : all.filter((d) => d.assigned_to === ctx.user.id);
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
