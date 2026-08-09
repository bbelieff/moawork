import { describe, expect, it } from "vitest";
import type { Ctx, Deal } from "@/lib/types";
import {
  canReassign,
  dashboardHref,
  filterDashboardDeals,
  parseDashboardFilters,
} from "./model";

function deal(id: string, patch: Partial<Deal> = {}): Deal {
  return {
    id,
    org_id: "o1",
    company_id: null,
    pipeline_id: "p1",
    stage_id: null,
    assigned_to: "u1",
    title: id,
    amount: null,
    status_note: null,
    applied_on: null,
    custom: {},
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...patch,
  };
}

describe("dashboard drilldown filters", () => {
  it("restores only valid URL values and preserves them in links", () => {
    const filters = parseDashboardFilters({
      from: "2026-08-01",
      to: "bad",
      assignee: "u1",
      pipeline: "p1",
      metric: "overdue",
    });
    expect(filters).toEqual({
      from: "2026-08-01",
      to: null,
      assignee: "u1",
      pipeline: "p1",
      metric: "overdue",
    });
    expect(dashboardHref(filters, { metric: "today" })).toBe(
      "/dash/tasks?from=2026-08-01&assignee=u1&pipeline=p1&metric=today",
    );
  });

  it("filters only the already-visible evidence list", () => {
    const visible = [
      deal("today", { custom: { due_date: "2026-08-10" } }),
      deal("late", { custom: { due_date: "2026-08-09" } }),
      deal("done", { custom: { due_date: "2026-08-10", task_status: "done" } }),
      deal("other", { assigned_to: "u2", custom: { due_date: "2026-08-10" } }),
    ];
    const today = filterDashboardDeals(
      visible,
      parseDashboardFilters({ metric: "today", assignee: "u1" }),
      "2026-08-10",
    );
    expect(today.map((item) => item.id)).toEqual(["today"]);
    const overdue = filterDashboardDeals(
      visible,
      parseDashboardFilters({ metric: "overdue" }),
      "2026-08-10",
    );
    expect(overdue.map((item) => item.id)).toEqual(["late"]);
  });

  it("allows assignee changes only for managers or all-scope members", () => {
    const base = { role: "member", scope: "assigned" } as Ctx;
    expect(canReassign(base)).toBe(false);
    expect(canReassign({ ...base, role: "admin" })).toBe(true);
    expect(canReassign({ ...base, scope: "all" })).toBe(true);
  });
});
