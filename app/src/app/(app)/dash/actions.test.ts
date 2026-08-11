import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx, Deal } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDeal: vi.fn(),
  updateDeal: vi.fn(),
  createActivity: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({
    getDeal: mocks.getDeal,
    updateDeal: mocks.updateDeal,
    createActivity: mocks.createActivity,
  }),
}));
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
  applied_on: null,
  custom: { preserved: "keep", due_date: "2026-08-11" },
  created_at: "2026-08-11T00:00:00.000Z",
  updated_at: "2026-08-11T00:00:00.000Z",
} satisfies Deal;

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
    mocks.updateDeal.mockResolvedValue(existingDeal);
    mocks.createActivity.mockResolvedValue({ id: "activity-1" });
  });

  it("sends only task keys so concurrent unrelated custom changes stay untouched", async () => {
    await completeTodayTaskAction(form({ dealId: "deal-1", returnTo: "/dash/tasks" }));
    expect(mocks.updateDeal).toHaveBeenCalledWith(ctx, "deal-1", {
      custom: {
        task_status: "done",
        task_completed_at: expect.any(String),
      },
    });
    expect(mocks.getDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=completed");
  });

  it("postpones with a key-only patch instead of a stale custom snapshot", async () => {
    await postponeTodayTaskAction(form({ dealId: "deal-1", dueDate: "2026-08-20", returnTo: "/dash/tasks" }));
    expect(mocks.updateDeal).toHaveBeenCalledWith(ctx, "deal-1", {
      custom: {
        due_date: "2026-08-20",
        task_status: null,
        task_completed_at: null,
      },
    });
    expect(mocks.getDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=postponed");
  });

  it("rejects reassignment when the viewer lacks permission", async () => {
    mocks.getSession.mockResolvedValue({ ...ctx, role: "member", scope: "assigned" });
    await reassignTodayTaskAction(form({ dealId: "deal-1", assignee: "user-2", returnTo: "/dash/tasks" }));
    expect(mocks.updateDeal).not.toHaveBeenCalled();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=failed");
  });

  it("reports partial success when activity history fails after persistence", async () => {
    mocks.createActivity.mockRejectedValue(new Error("history unavailable"));
    await completeTodayTaskAction(form({ dealId: "deal-1", returnTo: "/dash/tasks" }));
    expect(mocks.updateDeal).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/dash/tasks?result=partial");
  });
});
