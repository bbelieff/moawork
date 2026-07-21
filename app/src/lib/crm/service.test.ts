import { describe, it, expect, beforeEach } from "vitest";
import { CrmService, NotFoundError } from "./service";
import { ValidationError } from "./validation";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import {
  SEED_ORG_ID,
  SEED_USER_OWNER,
  SEED_USER_MEMBER,
} from "@/lib/repo/local/seed";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

let svc: CrmService;
let owner: Ctx;
let member: Ctx;

beforeEach(() => {
  resetDb();
  svc = new CrmService(getRepo());
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("파이프라인", () => {
  it("기본 파이프라인 + 5단계(마케팅→정산)", () => {
    const pipes = svc.listPipelines(owner);
    expect(pipes).toHaveLength(1);
    expect(pipes[0].stages.map((s) => s.name)).toEqual([
      "마케팅", "미팅", "계약", "실무", "정산",
    ]);
  });
});

describe("고객사 CRUD", () => {
  it("생성·조회·수정·삭제", () => {
    const c = svc.createCompany(owner, { name: "새회사", region: "서울" });
    expect(svc.getCompany(owner, c.id).name).toBe("새회사");
    const u = svc.updateCompany(owner, c.id, { region: "부산" });
    expect(u.region).toBe("부산");
    svc.deleteCompany(owner, c.id);
    expect(() => svc.getCompany(owner, c.id)).toThrow(NotFoundError);
  });
});

describe("딜 생성 · 기본 단계 배치 · 활동로그", () => {
  it("단계 미지정 시 첫 단계(마케팅)로 배치되고 status 활동이 남는다", () => {
    const deal = svc.createDeal(owner, { title: "신규 상담" });
    const firstStage = svc.listPipelines(owner)[0].stages[0];
    expect(deal.stage_id).toBe(firstStage.id);
    const acts = svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe("status");
    expect(acts[0].content).toBe("→ 마케팅");
  });

  it("존재하지 않는 단계로 생성 시 ValidationError", () => {
    expect(() => svc.createDeal(owner, { title: "x", stage_id: "ghost" })).toThrow(
      ValidationError,
    );
  });
});

describe("단계 이동", () => {
  it("이동 시 stage_id 갱신 + 이동 활동로그(from → to)", () => {
    const deal = svc.createDeal(owner, { title: "이동테스트" });
    const stages = svc.listPipelines(owner)[0].stages;
    const contractStage = stages.find((s) => s.kind === "contract");
    if (!contractStage) throw new Error("no contract stage");

    const moved = svc.moveDealStage(owner, deal.id, contractStage.id);
    expect(moved.stage_id).toBe(contractStage.id);

    const acts = svc.listActivities(owner, deal.id);
    // 최초 배치 + 이동 = 2건, 최신순
    expect(acts).toHaveLength(2);
    expect(acts[0].content).toBe("마케팅 → 계약");
  });

  it("존재하지 않는 단계로 이동 시 ValidationError", () => {
    const deal = svc.createDeal(owner, { title: "x" });
    expect(() => svc.moveDealStage(owner, deal.id, "ghost")).toThrow(ValidationError);
  });

  it("updateDeal 로 stage_id 를 바꾸려 하면 거부(=move 사용 유도)", () => {
    const deal = svc.createDeal(owner, { title: "x" });
    expect(() => svc.updateDeal(owner, deal.id, { stage_id: "any" })).toThrow(
      ValidationError,
    );
  });
});

describe("담당범위(scope) 격리", () => {
  it("member+assigned 는 본인 담당 딜만 보고, 남의 딜은 NotFound", () => {
    const ownerDeals = svc.listDeals(owner);
    const memberDeals = svc.listDeals(member);
    expect(ownerDeals.length).toBeGreaterThan(memberDeals.length);
    // admin 담당 딜(del...002)은 member 가 못 봄
    const adminDeal = ownerDeals.find((d) => d.assigned_to !== SEED_USER_MEMBER);
    if (!adminDeal) throw new Error("타인 담당 딜 없음");
    expect(() => svc.getDeal(member, adminDeal.id)).toThrow(NotFoundError);
    expect(() => svc.moveDealStage(member, adminDeal.id, ownerDeals[0].stage_id!)).toThrow(
      NotFoundError,
    );
  });

  it("member 가 만든 딜은 본인에게 배정된다", () => {
    const d = svc.createDeal(member, { title: "내 딜" });
    expect(d.assigned_to).toBe(SEED_USER_MEMBER);
  });
});

describe("활동 · 삭제", () => {
  it("메모 활동 추가", () => {
    const deal = svc.createDeal(owner, { title: "x" });
    svc.createActivity(owner, deal.id, { type: "memo", content: "첫 통화 완료" });
    const acts = svc.listActivities(owner, deal.id);
    expect(acts.some((a) => a.type === "memo" && a.content === "첫 통화 완료")).toBe(true);
  });

  it("딜 삭제 시 활동도 함께 제거", () => {
    const deal = svc.createDeal(owner, { title: "x" });
    svc.deleteDeal(owner, deal.id);
    expect(() => svc.getDeal(owner, deal.id)).toThrow(NotFoundError);
    // 삭제된 딜의 활동 조회는 NotFound
    expect(() => svc.listActivities(owner, deal.id)).toThrow(NotFoundError);
  });
});
