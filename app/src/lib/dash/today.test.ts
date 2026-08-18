import { describe, expect, it } from "vitest";
import { parseTodayDashboard } from "./today";

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
  it("reserves the complete five-kind action taxonomy for downstream consumers", () => {
    for (const kind of ["work_due", "follow_up", "assign_owner", "decide", "reconcile_payment"]) {
      const parsed = parseTodayDashboard({ ...valid, tasks: [{ kind, itemId: "i", title: "t", dueOn: "2026-08-17", status: "in_progress", href: "/work?notification=i" }] });
      expect(parsed.tasks[0].kind).toBe(kind);
    }
  });
});
