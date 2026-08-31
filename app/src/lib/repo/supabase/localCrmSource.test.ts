import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { LocalRepo } from "@/lib/repo/local/localRepo";
import { db, resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_ADMIN, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { LocalCrmSource } from "./localCrmSource";
import { CaseTaskMutationError, shouldRetryCaseTaskMutation } from "./source";

function owner(): Ctx {
  const repo = new LocalRepo();
  const org = repo.getOrg(SEED_ORG_ID);
  const user = repo.getUser(SEED_USER_OWNER);
  if (!org || !user) throw new Error("seed missing");
  return { org, user, role: "owner", scope: "all" };
}

function assignedMember(): Ctx {
  const repo = new LocalRepo();
  const org = repo.getOrg(SEED_ORG_ID);
  const user = repo.getUser(SEED_USER_MEMBER);
  if (!org || !user) throw new Error("seed missing");
  return { org, user, role: "member", scope: "assigned" };
}

function addProjection(dealId: string) {
  const template = db().boardItems[0];
  if (!template) throw new Error("board item seed missing");
  db().boardItems.push({ ...template, id: crypto.randomUUID(), deal_id: dealId });
}

describe("LocalCrmSource canonical Case parity", () => {
  beforeEach(resetDb);

  it("replays stage and Activity intents and rejects mismatch/stale without partial writes", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    const originalStageId = current.stage_id!;
    const target = (await source.listStages(current.pipeline_id!)).find((stage) => stage.id !== current.stage_id)!;
    const moveId = crypto.randomUUID();
    const moved = await source.moveDeal(ctx, current.id, target.id, { requestId: moveId, expectedVersion: 0 });
    const count = (await source.listActivities(ctx, current.id)).length;
    const targetIndex = db().stages.findIndex((stage) => stage.id === target.id);
    db().stages.splice(targetIndex, 1);
    expect((await source.moveDeal(ctx, current.id, target.id, { requestId: moveId, expectedVersion: 0 }))?.case_version).toBe(1);
    expect((await source.listActivities(ctx, current.id))).toHaveLength(count);
    await expect(source.moveDeal(ctx, current.id, originalStageId, { requestId: moveId, expectedVersion: 0 })).rejects.toThrow(/mismatch/);
    await expect(source.moveDeal(ctx, current.id, originalStageId, { requestId: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow(/conflict/);
    expect(moved?.pipeline_id).toBe(target.pipeline_id);

    const activityId = crypto.randomUUID();
    const input = { deal_id: current.id, type: "memo", content: "same intent" };
    const first = await source.createActivity(ctx, input, activityId);
    expect((await source.createActivity(ctx, input, activityId)).id).toBe(first.id);
    await expect(source.createActivity(ctx, { ...input, content: "changed" }, activityId)).rejects.toThrow(/mismatch/);
  });

  it("atomically mutates task custom + Activity with replay, mismatch, and rollback parity", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    const requestId = crypto.randomUUID();
    const beforeActivities = db().activities.length;
    const complete = {
      kind: "complete" as const,
      requestId,
    };

    await expect(source.mutateCaseTask(ctx, current.id, complete)).resolves.toMatchObject({ replayed: false });
    expect(current.custom).toMatchObject({ task_status: "done", task_completed_at: expect.any(String) });
    expect(db().activities).toHaveLength(beforeActivities + 1);
    await expect(source.mutateCaseTask(ctx, current.id, complete)).resolves.toMatchObject({ replayed: true });
    expect(db().activities).toHaveLength(beforeActivities + 1);
    const mismatch = await source.mutateCaseTask(ctx, current.id, {
      kind: "postpone",
      dueDate: "2026-09-01",
      requestId,
    }).catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(CaseTaskMutationError);
    expect(mismatch).toMatchObject({ outcome: "terminal", code: "22023" });
    expect(shouldRetryCaseTaskMutation(mismatch)).toBe(false);

    const beforeRollback = { custom: structuredClone(current.custom), activities: db().activities.length };
    const createActivity = vi.spyOn(getRepo(), "createActivity").mockImplementation(() => {
      throw new Error("injected activity failure");
    });
    try {
      await expect(source.mutateCaseTask(ctx, current.id, {
        kind: "postpone",
        dueDate: "2026-09-02",
        requestId: crypto.randomUUID(),
      })).rejects.toThrow(/injected activity failure/);
    } finally {
      createActivity.mockRestore();
    }
    expect(current.custom).toEqual(beforeRollback.custom);
    expect(db().activities).toHaveLength(beforeRollback.activities);
  });

  it("fails closed for arbitrary Case create and delete ports", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    await expect(source.createDeal(ctx, { title: "우회 생성" })).rejects.toThrow(/canonical 업무 시작/);
    await expect(source.deleteDeal(ctx, current.id)).rejects.toThrow(/deletion is not supported/);
    expect((await source.getDeal(ctx, current.id))?.id).toBe(current.id);
  });

  it("fails closed for ownership PATCH at the Local source boundary", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    const before = { company_id: current.company_id, pipeline_id: current.pipeline_id, assigned_to: current.assigned_to };
    for (const patch of [
      { company_id: crypto.randomUUID() },
      { pipeline_id: crypto.randomUUID() },
      { assigned_to: crypto.randomUUID() },
    ]) {
      await expect(source.updateDeal(ctx, current.id, patch)).rejects.toThrow(/소유권 변경/);
    }
    expect(await source.getDeal(ctx, current.id)).toMatchObject(before);
  });

  it("reassigns only a canonical visible Case to an active same-org member", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    const beforeActivities = db().activities.length;
    await expect(source.reassignDealWithActivity(ctx, current.id, SEED_USER_ADMIN, "ignored"))
      .resolves.toMatchObject({ assigned_to: SEED_USER_ADMIN });
    expect(db().activities).toHaveLength(beforeActivities + 1);

    await expect(source.reassignDealWithActivity(ctx, current.id, crypto.randomUUID(), "ignored"))
      .rejects.toThrow(/active member/);
    expect(current.assigned_to).toBe(SEED_USER_ADMIN);
    expect(db().activities).toHaveLength(beforeActivities + 1);

    db().boardItems.find((item) => item.deal_id === current.id)!.deleted_at = new Date().toISOString();
    await expect(source.reassignDealWithActivity(ctx, current.id, SEED_USER_MEMBER, "ignored"))
      .rejects.toThrow(/case unavailable/);
    expect(current.assigned_to).toBe(SEED_USER_ADMIN);
  });

  it("denies reassignment for assigned-scope callers and legacy cross-org companies", async () => {
    const source = new LocalCrmSource();
    const memberCtx = assignedMember();
    const current = (await source.listDeals(memberCtx))[0];
    addProjection(current.id);
    await expect(source.reassignDealWithActivity(memberCtx, current.id, SEED_USER_ADMIN, "ignored"))
      .resolves.toMatchObject({ assigned_to: SEED_USER_MEMBER });
    const company = db().companies.find((row) => row.id === current.company_id)!;
    company.org_id = crypto.randomUUID();
    await expect(source.reassignDealWithActivity(owner(), current.id, SEED_USER_ADMIN, "ignored"))
      .rejects.toThrow(/case unavailable/);
    expect(current.assigned_to).toBe(SEED_USER_MEMBER);
  });

  it("rejects a stage whose pipeline belongs to another organization", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    const otherOrgPipeline = { id: crypto.randomUUID(), org_id: crypto.randomUUID(), name: "foreign" };
    const foreignStage = { id: crypto.randomUUID(), pipeline_id: otherOrgPipeline.id, name: "foreign", sort_order: 0, kind: "work" as const };
    const local = db();
    local.pipelines.push(otherOrgPipeline);
    local.stages.push(foreignStage);
    await expect(source.moveDeal(ctx, current.id, foreignStage.id, {
      requestId: crypto.randomUUID(), expectedVersion: current.case_version ?? 0,
    })).rejects.toThrow(/stage unavailable/);
    expect((await source.getDeal(ctx, current.id))?.stage_id).toBe(current.stage_id);
  });

  it("requires canonical company and exactly one active projection before stage or Activity mutation", async () => {
    const source = new LocalCrmSource();
    const ctx = owner();
    const current = (await source.listDeals(ctx))[0];
    const target = (await source.listStages(current.pipeline_id!)).find((stage) => stage.id !== current.stage_id)!;
    await expect(source.moveDeal(ctx, current.id, target.id, {
      requestId: crypto.randomUUID(), expectedVersion: current.case_version ?? 0,
    })).rejects.toThrow(/case unavailable/);
    await expect(source.createActivity(ctx, {
      deal_id: current.id, type: "memo", content: "no projection",
    }, crypto.randomUUID())).rejects.toThrow(/case unavailable/);

    addProjection(current.id);
    current.company_id = null;
    await expect(source.createActivity(ctx, {
      deal_id: current.id, type: "memo", content: "no company",
    }, crypto.randomUUID())).rejects.toThrow(/case unavailable/);
    current.company_id = db().companies[0].id;
    addProjection(current.id);
    await expect(source.moveDeal(ctx, current.id, target.id, {
      requestId: crypto.randomUUID(), expectedVersion: current.case_version ?? 0,
    })).rejects.toThrow(/case unavailable/);
  });

  it("rechecks assigned scope before replaying stage or Activity receipts", async () => {
    const source = new LocalCrmSource();
    const ctx = assignedMember();
    const current = (await source.listDeals(ctx))[0];
    addProjection(current.id);
    const target = (await source.listStages(current.pipeline_id!)).find((stage) => stage.id !== current.stage_id)!;
    const moveRequestId = crypto.randomUUID();
    await source.moveDeal(ctx, current.id, target.id, {
      requestId: moveRequestId, expectedVersion: current.case_version ?? 0,
    });
    current.assigned_to = SEED_USER_ADMIN;
    await expect(source.moveDeal(ctx, current.id, target.id, {
      requestId: moveRequestId, expectedVersion: 0,
    })).rejects.toThrow(/case unavailable/);

    current.assigned_to = SEED_USER_MEMBER;
    const activityRequestId = crypto.randomUUID();
    const activity = { deal_id: current.id, type: "memo", content: "scope-bound replay" };
    await source.createActivity(ctx, activity, activityRequestId);
    current.assigned_to = SEED_USER_ADMIN;
    await expect(source.createActivity(ctx, activity, activityRequestId)).rejects.toThrow(/case unavailable/);
  });
});
