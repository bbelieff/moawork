import type { SupabaseClient } from "@supabase/supabase-js";

export type TodayDashboardStatus = "ready" | "empty" | "partial";
export type TodayDashboardRole = "owner" | "admin" | "member";
export type TodayDashboardScope = "all" | "assigned";
export type TodayDashboardActionKind =
  | "work_due"
  | "follow_up"
  | "assign_owner"
  | "decide"
  | "reconcile_payment";

export interface TodayDashboardTask {
  /** BBE-185 reserves all five daily-action kinds; current canonical task rows are work_due. */
  kind: TodayDashboardActionKind;
  itemId: string;
  title: string;
  dueOn: string;
  status: "not_started" | "in_progress" | "blocked";
  href: string;
}

export interface TodayDashboardNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  isAction: boolean;
  readAt: string | null;
  createdAt: string;
  href: string;
}

export interface TodayDashboardSnapshot {
  version: 1;
  orgId: string;
  viewer: { userId: string; role: TodayDashboardRole; scope: TodayDashboardScope };
  asOf: string;
  timezone: "Asia/Seoul";
  period: { today: string; monthStart: string; monthEndExclusive: string };
  status: TodayDashboardStatus;
  missingSources: ("new-lead" | "contact" | "work")[];
  kpis: {
    todayConsultations: number;
    callbacks: number;
    contractsWaiting: number;
    contractDeposits: number;
    fees: number;
  };
  tasks: TodayDashboardTask[];
  notifications: TodayDashboardNotification[];
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid dashboard response.");
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid dashboard string.");
  return value;
};
const nullableString = (value: unknown): string | null => value === null ? null : string(value);
const number = (value: unknown): number => {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error("Invalid dashboard number.");
  return result;
};
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("Invalid dashboard enum.");
  return value as T;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Invalid dashboard list.");
  return value;
};

export function parseTodayDashboard(value: unknown): TodayDashboardSnapshot {
  const row = object(value); const viewer = object(row.viewer); const period = object(row.period); const kpis = object(row.kpis);
  if (row.version !== 1) throw new Error("Unsupported dashboard version.");
  const tasks = array(row.tasks).map((value): TodayDashboardTask => {
    const task = object(value);
    return { kind: oneOf(task.kind, ["work_due", "follow_up", "assign_owner", "decide", "reconcile_payment"]), itemId: string(task.itemId), title: string(task.title),
      dueOn: string(task.dueOn), status: oneOf(task.status, ["not_started", "in_progress", "blocked"]), href: string(task.href) };
  });
  const notifications = array(row.notifications).map((value): TodayDashboardNotification => {
    const notification = object(value);
    if (typeof notification.isAction !== "boolean") throw new Error("Invalid notification action flag.");
    return { id: string(notification.id), type: string(notification.type), title: string(notification.title),
      body: nullableString(notification.body), targetType: nullableString(notification.targetType), targetId: nullableString(notification.targetId),
      isAction: notification.isAction, readAt: nullableString(notification.readAt), createdAt: string(notification.createdAt), href: string(notification.href) };
  });
  if (tasks.length > 5 || notifications.length > 5) throw new Error("Dashboard row limit exceeded.");
  return {
    version: 1, orgId: string(row.orgId),
    viewer: { userId: string(viewer.userId), role: oneOf(viewer.role, ["owner", "admin", "member"]), scope: oneOf(viewer.scope, ["all", "assigned"]) },
    asOf: string(row.asOf), timezone: oneOf(row.timezone, ["Asia/Seoul"]),
    period: { today: string(period.today), monthStart: string(period.monthStart), monthEndExclusive: string(period.monthEndExclusive) },
    status: oneOf(row.status, ["ready", "empty", "partial"]),
    missingSources: array(row.missingSources).map((source) => oneOf(source, ["new-lead", "contact", "work"])),
    kpis: { todayConsultations: number(kpis.todayConsultations), callbacks: number(kpis.callbacks),
      contractsWaiting: number(kpis.contractsWaiting), contractDeposits: number(kpis.contractDeposits), fees: number(kpis.fees) },
    tasks, notifications,
  };
}

export async function readTodayDashboard(
  client: SupabaseClient,
  orgId: string,
  asOf = new Date(),
): Promise<TodayDashboardSnapshot> {
  const { data, error } = await client.rpc("read_today_dashboard", { p_org_id: orgId, p_as_of: asOf.toISOString() });
  if (error) throw new Error("Today dashboard is unavailable.");
  return parseTodayDashboard(data);
}
