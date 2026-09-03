import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMBER_ROLES, MEMBER_SCOPES, type MemberRole, type MemberScope } from "@/lib/auth/roles";

export type TodayDashboardStatus = "ready" | "empty" | "partial" | "unfilled";

/**
 * ★ BBE-215 — 읽기 모델 «버전» 이 앱보다 낮을 때 쓰는 오류.
 *
 *   배포 순서가 어긋날 수 있다: 앱은 머지되면 Vercel 이 «자동으로» 올리는데,
 *   마이그레이션은 총괄이 SQL 편집기에서 «손으로» 적용한다(운영 직접 적용 금지 규약).
 *   그 사이에는 v1 payload 가 v2 파서에 들어온다.
 *
 *   그때 「Invalid dashboard list」 같은 파싱 오류로 죽으면 원인을 아무도 모른다.
 *   그리고 «옛 숫자를 새 이름 아래 그리는 것» 은 더 나쁘다 — 「오늘 상담할 곳」(미팅 오늘)을
 *   「전화예정」(상담 전)이라고 부르게 되고, 그건 이 카드가 고치려던 바로 그 거짓이다.
 *   그래서 조용히 넘기지도, 잘못 보여주지도 않고 «무엇이 안 됐는지» 를 말한다.
 */
export class TodayDashboardVersionError extends Error {
  constructor() {
    super("오늘 지표 정의가 아직 적용되지 않았습니다. 관리자에게 098 마이그레이션 적용을 요청해 주세요.");
    this.name = "TodayDashboardVersionError";
  }
}
/*
 * ★ 역할·범위의 정본은 `lib/auth/roles.ts` 하나다. 여기서 손으로 다시 적지 않는다.
 *
 *   전에는 `"owner" | "admin" | "member"` 와 `"all" | "assigned"` 를 적어 뒀고,
 *   아래 파서가 그 목록으로 `oneOf` 검사를 했다. `oneOf` 는 **throw** 한다 —
 *   즉 목록에 없는 값이 오면 오늘 대시보드가 통째로 터진다.
 *
 *   그런데 조직관리 화면에서 「팀장」과 「내 부서 이하」를 «고를 수 있고»,
 *   RPC 가 그 값을 `org_members` 에 그대로 쓴다(013:146). 그 사람의 대시보드는
 *   `Invalid dashboard enum` 으로 죽는다. 범위 쪽은 «역할과 무관하게» 누구나 걸린다.
 */
export type TodayDashboardRole = MemberRole;
export type TodayDashboardScope = MemberScope;
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
  version: 2;
  orgId: string;
  viewer: { userId: string; role: TodayDashboardRole; scope: TodayDashboardScope };
  asOf: string;
  timezone: "Asia/Seoul";
  period: { today: string; monthStart: string; monthEndExclusive: string };
  status: TodayDashboardStatus;
  missingSources: ("new-lead" | "contact" | "work")[];
  /**
   * ★ BBE-215 — 총괄 확정 정의(098). 앞의 셋은 상담 상황의 «서로 다른 값» 하나씩이라
   *   같은 건이 두 칸에서 세어질 수 없다(겹침이 구조적으로 불가능).
   */
  kpis: {
    /** 전화예정 — 상담 상황 「상담 전」 */
    calls: number;
    /** 재통화 대기 — 상담 상황 「1차 부재」 */
    callbacks: number;
    /** 미팅예정 — 상담 상황 「2차 상담예약」 */
    meetings: number;
    /** 계약 대기 — 계약상황 「계약서 요청」·「계약서 작성완료」 만 */
    contractsWaiting: number;
    contractDeposits: number;
    fees: number;
  };
  /**
   * ★ 「0」이 «없음» 인지 «아직 안 채움» 인지 가르는 신호(098).
   *   비어 있지 않으면 그 컬럼을 아무도 안 채운 것이다 — 0 을 「없음」으로 그리면 거짓이 된다.
   */
  unfilledColumns: string[];
  /** 온보딩 진행률. 정의가 하나도 없으면 null — 「(0/0)」을 지어내지 않는다. */
  onboarding: { completed: number; total: number } | null;
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
  const row = object(value);
  // ★ 다른 필드를 읽기 «전» 에 버전부터 본다. 뒤에 두면 없는 필드에서 먼저 죽어
  //   원인이 「형식 오류」로 뭉개지고, 정작 「마이그레이션이 아직」이라는 사실이 안 보인다.
  //   ※ 이 줄이 viewer·period·kpis 를 «읽기 전» 이어야 주석과 코드가 같다(DC-18 검수).
  //     v1 도 그 셋은 갖고 있어 순서를 바꿔도 지금 동작은 같지만, 「전에 본다」고 적어 놓고
  //     뒤에서 읽으면 다음 사람이 그 문장을 믿고 필드를 더 얹는다.
  if (number(row.version) < 2) throw new TodayDashboardVersionError();
  const viewer = object(row.viewer); const period = object(row.period); const kpis = object(row.kpis);
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
    version: 2, orgId: string(row.orgId),
    // ★ 목록을 손으로 적지 않는다 — 정본을 그대로 쓴다. 역할·범위가 늘면 여기는 안 고쳐도 따라온다.
    viewer: { userId: string(viewer.userId), role: oneOf(viewer.role, MEMBER_ROLES), scope: oneOf(viewer.scope, MEMBER_SCOPES) },
    asOf: string(row.asOf), timezone: oneOf(row.timezone, ["Asia/Seoul"]),
    period: { today: string(period.today), monthStart: string(period.monthStart), monthEndExclusive: string(period.monthEndExclusive) },
    status: oneOf(row.status, ["ready", "empty", "partial", "unfilled"]),
    missingSources: array(row.missingSources).map((source) => oneOf(source, ["new-lead", "contact", "work"])),
    unfilledColumns: array(row.unfilledColumns).map((column) => string(column)),
    kpis: { calls: number(kpis.calls), callbacks: number(kpis.callbacks), meetings: number(kpis.meetings),
      contractsWaiting: number(kpis.contractsWaiting), contractDeposits: number(kpis.contractDeposits), fees: number(kpis.fees) },
    onboarding: row.onboarding == null
      ? null
      : { completed: number(object(row.onboarding).completed), total: number(object(row.onboarding).total) },
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
