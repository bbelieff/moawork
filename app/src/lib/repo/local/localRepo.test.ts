import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { installPolicyfundPreset } from "@/lib/presets/policyfund";
import { FEATURES, MVP_ENABLED_FEATURES } from "@/lib/product";
import { LocalRepo } from "./localRepo";
import { resetDb } from "./store";
import {
  SEED_ORG_ID,
  SEED_USER_ADMIN,
  SEED_USER_MEMBER,
  SEED_USER_OWNER,
} from "./seed";

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

  // BUG-0001 회귀 방지: 엔타이틀먼트가 없으면 새 조직에서 MVP 기능이 전부 잠긴다.
  it("신규 조직에 MVP 기본 엔타이틀먼트를 부여한다 (BUG-0001)", () => {
    const repo = new LocalRepo();
    const creator = repo.getUser(SEED_USER_OWNER);
    if (!creator) throw new Error("seed 누락");
    const { org } = repo.createOrg({ name: "엔타이틀먼트 조직" }, creator);

    for (const key of MVP_ENABLED_FEATURES) {
      expect(repo.isFeatureEnabled(org.id, key)).toBe(true);
    }
    // Phase 2(벤더) 기능은 여전히 잠겨 있어야 한다.
    expect(repo.isFeatureEnabled(org.id, FEATURES.notify)).toBe(false);
    expect(repo.isFeatureEnabled(org.id, FEATURES.hometax)).toBe(false);
  });
});

describe("정산(settlements) 포트", () => {
  beforeEach(() => resetDb());

  // 담당자별 딜 id 를 owner 시점에서 뽑는다(시드는 member/admin 에 나눠 배정됨).
  function dealIdAssignedTo(userId: string): string {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const d = repo.listDeals(owner).find((x) => x.assigned_to === userId);
    if (!d) throw new Error("시드 딜 누락");
    return d.id;
  }

  it("파생 컬럼을 001 generated column 과 동일하게 계산한다", () => {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const s = repo.createSettlement(owner, {
      deal_id: dealIdAssignedTo(SEED_USER_MEMBER),
      down_payment: 10_000_000,
      exec_amount: 100_000_000,
      fee_pct: 3,
      fee_paid_at: "2026-07-01",
    });

    expect(s.fee_amount).toBe(3_000_000); // round(1억 × 3 / 100)
    expect(s.total_revenue).toBe(13_000_000); // 계약금 + 수수료
    expect(s.d180).toBe("2026-12-28");
    expect(s.d365).toBe("2027-07-01");
  });

  it("입금일이 없으면 d180/d365 는 null", () => {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const s = repo.createSettlement(owner, {
      deal_id: dealIdAssignedTo(SEED_USER_MEMBER),
      exec_amount: 50_000_000,
      fee_pct: 2,
    });
    expect(s.fee_amount).toBe(1_000_000);
    expect(s.d180).toBeNull();
    expect(s.d365).toBeNull();
  });

  it("수정하면 파생 컬럼을 재계산한다", () => {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const s = repo.createSettlement(owner, {
      deal_id: dealIdAssignedTo(SEED_USER_MEMBER),
      exec_amount: 100_000_000,
      fee_pct: 3,
    });
    const updated = repo.updateSettlement(owner, s.id, { fee_pct: 5 });
    expect(updated?.fee_amount).toBe(5_000_000);
    expect(updated?.total_revenue).toBe(5_000_000);
  });

  it("담당범위: member 는 본인 딜의 정산만 본다", () => {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    repo.createSettlement(owner, {
      deal_id: dealIdAssignedTo(SEED_USER_MEMBER),
      exec_amount: 10_000_000,
      fee_pct: 3,
    });
    repo.createSettlement(owner, {
      deal_id: dealIdAssignedTo(SEED_USER_ADMIN),
      exec_amount: 20_000_000,
      fee_pct: 3,
    });

    const member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
    const mine = repo.listSettlements(member);
    const visibleDeals = new Set(repo.listDeals(member).map((d) => d.id));

    expect(repo.listSettlements(owner)).toHaveLength(2);
    expect(mine).toHaveLength(1);
    expect(mine.every((s) => s.deal_id && visibleDeals.has(s.deal_id))).toBe(
      true,
    );
  });

  it("접근 불가 딜에는 정산을 만들 수 없다", () => {
    const repo = new LocalRepo();
    const member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
    const othersDeal = dealIdAssignedTo(SEED_USER_ADMIN);
    expect(() =>
      repo.createSettlement(member, { deal_id: othersDeal, exec_amount: 1 }),
    ).toThrow();
  });
});
