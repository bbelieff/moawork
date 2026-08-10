import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import {
  SEED_ORG_ID,
  SEED_USER_MEMBER,
  SEED_USER_OWNER,
} from "@/lib/repo/local/seed";
import { LocalCrmSource } from "@/lib/repo/supabase";
import { AsyncCrmService } from "./asyncService";
import { CrmService, NotFoundError } from "./service";
import { ValidationError } from "./validation";

/**
 * 비동기 서비스가 동기 서비스와 **같은 규칙**으로 도는지 확인한다.
 * 두 구현이 갈라지면 Supabase 연결 시 로컬과 다르게 동작하므로 여기서 잡는다.
 */

let owner: Ctx;
let member: Ctx;
let svc: AsyncCrmService;

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

beforeEach(() => {
  resetDb();
  // 로컬 소스를 명시 주입 — 환경변수 유무와 무관하게 결정적으로 돈다.
  svc = new AsyncCrmService(new LocalCrmSource());
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("AsyncCrmService — 딜 생성", () => {
  it("단계 미지정이면 기본 파이프라인 첫 단계로 배치하고 활동로그 1건을 남긴다", async () => {
    const deal = await svc.createDeal(owner, { title: "새 딜" });
    expect(deal.stage_id).toBeTruthy();

    const acts = await svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe("status");
  });

  it("없는 단계를 지정하면 ValidationError", async () => {
    await expect(
      svc.createDeal(owner, { title: "x", stage_id: "nope" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("AsyncCrmService — 단계 이동", () => {
  it("이동하면 stage_id 가 바뀌고 활동로그가 1건 늘어난다", async () => {
    const deal = await svc.createDeal(owner, { title: "이동 대상" });
    const pipelines = await svc.listPipelines(owner);
    const stages = pipelines[0].stages;
    const next = stages.find((s) => s.id !== deal.stage_id)!;

    const moved = await svc.moveDealStage(owner, deal.id, next.id);
    expect(moved.stage_id).toBe(next.id);

    const acts = await svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(2); // 생성 1 + 이동 1
  });

  it("없는 단계로 이동하면 ValidationError", async () => {
    const deal = await svc.createDeal(owner, { title: "x" });
    await expect(
      svc.moveDealStage(owner, deal.id, "nope"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateDeal 로는 단계를 바꿀 수 없다", async () => {
    const deal = await svc.createDeal(owner, { title: "x" });
    await expect(
      svc.updateDeal(owner, deal.id, { stage_id: "any" } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("AsyncCrmService — 담당범위(?as=member)", () => {
  it("member 는 남의 딜을 목록에서 보지 못한다", async () => {
    // 시드에 기존 딜이 있어 절대 개수가 아니라 증분으로 본다.
    const beforeMember = (await svc.listDeals(member)).length;
    const beforeOwner = (await svc.listDeals(owner)).length;

    await svc.createDeal(owner, { title: "오너 딜" });

    expect((await svc.listDeals(member)).length).toBe(beforeMember); // 안 보임
    expect((await svc.listDeals(owner)).length).toBe(beforeOwner + 1);
  });

  it("owner 는 조직 전체를 보고 member 는 본인 담당만 본다", async () => {
    expect((await svc.listDeals(owner)).length).toBeGreaterThan(
      (await svc.listDeals(member)).length,
    );
    for (const d of await svc.listDeals(member)) {
      expect(d.assigned_to).toBe(member.user.id);
    }
  });

  it("member 가 남의 딜을 단건 조회하면 NotFound(존재 유출 방지)", async () => {
    const deal = await svc.createDeal(owner, { title: "오너 딜" });
    await expect(svc.getDeal(member, deal.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("member 가 만든 딜은 본인 담당으로 고정된다", async () => {
    const before = (await svc.listDeals(member)).length;
    const deal = await svc.createDeal(member, {
      title: "내 딜",
      assigned_to: owner.user.id, // 무시되어야 한다
    });
    expect(deal.assigned_to).toBe(member.user.id);
    expect((await svc.listDeals(member)).length).toBe(before + 1);
  });
});

describe("동기 서비스와의 파리티", () => {
  it("같은 입력에 대해 동일한 단계 배치·활동로그 수를 만든다", async () => {
    const asyncDeal = await svc.createDeal(owner, { title: "비동기" });
    const syncDeal = new CrmService().createDeal(owner, { title: "동기" });

    expect(asyncDeal.stage_id).toBe(syncDeal.stage_id);
    expect((await svc.listActivities(owner, asyncDeal.id)).length).toBe(
      new CrmService().listActivities(owner, syncDeal.id).length,
    );
  });
});
