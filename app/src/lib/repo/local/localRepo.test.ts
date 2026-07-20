import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { installPolicyfundPreset } from "@/lib/presets/policyfund";
import { FEATURES } from "@/lib/product";
import { LocalRepo } from "./localRepo";
import { resetDb } from "./store";
import { SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "./seed";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = new LocalRepo();
  const org = repo.getOrg(SEED_ORG_ID);
  const user = repo.getUser(userId);
  if (!org || !user) throw new Error("seed 누락");
  return { user, org, role, scope };
}

describe("LocalRepo 담당범위(scope)", () => {
  beforeEach(() => resetDb());

  it("member+assigned 는 본인 담당 딜만 본다", () => {
    const repo = new LocalRepo();
    const deals = repo.listDeals(ctxFor(SEED_USER_MEMBER, "member", "assigned"));
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.assigned_to === SEED_USER_MEMBER)).toBe(true);
  });

  it("owner 는 조직 전체 딜을 본다 (member 보다 많음)", () => {
    const repo = new LocalRepo();
    const ownerDeals = repo.listDeals(ctxFor(SEED_USER_OWNER, "owner", "all"));
    const memberDeals = repo.listDeals(
      ctxFor(SEED_USER_MEMBER, "member", "assigned"),
    );
    expect(ownerDeals.length).toBeGreaterThan(memberDeals.length);
  });

  it("고객사도 담당범위가 적용된다", () => {
    const repo = new LocalRepo();
    const memberCos = repo.listCompanies(
      ctxFor(SEED_USER_MEMBER, "member", "assigned"),
    );
    expect(memberCos.every((c) => c.assigned_to === SEED_USER_MEMBER)).toBe(
      true,
    );
  });
});

describe("정책자금 프리셋 설치", () => {
  beforeEach(() => resetDb());

  it("설치 시 딜 field_defs 를 생성하고 엔타이틀먼트를 켠다", () => {
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const repo = new LocalRepo();
    const before = repo.listFieldDefs(SEED_ORG_ID, "deal").length;

    const created = installPolicyfundPreset(owner);
    expect(created.length).toBeGreaterThan(0);

    const after = repo.listFieldDefs(SEED_ORG_ID, "deal").length;
    expect(after).toBe(before + created.length);
    expect(repo.isFeatureEnabled(SEED_ORG_ID, FEATURES.policyfund)).toBe(true);
  });

  it("재설치해도 중복 생성하지 않는다(idempotent)", () => {
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    installPolicyfundPreset(owner);
    const second = installPolicyfundPreset(owner);
    expect(second.length).toBe(0);
  });
});

describe("createOrg auto-owner", () => {
  beforeEach(() => resetDb());

  it("조직 생성 시 생성자를 owner 로 자동 등록한다", () => {
    const repo = new LocalRepo();
    const creator = repo.getUser(SEED_USER_MEMBER);
    if (!creator) throw new Error("seed 누락");
    const { org, member } = repo.createOrg({ name: "새 조직" }, creator);
    expect(member.role).toBe("owner");
    expect(repo.listMembers(org.id).some((m) => m.user_id === creator.id)).toBe(
      true,
    );
  });
});
