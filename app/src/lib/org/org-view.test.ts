import { describe, expect, it } from "vitest";
import { buildOrgViewModel, descendantDepartmentIds, membersOfDepartment, type OrgViewModel } from "./org-view";
import type { DepartmentMember, DepartmentNode } from "./departments";
import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";

/**
 * #640 — 「목록」 갈래가 그리는 표의 재료를 잰다.
 *
 * 여기서 노리는 것은 오늘(2026-08-30) 이 저장소가 반복해서 밟은 함정이다:
 *   ① «못 읽음» 을 «0건» 으로 뭉개기 — null 과 빈 Map 을 같은 값으로 만들면
 *      화면이 틀린 보고선을 «확인된 사실» 로 단언한다 (#638)
 *   ② 겸직 — 한 사람이 두 부서에 있을 때 양쪽에서 다 보여야 한다
 *   ③ 순환 — parent 가 서로를 가리켜도 화면이 멈추면 안 된다
 */

const dept = (id: string, name: string, parentId: string | null = null, headUserId: string | null = null): DepartmentNode =>
  ({ id, name, parentId, headUserId, sortOrder: 0, memberCount: 0 });

const chartMember = (userId: string, departmentIds: string[], active = true): DepartmentMember =>
  ({ userId, displayName: userId, avatarUrl: null, departmentIds, primaryDepartmentId: departmentIds[0] ?? null, active });

const summaryRow = (userId: string, role: MemberSummaryRow["role"] = "member"): MemberSummaryRow =>
  ({ orgId: "org-1", userId, displayName: userId, role, scope: "assigned", title: null, teamKey: null, createdAt: "2026-01-01T00:00:00Z" });

function build(input: {
  departments: DepartmentNode[];
  members: DepartmentMember[];
  exceptions: ReadonlyMap<string, string | null> | null;
  unassignedCount?: number;
}): OrgViewModel {
  const owner = summaryRow("대표", "owner");
  return buildOrgViewModel({
    chart: { kind: "ready", departments: input.departments, members: input.members, unassignedCount: input.unassignedCount ?? 0 },
    owner,
    admins: [],
    members: input.members.filter((m) => m.userId !== "대표").map((m) => summaryRow(m.userId)),
    exceptions: input.exceptions,
  });
}

describe("#640 ① 보고 예외를 «못 읽음» 과 «0건» 으로 나눠 말한다", () => {
  const base = {
    departments: [dept("d1", "영업본부", null, "팀장")],
    members: [chartMember("대표", []), chartMember("팀장", ["d1"]), chartMember("사원", ["d1"])],
  };

  it("예외를 읽었고 0건이면 reportingKnown 이 true 다", () => {
    expect(build({ ...base, exceptions: new Map() }).reportingKnown).toBe(true);
  });

  it("★ 예외를 못 읽었으면 reportingKnown 이 false 다 — 0건과 같은 값이 아니다", () => {
    expect(build({ ...base, exceptions: null }).reportingKnown).toBe(false);
  });

  it("예외 지정이 부서 계통을 이긴다", () => {
    const withException = build({ ...base, exceptions: new Map([["사원", "대표"]]) });
    const 사원 = withException.members.find((m) => m.userId === "사원");
    expect(사원?.reportsToUserId).toBe("대표");

    // 같은 데이터인데 예외만 없으면 부서 책임자에게 간다 — 예외가 실제로 «작동» 했음을 잰다
    const without = build({ ...base, exceptions: new Map() });
    expect(without.members.find((m) => m.userId === "사원")?.reportsToUserId).toBe("팀장");
  });
});

describe("#640 ② 보고 대상 — reporting.ts 의 첫 화면 소비자", () => {
  it("부서 책임자는 자기 자신이 아니라 «상위» 로 보고한다", () => {
    const model = build({
      departments: [dept("d1", "본부", null, "본부장"), dept("d2", "팀", "d1", "팀장")],
      members: [chartMember("대표", []), chartMember("본부장", ["d1"]), chartMember("팀장", ["d2"])],
      exceptions: new Map(),
    });
    const 팀장 = model.members.find((m) => m.userId === "팀장");
    expect(팀장?.reportsToUserId).toBe("본부장");
    expect(팀장?.isHeadOfPrimary).toBe(true);
  });

  it("어느 부서에도 없으면 대표에게 보고한다", () => {
    const model = build({
      departments: [dept("d1", "본부")],
      members: [chartMember("대표", []), chartMember("미배정", [])],
      exceptions: new Map(),
    });
    expect(model.members.find((m) => m.userId === "미배정")?.reportsToUserId).toBe("대표");
  });

  it("대표 자신은 보고 대상이 없다 — 최상위다", () => {
    const model = build({ departments: [], members: [chartMember("대표", [])], exceptions: new Map() });
    expect(model.members.find((m) => m.userId === "대표")?.reportsToUserId).toBeNull();
  });

  it("보고 대상의 «이름» 까지 붙여 준다 — 화면이 id 를 그리지 않게", () => {
    const model = build({
      departments: [dept("d1", "본부", null, "본부장")],
      members: [chartMember("대표", []), chartMember("본부장", ["d1"]), chartMember("사원", ["d1"])],
      exceptions: new Map(),
    });
    expect(model.members.find((m) => m.userId === "사원")?.reportsToName).toBe("본부장");
  });
});

describe("#640 ③ 부서를 고르면 그 부서 사람이 나온다", () => {
  const model = build({
    departments: [dept("d1", "본부"), dept("d2", "팀", "d1"), dept("d3", "파트", "d2")],
    members: [
      chartMember("대표", []),
      chartMember("본부사람", ["d1"]),
      chartMember("팀사람", ["d2"]),
      chartMember("파트사람", ["d3"]),
    ],
    exceptions: new Map(),
    unassignedCount: 1,
  });

  it("하위 부서 포함을 끄면 그 부서에 «직접» 배정된 사람만 나온다", () => {
    expect(membersOfDepartment(model, "d1", false).map((m) => m.userId)).toEqual(["본부사람"]);
  });

  it("하위 부서 포함을 켜면 손자 부서까지 딸려 온다", () => {
    expect(membersOfDepartment(model, "d1", true).map((m) => m.userId).sort()).toEqual(
      ["본부사람", "팀사람", "파트사람"].sort(),
    );
  });

  it("전체(null)를 고르면 미배정까지 전부 나온다", () => {
    expect(membersOfDepartment(model, null, false)).toHaveLength(4);
  });

  it("겸직인 사람은 두 부서 양쪽에서 다 보인다", () => {
    const both = build({
      departments: [dept("d1", "가"), dept("d2", "나")],
      members: [chartMember("대표", []), chartMember("겸직", ["d1", "d2"])],
      exceptions: new Map(),
    });
    expect(membersOfDepartment(both, "d1", false).map((m) => m.userId)).toEqual(["겸직"]);
    expect(membersOfDepartment(both, "d2", false).map((m) => m.userId)).toEqual(["겸직"]);
  });

  it("주부서 이름을 붙여 준다 — 표의 «부서» 열이 이 값을 쓴다", () => {
    expect(model.members.find((m) => m.userId === "팀사람")?.primaryDepartmentName).toBe("팀");
    expect(model.members.find((m) => m.userId === "대표")?.primaryDepartmentName).toBeNull();
  });
});

describe("#640 ④ 순환이 있어도 화면이 멈추지 않는다", () => {
  it("부모가 서로를 가리켜도 끝난다", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(descendantDepartmentIds("a", cyclic)).toEqual(new Set(["b", "a"]));
  });

  it("하위가 없으면 빈 집합이다", () => {
    expect(descendantDepartmentIds("a", [{ id: "a", parentId: null }])).toEqual(new Set());
  });
});

describe("#640 ⑤ 모르는 것을 그리지 않는다", () => {
  it("멤버십 요약에 없는 사람은 표에서 뺀다 — 역할을 추측하지 않는다", () => {
    const model = buildOrgViewModel({
      chart: {
        kind: "ready",
        departments: [dept("d1", "본부")],
        members: [chartMember("대표", []), chartMember("유령", ["d1"])],
        unassignedCount: 0,
      },
      owner: summaryRow("대표", "owner"),
      admins: [],
      members: [], // 「유령」이 여기 없다
      exceptions: new Map(),
    });
    expect(model.members.map((m) => m.userId)).toEqual(["대표"]);
  });

  it("비활성 구성원도 재료에는 남는다 — 표가 «상태» 열로 말한다", () => {
    const model = build({
      departments: [dept("d1", "본부")],
      members: [chartMember("대표", []), chartMember("퇴사자", ["d1"], false)],
      exceptions: new Map(),
    });
    expect(model.members.find((m) => m.userId === "퇴사자")?.active).toBe(false);
  });
});
