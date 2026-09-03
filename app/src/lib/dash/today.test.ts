import { describe, expect, it } from "vitest";
import { parseTodayDashboard } from "./today";
import { MEMBER_ROLES, MEMBER_SCOPES } from "@/lib/auth/roles";

const valid = { version: 2, orgId: "org", viewer: { userId: "user", role: "member", scope: "assigned" },
  asOf: "2026-08-17T00:00:00Z", timezone: "Asia/Seoul", period: { today: "2026-08-17", monthStart: "2026-08-01", monthEndExclusive: "2026-09-01" },
  status: "empty", missingSources: [], unfilledColumns: [],
  kpis: { calls: 0, callbacks: 0, meetings: 0, contractsWaiting: 0, contractDeposits: 0, fees: 0 },
  onboarding: null, tasks: [], notifications: [] };

describe("today dashboard parser", () => {
  it("accepts the versioned empty contract without turning unavailable into zero", () => expect(parseTodayDashboard(valid)).toEqual(valid));
  it("fails closed for unknown status and oversized action lists", () => {
    expect(() => parseTodayDashboard({ ...valid, status: "unavailable" })).toThrow();
    expect(() => parseTodayDashboard({ ...valid, tasks: Array(6).fill({ kind: "work_due", itemId: "i", title: "t", dueOn: "2026-08-17", status: "in_progress", href: "/work" }) })).toThrow(/limit/u);
  });
  /*
   * ★ 이 시험이 «없어서» 팀장과 「부서 이하」인 사람의 오늘 대시보드가 터졌다 (#676).
   *
   *   파서가 역할·범위를 손으로 적은 목록으로 `oneOf` 검사했고, `oneOf` 는 throw 한다.
   *   조직관리에서 「팀장」과 「내 부서 이하」를 고를 수 있고 그 값이 org_members 에
   *   그대로 들어가므로, 그 사람은 대시보드를 열 때마다 «Invalid dashboard enum» 을 만났다.
   *   범위 쪽은 **역할과 무관하게** 누구나 걸렸다.
   *
   * ★★ 그래서 목록을 손으로 적지 않고 MEMBER_ROLES · MEMBER_SCOPES 를 돈다 —
   *    역할이나 범위가 늘면 이 시험도 자동으로 같이 늘어난다.
   */
  it.each(MEMBER_ROLES.map((role) => [role]))("★ 역할이 %s 여도 대시보드가 열린다", (role) => {
    const parsed = parseTodayDashboard({ ...valid, viewer: { ...valid.viewer, role } });
    expect(parsed.viewer.role).toBe(role);
  });

  it.each(MEMBER_SCOPES.map((scope) => [scope]))("★ 범위가 %s 여도 대시보드가 열린다", (scope) => {
    const parsed = parseTodayDashboard({ ...valid, viewer: { ...valid.viewer, scope } });
    expect(parsed.viewer.scope).toBe(scope);
  });

  it("모르는 역할·범위는 여전히 막는다 — 넓힌 것이지 연 것이 아니다", () => {
    expect(() => parseTodayDashboard({ ...valid, viewer: { ...valid.viewer, role: "사장님" } })).toThrow();
    expect(() => parseTodayDashboard({ ...valid, viewer: { ...valid.viewer, scope: "전부다" } })).toThrow();
  });

  it("reserves the complete five-kind action taxonomy for downstream consumers", () => {
    for (const kind of ["work_due", "follow_up", "assign_owner", "decide", "reconcile_payment"]) {
      const parsed = parseTodayDashboard({ ...valid, tasks: [{ kind, itemId: "i", title: "t", dueOn: "2026-08-17", status: "in_progress", href: "/work?notification=i" }] });
      expect(parsed.tasks[0].kind).toBe(kind);
    }
  });
});
