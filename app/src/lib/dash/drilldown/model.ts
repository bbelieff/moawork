import type { Ctx, Deal, Pipeline } from "@/lib/types";

export const DASH_TASK_KEYS = {
  dueDate: "due_date",
  status: "task_status",
  completedAt: "task_completed_at",
} as const;

export type DashboardMetric = "all" | "new" | "overdue" | "today";

export interface DashboardFilters {
  from: string | null;
  to: string | null;
  assignee: string | null;
  pipeline: string | null;
  metric: DashboardMetric;
}

export interface DashboardQueryInput {
  from?: string | string[];
  to?: string | string[];
  assignee?: string | string[];
  pipeline?: string | string[];
  metric?: string | string[];
}

export interface DashboardEvidence {
  deals: Deal[];
  totalVisible: number;
  delayed: boolean;
  partialFailure: boolean;
  unavailable: boolean;
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseDashboardFilters(input: DashboardQueryInput): DashboardFilters {
  const rawMetric = one(input.metric);
  const metric: DashboardMetric =
    rawMetric === "new" || rawMetric === "overdue" || rawMetric === "today"
      ? rawMetric
      : "all";
  const from = one(input.from);
  const to = one(input.to);
  return {
    from: validDate(from) ? from : null,
    to: validDate(to) ? to : null,
    assignee: one(input.assignee),
    pipeline: one(input.pipeline),
    metric,
  };
}

export function dueDateOf(deal: Deal): string | null {
  const value = deal.custom?.[DASH_TASK_KEYS.dueDate];
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

export function isTaskDone(deal: Deal): boolean {
  return deal.custom?.[DASH_TASK_KEYS.status] === "done";
}

function dateOf(deal: Deal): string {
  return dueDateOf(deal) ?? deal.created_at.slice(0, 10);
}

export function filterDashboardDeals(
  visibleDeals: readonly Deal[],
  filters: DashboardFilters,
  today: string,
): Deal[] {
  return visibleDeals.filter((deal) => {
    const date = dateOf(deal);
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    if (filters.assignee && deal.assigned_to !== filters.assignee) return false;
    if (filters.pipeline && deal.pipeline_id !== filters.pipeline) return false;
    if (filters.metric === "new" && deal.created_at.slice(0, 10) !== today) return false;
    if (filters.metric === "today" && (dueDateOf(deal) !== today || isTaskDone(deal))) return false;
    if (filters.metric === "overdue") {
      const due = dueDateOf(deal);
      if (!due || due >= today || isTaskDone(deal)) return false;
    }
    return true;
  });
}

export function dashboardHref(
  filters: DashboardFilters,
  patch: Partial<DashboardFilters>,
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.assignee) params.set("assignee", next.assignee);
  if (next.pipeline) params.set("pipeline", next.pipeline);
  if (next.metric !== "all") params.set("metric", next.metric);
  const query = params.toString();
  return query ? `/dash/tasks?${query}` : "/dash/tasks";
}

export function canReassign(ctx: Ctx): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}

export function pipelineName(pipelines: readonly Pipeline[], id: string | null): string {
  return pipelines.find((pipeline) => pipeline.id === id)?.name ?? "파이프라인 미지정";
}
