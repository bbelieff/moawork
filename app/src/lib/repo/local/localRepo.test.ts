import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import type { DealPatch } from "@/lib/repo";
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

// BUG-0003 회귀 방지 — updateDeal 이 custom 을 통째 교체하면 타 트랙 값이 **에러 없이**
// 사라진다(무증상 파손). 그래서 판정은 "throw 안 함"이 아니라 값 잔존의 긍정 확인이다.
describe("updateDeal — custom(jsonb) 키 단위 병합", () => {
  beforeEach(() => resetDb());

  /** T05 커스텀필드 · T09 정책자금 값이 이미 들어 있는 딜. */
  function dealWithCustom() {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const deal = repo.createDeal(owner, {
      title: "정책자금 딜",
      custom: {
        contract_status: "written", // T05 커스텀필드
        exec_amount: 100_000_000, // T09 정책자금
        fee_pct: 3,
        fee_paid_at: "2026-07-01",
      },
    });
    return { repo, owner, deal };
  }

  it("파일첨부(custom.files)를 저장해도 T05·T09 값이 남아 있다", () => {
    const { repo, owner, deal } = dealWithCustom();

    // 파일 트랙이 자기 키만 담아 보내는 상황 — 이전에는 여기서 전량 소실됐다.
    repo.updateDeal(owner, deal.id, {
      custom: { files: [{ id: "f1", name: "계약서.pdf" }] },
    });

    const custom = repo.getDeal(owner, deal.id)?.custom ?? {};
    expect(custom.contract_status).toBe("written");
    expect(custom.exec_amount).toBe(100_000_000);
    expect(custom.fee_pct).toBe(3);
    expect(custom.fee_paid_at).toBe("2026-07-01");
    expect(custom.files).toEqual([{ id: "f1", name: "계약서.pdf" }]);
  });

  it("같은 키만 대체하고 나머지는 유지한다", () => {
    const { repo, owner, deal } = dealWithCustom();
    repo.updateDeal(owner, deal.id, { custom: { fee_pct: 5 } });

    const custom = repo.getDeal(owner, deal.id)?.custom ?? {};
    expect(custom.fee_pct).toBe(5);
    expect(custom.exec_amount).toBe(100_000_000);
    expect(custom.contract_status).toBe("written");
  });

  it("null 값은 그 키만 지운다(다른 키는 그대로)", () => {
    const { repo, owner, deal } = dealWithCustom();
    repo.updateDeal(owner, deal.id, { custom: { fee_paid_at: null } });

    const custom = repo.getDeal(owner, deal.id)?.custom ?? {};
    expect("fee_paid_at" in custom).toBe(false);
    expect(custom.exec_amount).toBe(100_000_000);
  });

  it("custom 이 없는 패치는 custom 을 건드리지 않는다", () => {
    const { repo, owner, deal } = dealWithCustom();
    repo.updateDeal(owner, deal.id, { title: "제목만 변경" });

    const d = repo.getDeal(owner, deal.id);
    expect(d?.title).toBe("제목만 변경");
    expect(d?.custom.exec_amount).toBe(100_000_000);
    expect(d?.custom.contract_status).toBe("written");
  });

  it("배열 값은 통째 대체된다 — 지운 첨부가 되살아나지 않는다", () => {
    const { repo, owner, deal } = dealWithCustom();
    repo.updateDeal(owner, deal.id, { custom: { files: [{ id: "f1" }, { id: "f2" }] } });
    repo.updateDeal(owner, deal.id, { custom: { files: [{ id: "f2" }] } });

    expect(repo.getDeal(owner, deal.id)?.custom.files).toEqual([{ id: "f2" }]);
  });
});

// "단계 변경은 move 전용(활동로그 보장)" 불변식 — 서비스 계층이 아니라 **포트**에서 강제된다.
describe("moveDeal — 단계 변경의 유일한 경로", () => {
  beforeEach(() => resetDb());

  function fixture() {
    const repo = new LocalRepo();
    const owner = ctxFor(SEED_USER_OWNER, "owner", "all");
    const pipeline = repo.listPipelines(SEED_ORG_ID)[0];
    const stages = repo.listStages(pipeline.id);
    const deal = repo.createDeal(owner, {
      title: "이동 대상",
      pipeline_id: pipeline.id,
      stage_id: stages[0].id,
    });
    return { repo, owner, stages, deal };
  }

  it("updateDeal 로 단계를 바꾸려 하면 throw 하고 단계도 그대로다", () => {
    const { repo, owner, stages, deal } = fixture();
    // 타입에는 stage_id 가 없다 — 런타임(JSON 본문) 우회를 흉내낸다.
    const sneaky = { stage_id: stages[2].id } as unknown as DealPatch;

    expect(() => repo.updateDeal(owner, deal.id, sneaky)).toThrow();
    expect(repo.getDeal(owner, deal.id)?.stage_id).toBe(stages[0].id);
    expect(repo.listActivities(owner, deal.id)).toHaveLength(0);
  });

  it("이동하면 stage_id 갱신 + 이동 활동로그(from → to)를 함께 남긴다", () => {
    const { repo, owner, stages, deal } = fixture();
    const moved = repo.moveDeal(owner, deal.id, stages[2].id);

    expect(moved?.stage_id).toBe(stages[2].id);
    const acts = repo.listActivities(owner, deal.id);
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe("status");
    expect(acts[0].content).toBe(`${stages[0].name} → ${stages[2].name}`);
  });

  it("존재하지 않는 단계면 throw 하고 아무것도 바뀌지 않는다", () => {
    const { repo, owner, stages, deal } = fixture();
    expect(() => repo.moveDeal(owner, deal.id, "ghost")).toThrow();
    expect(repo.getDeal(owner, deal.id)?.stage_id).toBe(stages[0].id);
    expect(repo.listActivities(owner, deal.id)).toHaveLength(0);
  });

  it("담당범위 밖의 딜은 undefined — 이동도 로그도 없다", () => {
    const { repo, owner, stages, deal } = fixture();
    // owner 가 만든 딜은 owner 담당 → member+assigned 에게는 보이지 않는다.
    const member = ctxFor(SEED_USER_MEMBER, "member", "assigned");

    expect(repo.moveDeal(member, deal.id, stages[2].id)).toBeUndefined();
    expect(repo.getDeal(owner, deal.id)?.stage_id).toBe(stages[0].id);
    expect(repo.listActivities(owner, deal.id)).toHaveLength(0);
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
