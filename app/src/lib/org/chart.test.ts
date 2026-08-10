import { describe, expect, it } from "vitest";
import { buildOrgChart } from "./chart";
import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";

function member(overrides: Partial<MemberSummaryRow> & { userId: string }): MemberSummaryRow {
  return {
    orgId: "org-1",
    displayName: overrides.userId,
    role: "member",
    scope: "assigned",
    title: null,
    teamKey: null,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

const OWNER = member({ userId: "owner-1", role: "owner", scope: "all", displayName: "카뮈" });
const HEAD = member({ userId: "head-1", role: "admin", displayName: "박정화" });
const LEAF = member({ userId: "leaf-1", role: "member", displayName: "김수현" });
const VACANT_LEAF = member({ userId: "leaf-2", role: "member", displayName: "최민아" });
const UNASSIGNED = member({ userId: "loose-1", role: "member", displayName: "신규 담당자" });

const DEPARTMENTS = [
  { id: "root", parent_id: null, name: "서울경영지원센터", key: "root", head_user_id: "owner-1", archived_at: null },
  { id: "sales", parent_id: "root", name: "영업본부", key: "sales", head_user_id: "owner-1", archived_at: null },
  { id: "s1", parent_id: "sales", name: "영업1팀", key: "sales.t1", head_user_id: "head-1", archived_at: null },
  { id: "s2", parent_id: "sales", name: "영업2팀", key: "sales.t2", head_user_id: null, archived_at: null },
  { id: "archived", parent_id: "root", name: "폐지팀", key: "archived", head_user_id: null, archived_at: "2026-01-01T00:00:00Z" },
];

const MEMBERSHIPS = [
  { dept_id: "root", user_id: "owner-1", is_primary: true },
  { dept_id: "s1", user_id: "head-1", is_primary: true },
  { dept_id: "s1", user_id: "leaf-1", is_primary: true },
  { dept_id: "s2", user_id: "leaf-2", is_primary: true },
];

const ALL_MEMBERS = [OWNER, HEAD, LEAF, VACANT_LEAF, UNASSIGNED];

function chart(exceptions: unknown[] = []) {
  const state = buildOrgChart("owner-1", ALL_MEMBERS, DEPARTMENTS, MEMBERSHIPS, exceptions, true);
  if (state.kind !== "ready") throw new Error("ready expected");
  return state;
}

describe("buildOrgChart", () => {
  it("보관된(archived) 부서는 트리에서 빠진다", () => {
    const state = chart();
    expect(state.departments.map((d) => d.id)).not.toContain("archived");
  });

  it("부서장 이름을 사람 목록에서 채운다", () => {
    const state = chart();
    expect(state.departments.find((d) => d.id === "s1")?.headName).toBe("박정화");
  });

  it("공석 부서는 headName 이 null", () => {
    const state = chart();
    expect(state.departments.find((d) => d.id === "s2")?.headName).toBeNull();
  });

  it("직속 인원 수는 주부서(is_primary) 기준으로만 센다", () => {
    const state = chart();
    expect(state.departments.find((d) => d.id === "s1")?.memberCount).toBe(2); // head-1 + leaf-1
    expect(state.departments.find((d) => d.id === "root")?.memberCount).toBe(1); // owner-1 만
  });

  it("사람마다 계산된 보고 대상과 이름을 함께 담는다", () => {
    const state = chart();
    const leaf = state.people.find((p) => p.userId === "leaf-1")!;
    expect(leaf.reportsToUserId).toBe("head-1");
    expect(leaf.reportsToName).toBe("박정화");
    expect(leaf.exceptionTargetUserId).toBeNull();
  });

  it("공석 부서 소속자는 건너뛰어 상위 부서장에게 계산된다", () => {
    const state = chart();
    const vacant = state.people.find((p) => p.userId === "leaf-2")!;
    expect(vacant.reportsToUserId).toBe("owner-1"); // s2 공석 → sales(head=owner-1)
  });

  it("미배정자는 people 과 unassigned 양쪽에 남는다(사라지지 않는다)", () => {
    const state = chart();
    expect(state.unassigned.map((p) => p.userId)).toContain("loose-1");
    expect(state.people.map((p) => p.userId)).toContain("loose-1");
    expect(state.unassigned.find((p) => p.userId === "loose-1")?.reportsToUserId).toBe("owner-1");
  });

  it("부서장 여부(isDeptHead)를 정확히 표시한다", () => {
    const state = chart();
    expect(state.people.find((p) => p.userId === "head-1")?.isDeptHead).toBe(true);
    expect(state.people.find((p) => p.userId === "leaf-1")?.isDeptHead).toBe(false);
  });

  it("예외 지정이 있으면 트리 계산 대신 예외 대상을 반영한다", () => {
    const state = chart([{ member_user_id: "leaf-1", reports_to_user_id: "owner-1" }]);
    const leaf = state.people.find((p) => p.userId === "leaf-1")!;
    expect(leaf.reportsToUserId).toBe("owner-1");
    expect(leaf.exceptionTargetUserId).toBe("owner-1");
  });

  it("형식이 깨진 로우는 조용히 건너뛴다(전체 실패로 번지지 않는다)", () => {
    const state = buildOrgChart(
      "owner-1",
      ALL_MEMBERS,
      [...DEPARTMENTS, { id: null, parent_id: "root", name: "", key: "", head_user_id: null, archived_at: null }],
      MEMBERSHIPS,
      [],
      true,
    );
    if (state.kind !== "ready") throw new Error("ready expected");
    expect(state.departments).toHaveLength(4); // archived 1건 제외 + 깨진 1건 제외
  });
});
