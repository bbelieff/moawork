import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import type { MemberOrgSummary } from "@/lib/auth/member-org-summary";
import type { OrgChart } from "@/lib/org/departments";
import type { SeatDefinition } from "@/lib/org/seat-definitions";
import {
  buildAccountOrgProfile,
  loadAccountOrgProfileWithDependencies,
  type AccountProfileDependencies,
} from "./profile-server";

const ctx = (orgId = "org-a"): Ctx => ({
  user: { id: "user-1", email: "me@example.invalid", name: "테스트 사용자", avatar_url: null, created_at: "2026-01-01" },
  org: { id: orgId, name: orgId === "org-a" ? "첫 회사" : "둘째 회사", plan_tier: "test", created_at: "2026-01-01" },
  role: "member",
  scope: "assigned",
});

const summary = (orgId: string, title: string | null): MemberOrgSummary => ({
  kind: "ready",
  owner: { orgId, userId: `owner-${orgId}`, displayName: `${orgId} 대표`, role: "owner", scope: "all", title: null, teamKey: null, createdAt: "2026-01-01" },
  admins: [],
  members: [{ orgId, userId: "user-1", displayName: "테스트 사용자", role: "member", scope: "assigned", title, teamKey: null, createdAt: "2026-01-02" }],
});

const chart = (departmentId: string, departmentName: string, managerId: string, managerName: string): OrgChart => ({
  kind: "ready",
  departments: [{ id: departmentId, name: departmentName, parentId: null, headUserId: managerId, sortOrder: 0, memberCount: 2 }],
  members: [
    { userId: "user-1", displayName: "테스트 사용자", avatarUrl: null, departmentIds: [departmentId], primaryDepartmentId: departmentId, active: true },
    { userId: managerId, displayName: managerName, avatarUrl: null, departmentIds: [departmentId], primaryDepartmentId: departmentId, active: true },
    { userId: `owner-${departmentId.startsWith("a") ? "org-a" : "org-b"}`, displayName: "대표", avatarUrl: null, departmentIds: [], primaryDepartmentId: null, active: true },
  ],
  unassignedCount: 1,
});

const definition = (departmentId: string, value: string): Map<string, SeatDefinition> => new Map([
  [`${departmentId}:member`, {
    departmentId,
    role: "member",
    summary: value,
    duties: [], escalate: [], handle: [], avoid: [], signals: null, handover: null,
    updatedAt: null, updatedById: null, updatedByName: null,
  }],
]);

describe("account profile read composition", () => {
  it("정본의 호칭·주부서·직무·보고 대상을 ready 상태로 조합한다", () => {
    const model = buildAccountOrgProfile(ctx(), {
      summary: summary("org-a", "고객 담당"),
      chart: chart("a-dept", "고객지원팀", "manager-a", "첫 팀장"),
      exceptions: new Map(),
      definitions: definition("a-dept", "고객 요청을 분류해요."),
    });

    expect(model).toEqual({
      title: { kind: "ready", value: "고객 담당" },
      department: { kind: "ready", value: "고객지원팀" },
      job: { kind: "ready", value: "고객 요청을 분류해요." },
      reportsTo: { kind: "ready", value: "첫 팀장" },
    });
  });

  it("검증된 빈값과 읽기 실패를 구분하고 보고 대상을 추측하지 않는다", () => {
    const empty = buildAccountOrgProfile(ctx(), {
      summary: summary("org-a", null),
      chart: { kind: "ready", departments: [], members: [
        { userId: "user-1", displayName: "테스트 사용자", avatarUrl: null, departmentIds: [], primaryDepartmentId: null, active: true },
        { userId: "owner-org-a", displayName: "대표", avatarUrl: null, departmentIds: [], primaryDepartmentId: null, active: true },
      ], unassignedCount: 2 },
      exceptions: new Map(),
      definitions: new Map(),
    });
    expect(empty.title.kind).toBe("empty");
    expect(empty.department.kind).toBe("empty");
    expect(empty.job.kind).toBe("empty");
    expect(empty.reportsTo).toEqual({ kind: "ready", value: "대표" });

    const failed = buildAccountOrgProfile(ctx(), {
      summary: { kind: "error" }, chart: { kind: "error" }, exceptions: null, definitions: null,
    });
    expect(Object.values(failed).every((state) => state.kind === "error")).toBe(true);
  });

  it("회사 전환마다 현재 org id로 다시 읽어 이전 회사의 값이 남지 않는다", async () => {
    const loadSummary = vi.fn(async (_client: never, current: Ctx) => summary(current.org.id, current.org.id === "org-a" ? "첫 호칭" : "둘째 호칭"));
    const loadChart = vi.fn(async (current: Ctx) => current.org.id === "org-a"
      ? chart("a-dept", "첫 부서", "manager-a", "첫 팀장")
      : chart("b-dept", "둘째 부서", "manager-b", "둘째 팀장"));
    const loadDefinitions = vi.fn(async (current: Ctx) => current.org.id === "org-a"
      ? definition("a-dept", "첫 직무")
      : definition("b-dept", "둘째 직무"));
    const dependencies = {
      getClient: vi.fn(async () => ({})),
      loadSummary,
      loadChart,
      loadExceptions: vi.fn(async () => new Map()),
      loadDefinitions,
    } as unknown as AccountProfileDependencies;

    const first = await loadAccountOrgProfileWithDependencies(ctx("org-a"), dependencies);
    const second = await loadAccountOrgProfileWithDependencies(ctx("org-b"), dependencies);

    expect(first.department).toEqual({ kind: "ready", value: "첫 부서" });
    expect(second.department).toEqual({ kind: "ready", value: "둘째 부서" });
    expect(JSON.stringify(second)).not.toContain("첫 부서");
    expect(loadSummary.mock.calls.map((call) => call[1].org.id)).toEqual(["org-a", "org-b"]);
    expect(loadChart.mock.calls.map((call) => call[0].org.id)).toEqual(["org-a", "org-b"]);
  });

  it("현재 회사와 다른 프로필 행을 현재 사용자의 정보로 소비하지 않는다", () => {
    const foreign = summary("org-b", "다른 회사 호칭");
    const model = buildAccountOrgProfile(ctx("org-a"), {
      summary: foreign,
      chart: chart("a-dept", "첫 부서", "manager-a", "첫 팀장"),
      exceptions: new Map(),
      definitions: definition("a-dept", "첫 직무"),
    });
    expect(model.title.kind).toBe("error");
    expect(JSON.stringify(model)).not.toContain("다른 회사 호칭");
  });
});
