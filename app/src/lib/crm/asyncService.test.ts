import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx, Deal, MemberRole, MemberScope } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { db, resetDb } from "@/lib/repo/local/store";
import {
  SEED_ORG_ID,
  SEED_USER_MEMBER,
  SEED_USER_OWNER,
} from "@/lib/repo/local/seed";
import { LocalCrmSource } from "@/lib/repo/supabase";
import { CaseTaskMutationError, shouldRetryCaseTaskMutation } from "@/lib/repo/supabase/source";
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

function seedDeal(ctx: Ctx, input: Parameters<ReturnType<typeof getRepo>["createDeal"]>[1]): Deal {
  const repo = getRepo();
  const pipeline = repo.listPipelines(ctx.org.id)[0];
  const stage = pipeline ? repo.listStages(pipeline.id)[0] : undefined;
  const company = repo.listCompanies(ctx)[0];
  const deal = repo.createDeal(ctx, {
    ...input,
    company_id: input.company_id ?? company?.id ?? null,
    pipeline_id: input.pipeline_id ?? pipeline?.id ?? null,
    stage_id: input.stage_id ?? stage?.id ?? null,
  });
  const template = db().boardItems[0];
  if (!template) throw new Error("board item seed missing");
  db().boardItems.push({ ...template, id: crypto.randomUUID(), deal_id: deal.id });
  if (stage) repo.createActivity(ctx, { deal_id: deal.id, type: "status", content: `미지정 → ${stage.name}` });
  return deal;
}

beforeEach(() => {
  resetDb();
  // 로컬 소스를 명시 주입 — 환경변수 유무와 무관하게 결정적으로 돈다.
  svc = new AsyncCrmService(new LocalCrmSource());
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

describe("AsyncCrmService — 딜 생성", () => {
  it("회사-start receipt 밖의 임의 Case 생성을 service와 source 모두 fail-close한다", async () => {
    await expect(svc.createDeal(owner, { title: "새 딜" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new LocalCrmSource().createDeal(owner, { title: "새 딜" })).rejects.toThrow(/canonical 업무 시작/);
  });

  it("Case delete를 service와 source 양쪽에서 fail-close한다", async () => {
    const deal = seedDeal(owner, { title: "삭제 불가" });
    await expect(svc.deleteDeal(owner, deal.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(new LocalCrmSource().deleteDeal(owner, deal.id)).rejects.toThrow(/deletion is not supported/);
    await expect(svc.getDeal(owner, deal.id)).resolves.toMatchObject({ id: deal.id });
  });
});

describe("AsyncCrmService — 단계 이동", () => {
  it("이동하면 stage_id 가 바뀌고 활동로그가 1건 늘어난다", async () => {
    const deal = seedDeal(owner, { title: "이동 대상" });
    const pipelines = await svc.listPipelines(owner);
    const stages = pipelines[0].stages;
    const next = stages.find((s) => s.id !== deal.stage_id)!;

    const moved = await svc.moveDealStage(owner, deal.id, next.id, { requestId: crypto.randomUUID(), expectedVersion: deal.case_version ?? 0 });
    expect(moved.stage_id).toBe(next.id);

    const acts = await svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(2); // 생성 1 + 이동 1
  });

  it("commit 후 target stage가 삭제돼도 같은 intent는 source receipt로 replay한다", async () => {
    const deal = seedDeal(owner, { title: "replay 대상" });
    const next = (await svc.listPipelines(owner))[0].stages.find((stage) => stage.id !== deal.stage_id)!;
    const identity = { requestId: crypto.randomUUID(), expectedVersion: deal.case_version ?? 0 };

    const first = await svc.moveDealStage(owner, deal.id, next.id, identity);
    const stageIndex = db().stages.findIndex((stage) => stage.id === next.id);
    db().stages.splice(stageIndex, 1);

    await expect(svc.moveDealStage(owner, deal.id, next.id, identity)).resolves.toMatchObject({
      id: first.id,
      stage_id: next.id,
      case_version: first.case_version,
    });
  });

  it("없는 단계로 이동하면 ValidationError", async () => {
    const deal = seedDeal(owner, { title: "x" });
    await expect(
      svc.moveDealStage(owner, deal.id, "nope", { requestId: crypto.randomUUID(), expectedVersion: deal.case_version ?? 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateDeal 로는 단계를 바꿀 수 없다", async () => {
    const deal = seedDeal(owner, { title: "x" });
    await expect(
      svc.updateDeal(owner, deal.id, { stage_id: "any" } as never),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updateDeal 로는 Case 소유권 필드를 바꿀 수 없다", async () => {
    const deal = seedDeal(owner, { title: "x" });
    for (const patch of [{ company_id: "company" }, { pipeline_id: "pipeline" }, { assigned_to: "user" }]) {
      await expect(svc.updateDeal(owner, deal.id, patch as never)).rejects.toBeInstanceOf(ValidationError);
    }
  });
});

describe("AsyncCrmService — 오늘 할 일 원자 변경", () => {
  it("custom patch와 Activity를 한 intent로 저장하고 exact replay/mismatch를 구분한다", async () => {
    const deal = seedDeal(owner, { title: "오늘 할 일" });
    const requestId = crypto.randomUUID();
    const beforeActivities = (await svc.listActivities(owner, deal.id)).length;
    const input = {
      kind: "complete" as const,
      requestId,
    };

    await expect(svc.mutateCaseTask(owner, deal.id, input)).resolves.toMatchObject({ replayed: false });
    expect((await svc.getDeal(owner, deal.id)).custom).toMatchObject({
      task_status: "done",
      task_completed_at: expect.any(String),
    });
    expect(await svc.listActivities(owner, deal.id)).toHaveLength(beforeActivities + 1);
    await expect(svc.mutateCaseTask(owner, deal.id, input)).resolves.toMatchObject({ replayed: true });
    expect(await svc.listActivities(owner, deal.id)).toHaveLength(beforeActivities + 1);
    const mismatch = await svc.mutateCaseTask(owner, deal.id, {
      kind: "postpone",
      dueDate: "2026-09-01",
      requestId,
    }).catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(CaseTaskMutationError);
    expect(mismatch).toMatchObject({ outcome: "terminal", code: "22023" });
    expect(shouldRetryCaseTaskMutation(mismatch)).toBe(false);

    const transport = vi.spyOn(LocalCrmSource.prototype, "mutateCaseTask")
      .mockRejectedValueOnce(new Error("response lost after commit"));
    try {
      const unknown = await svc.mutateCaseTask(owner, deal.id, {
        kind: "complete",
        requestId: crypto.randomUUID(),
      }).catch((error: unknown) => error);
      expect(unknown).toMatchObject({ outcome: "retryable_unknown" });
      expect(shouldRetryCaseTaskMutation(unknown)).toBe(true);
    } finally {
      transport.mockRestore();
    }
  });

  it("missing requestId와 Activity failure 모두 custom/Activity 부분 성공을 남기지 않는다", async () => {
    const deal = seedDeal(owner, { title: "원자 롤백", custom: { preserved: "yes" } });
    const before = {
      custom: structuredClone(deal.custom),
      activities: (await svc.listActivities(owner, deal.id)).length,
    };

    await expect(svc.mutateCaseTask(owner, deal.id, {
      kind: "complete",
      requestId: "",
    })).rejects.toThrow(/requestId/);
    expect((await svc.getDeal(owner, deal.id)).custom).toEqual(before.custom);

    const createActivity = vi.spyOn(getRepo(), "createActivity").mockImplementation(() => {
      throw new Error("forced task activity failure");
    });
    try {
      await expect(svc.mutateCaseTask(owner, deal.id, {
        kind: "postpone",
        dueDate: "2026-09-02",
        requestId: crypto.randomUUID(),
      })).rejects.toThrow(/forced task activity failure/);
    } finally {
      createActivity.mockRestore();
    }
    expect((await svc.getDeal(owner, deal.id)).custom).toEqual(before.custom);
    expect(await svc.listActivities(owner, deal.id)).toHaveLength(before.activities);
  });
});

describe("AsyncCrmService — 담당범위(?as=member)", () => {
  it("member 는 남의 딜을 목록에서 보지 못한다", async () => {
    // 시드에 기존 딜이 있어 절대 개수가 아니라 증분으로 본다.
    const beforeMember = (await svc.listDeals(member)).length;
    const beforeOwner = (await svc.listDeals(owner)).length;

    seedDeal(owner, { title: "오너 딜" });

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
    const deal = seedDeal(owner, { title: "오너 딜" });
    await expect(svc.getDeal(member, deal.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("member 가 만든 딜은 본인 담당으로 고정된다", async () => {
    const before = (await svc.listDeals(member)).length;
    const deal = seedDeal(member, {
      title: "내 딜",
      assigned_to: owner.user.id, // 무시되어야 한다
    });
    expect(deal.assigned_to).toBe(member.user.id);
    expect((await svc.listDeals(member)).length).toBe(before + 1);
  });
});

describe("AsyncCrmService — 담당자 재배정 (BBE-16)", () => {
  it("배정이 바뀌면 assigned_to 가 갱신되고 활동로그(type=assignment)가 1건 남는다", async () => {
    const deal = seedDeal(owner, { title: "재배정 대상" });
    const before = (await svc.listActivities(owner, deal.id)).length;

    const updated = await svc.reassignDeal(owner, deal.id, member.user.id, {
      fromName: null,
      toName: "멤버",
    });

    expect(updated.assigned_to).toBe(member.user.id);
    const acts = await svc.listActivities(owner, deal.id);
    expect(acts).toHaveLength(before + 1);
    // listActivities 반환 순서(최신 우선/삽입 순)에 기대지 않고 내용으로 찾는다.
    const assignmentLog = acts.find((a) => a.type === "assignment");
    expect(assignmentLog).toBeDefined();
    expect(assignmentLog!.content).toContain("멤버");
  });

  it("실제로 바뀌지 않으면(같은 담당자로 재지정) 활동로그를 추가하지 않는다", async () => {
    const deal = seedDeal(owner, {
      title: "동일 재배정",
      assigned_to: owner.user.id,
    });
    const before = (await svc.listActivities(owner, deal.id)).length;

    await svc.reassignDeal(owner, deal.id, owner.user.id, {
      fromName: "오너",
      toName: "오너",
    });

    expect(await svc.listActivities(owner, deal.id)).toHaveLength(before);
  });

  it("member(scope=assigned)가 자기 담당 딜을 남에게 재배정하려 하면 무시되고, 로그도 남기지 않는다", async () => {
    // canSeeAll(ctx) 가 false 면 원자 재배정 포트가 변경을 조용히 무시한다.
    const deal = seedDeal(member, { title: "권한 없는 재배정" }); // 자동으로 본인 배정
    const before = (await svc.listActivities(member, deal.id)).length;

    const result = await svc.reassignDeal(member, deal.id, owner.user.id, {
      fromName: "멤버",
      toName: "오너",
    });

    expect(result.assigned_to).toBe(member.user.id); // 안 바뀜(권한 없음)
    expect(await svc.listActivities(member, deal.id)).toHaveLength(before);
  });

  it("로컬 활동로그 쓰기가 실패해도 담당자 변경을 롤백한다", async () => {
    const deal = seedDeal(owner, { title: "원자 재배정" });
    const beforeAssignedTo = deal.assigned_to;
    const beforeUpdatedAt = deal.updated_at;
    const createActivity = vi
      .spyOn(getRepo(), "createActivity")
      .mockImplementation(() => {
        throw new Error("forced activity failure");
      });

    try {
      await expect(
        svc.reassignDeal(owner, deal.id, member.user.id, {
          fromName: "오너",
          toName: "멤버",
        }),
      ).rejects.toThrow("forced activity failure");
      const stored = await svc.getDeal(owner, deal.id);
      expect(stored.assigned_to).toBe(beforeAssignedTo);
      expect(stored.updated_at).toBe(beforeUpdatedAt);
    } finally {
      createActivity.mockRestore();
    }
  });

  it("없는 딜이면 NotFoundError", async () => {
    await expect(
      svc.reassignDeal(owner, "nope", member.user.id, { fromName: null, toName: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("동기 서비스와의 파리티", () => {
  it("같은 입력에 대해 동일한 단계 배치·활동로그 수를 만든다", async () => {
    const asyncDeal = seedDeal(owner, { title: "비동기" });
    const syncDeal = new CrmService().createDeal(owner, { title: "동기" });

    expect(asyncDeal.stage_id).toBe(syncDeal.stage_id);
    expect((await svc.listActivities(owner, asyncDeal.id)).length).toBe(
      new CrmService().listActivities(owner, syncDeal.id).length,
    );
  });
});
