import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx, Deal } from "@/lib/types";
import { CaseTaskMutationError } from "@/lib/repo/supabase/source";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDeal: vi.fn(),
  mutateCaseTask: vi.fn(),
  reassignDeal: vi.fn(),
  listOrgMemberOptions: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({
    getDeal: mocks.getDeal,
    mutateCaseTask: mocks.mutateCaseTask,
    reassignDeal: mocks.reassignDeal,
  }),
}));
vi.mock("@/lib/deal/members", () => ({ listOrgMemberOptions: mocks.listOrgMemberOptions }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  completeTodayTaskAction,
  postponeTodayTaskAction,
  reassignTodayTaskAction,
} from "./actions";

const ctx = {
  org: { id: "org-1" },
  user: { id: "user-1" },
  role: "admin",
  scope: "all",
} as Ctx;

const existingDeal = {
  id: "deal-1",
  org_id: "org-1",
  company_id: null,
  pipeline_id: "pipeline-1",
  stage_id: null,
  assigned_to: "user-1",
  title: "테스트 업무",
  amount: null,
  status_note: null,
  fee_terms: null,
  applied_on: null,
  custom: { preserved: "keep", due_date: "2026-08-11" },
  created_at: "2026-08-11T00:00:00.000Z",
  updated_at: "2026-08-11T00:00:00.000Z",
} satisfies Deal;

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const NEXT_REQUEST_ID = "00000000-0000-4000-8000-000000000002";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

describe("dashboard task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(ctx);
    mocks.getDeal.mockResolvedValue(existingDeal);
    mocks.mutateCaseTask.mockResolvedValue({ activityId: "activity-1", replayed: false });
    mocks.reassignDeal.mockResolvedValue(existingDeal);
    mocks.listOrgMemberOptions.mockResolvedValue([
      { id: "user-1", name: "User 1" },
      { id: "user-2", name: "User 2" },
    ]);
  });

  it("completes through one canonical task mutation with the caller requestId", async () => {
    await completeTodayTaskAction(form({ dealId: "deal-1", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.mutateCaseTask).toHaveBeenCalledWith(ctx, "deal-1", {
      kind: "complete",
      requestId: REQUEST_ID,
    });
    expect(mocks.getDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=completed");
  });

  it("postpones through the same canonical port without a stale custom snapshot", async () => {
    await postponeTodayTaskAction(form({ dealId: "deal-1", dueDate: "2026-08-20", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.mutateCaseTask).toHaveBeenCalledWith(ctx, "deal-1", {
      kind: "postpone",
      dueDate: "2026-08-20",
      requestId: REQUEST_ID,
    });
    expect(mocks.getDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=postponed");
  });

  it("rejects reassignment when the viewer lacks permission", async () => {
    mocks.getSession.mockResolvedValue({ ...ctx, role: "member", scope: "assigned" });
    await reassignTodayTaskAction(form({ dealId: "deal-1", assignee: "user-2", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.reassignDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("returns failed for an authoritative terminal code instead of blessing partial success", async () => {
    mocks.mutateCaseTask.mockRejectedValue(Object.assign(new Error("activity denied"), {
      cause: { code: "42501", message: "activity denied" },
    }));
    await completeTodayTaskAction(form({ dealId: "deal-1", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.mutateCaseTask).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("carries an unknown completion outcome through redirect state with the exact caller intent", async () => {
    mocks.mutateCaseTask.mockRejectedValue(new Error("response lost after commit"));
    await completeTodayTaskAction(form({ dealId: "deal-1", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/dash/tasks?result=retryable_unknown&retryDealId=deal-1&retryKind=complete&retryRequestId=${REQUEST_ID}`,
    );
  });

  it.each(["22023", "40001", "42501"])("rotates after authoritative terminal code %s", async (code) => {
    mocks.mutateCaseTask.mockRejectedValue(Object.assign(new Error("terminal"), {
      cause: { code, message: "terminal" },
    }));
    await completeTodayTaskAction(form({ dealId: "deal-1", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("clears retry parameters for a typed Local receipt mismatch", async () => {
    mocks.mutateCaseTask.mockRejectedValue(
      new CaseTaskMutationError("case task request mismatch", "terminal", "22023"),
    );
    await completeTodayTaskAction(form({
      dealId: "deal-1",
      requestId: REQUEST_ID,
      returnTo: `/dash/tasks?result=retryable_unknown&retryDealId=deal-1&retryKind=complete&retryRequestId=${REQUEST_ID}`,
    }));
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("keeps the postpone request for the same snapshot and rotates it when dueDate changes", async () => {
    const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(NEXT_REQUEST_ID);
    mocks.mutateCaseTask.mockRejectedValue(new Error("malformed committed response"));
    try {
      await postponeTodayTaskAction(form({
        dealId: "deal-1",
        dueDate: "2026-08-20",
        retryDueDate: "2026-08-20",
        requestId: REQUEST_ID,
        returnTo: "/dash/tasks",
      }));
      expect(mocks.mutateCaseTask).toHaveBeenLastCalledWith(ctx, "deal-1", {
        kind: "postpone",
        dueDate: "2026-08-20",
        requestId: REQUEST_ID,
      });
      expect(mocks.redirect).toHaveBeenLastCalledWith(
        `/dash/tasks?result=retryable_unknown&retryDealId=deal-1&retryKind=postpone&retryRequestId=${REQUEST_ID}&retryDueDate=2026-08-20`,
      );

      await postponeTodayTaskAction(form({
        dealId: "deal-1",
        dueDate: "2026-08-21",
        retryDueDate: "2026-08-20",
        requestId: REQUEST_ID,
        returnTo: "/dash/tasks",
      }));
      expect(mocks.mutateCaseTask).toHaveBeenLastCalledWith(ctx, "deal-1", {
        kind: "postpone",
        dueDate: "2026-08-21",
        requestId: NEXT_REQUEST_ID,
      });
      expect(mocks.redirect).toHaveBeenLastCalledWith(
        `/dash/tasks?result=retryable_unknown&retryDealId=deal-1&retryKind=postpone&retryRequestId=${NEXT_REQUEST_ID}&retryDueDate=2026-08-21`,
      );
    } finally {
      uuid.mockRestore();
    }
  });

  it("rejects a missing caller requestId before any task mutation", async () => {
    await completeTodayTaskAction(form({ dealId: "deal-1", returnTo: "/dash/tasks" }));
    expect(mocks.mutateCaseTask).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("reassign uses only the existing atomic reassignment operation", async () => {
    await reassignTodayTaskAction(form({ dealId: "deal-1", assignee: "user-2", requestId: REQUEST_ID, returnTo: "/dash/tasks" }));
    expect(mocks.reassignDeal).toHaveBeenCalledWith(ctx, "deal-1", "user-2", {
      fromName: "User 1",
      toName: "User 2",
    });
    expect(mocks.mutateCaseTask).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=reassigned");
  });
});
