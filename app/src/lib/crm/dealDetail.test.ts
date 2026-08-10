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
import { NotFoundError } from "./service";

/**
 * 딜 상세 화면이 의존하는 데이터 계약 (T02).
 * 페이지는 서버 컴포넌트라 직접 렌더 대신, 화면이 부르는 조합을 그대로 검증한다.
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
  svc = new AsyncCrmService(new LocalCrmSource());
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("딜 상세 — 데이터 조합", () => {
  it("딜·활동·단계·고객사를 함께 얻을 수 있다", async () => {
    const companies = await svc.listCompanies(owner);
    const deal = await svc.createDeal(owner, {
      title: "상세 대상",
      company_id: companies[0]?.id ?? null,
    });

    const [activities, pipelines] = await Promise.all([
      svc.listActivities(owner, deal.id),
      svc.listPipelines(owner),
    ]);
    const stage = pipelines
      .flatMap((p) => p.stages)
      .find((s) => s.id === deal.stage_id);

    expect(activities).toHaveLength(1); // 생성 로그
    expect(stage).toBeTruthy();
    if (companies[0]) {
      expect((await svc.getCompany(owner, companies[0].id)).id).toBe(
        companies[0].id,
      );
    }
  });

  it("담당범위 밖 딜은 NotFound — 상세가 404 로 수렴한다", async () => {
    const deal = await svc.createDeal(owner, { title: "오너 전용" });
    await expect(svc.getDeal(member, deal.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("딜 상세 — 단계 이동 액션", () => {
  it("이동하면 단계가 바뀌고 활동로그가 쌓인다", async () => {
    const deal = await svc.createDeal(owner, { title: "이동" });
    const stages = (await svc.listPipelines(owner)).flatMap((p) => p.stages);
    const next = stages.find((s) => s.id !== deal.stage_id)!;

    await svc.moveDealStage(owner, deal.id, next.id);

    expect((await svc.getDeal(owner, deal.id)).stage_id).toBe(next.id);
    expect(await svc.listActivities(owner, deal.id)).toHaveLength(2);
  });
});

describe("딜 상세 — 계약상황(커스텀필드) 저장", () => {
  it("custom 키 병합이라 다른 커스텀 값을 덮지 않는다", async () => {
    const deal = await svc.createDeal(owner, {
      title: "계약상황",
      custom: { 기존키: "보존되어야함" },
    });

    await svc.updateDeal(owner, deal.id, { custom: { 계약상황: "signed" } });

    const after = await svc.getDeal(owner, deal.id);
    expect(after.custom.계약상황).toBe("signed");
    expect(after.custom.기존키).toBe("보존되어야함"); // 통째 교체였다면 사라진다
  });

  it("null 을 주면 해당 키만 지운다", async () => {
    const deal = await svc.createDeal(owner, {
      title: "삭제",
      custom: { 계약상황: "draft", 다른키: "유지" },
    });

    await svc.updateDeal(owner, deal.id, { custom: { 계약상황: null } });

    const after = await svc.getDeal(owner, deal.id);
    expect(after.custom.계약상황).toBeUndefined();
    expect(after.custom.다른키).toBe("유지");
  });
});

describe("딜 상세 — 활동 추가", () => {
  it("메모를 남기면 목록 맨 앞(최신)에 온다", async () => {
    const deal = await svc.createDeal(owner, { title: "메모" });
    await svc.createActivity(owner, deal.id, {
      type: "memo",
      content: "첫 상담 완료",
    });

    const acts = await svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(2);
    expect(acts[0].content).toBe("첫 상담 완료");
  });

  it("담당범위 밖 딜에는 활동을 남길 수 없다", async () => {
    const deal = await svc.createDeal(owner, { title: "남의 딜" });
    await expect(
      svc.createActivity(member, deal.id, { type: "memo", content: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
