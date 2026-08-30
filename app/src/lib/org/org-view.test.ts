import { describe, expect, it } from "vitest";
import {
  buildOrgViewModel,
  descendantDepartmentIds,
  isOrgView,
  membersOfDepartment,
  ORG_VIEWS,
  selectOrgViewModel,
  type OrgViewModel,
} from "./org-view";
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

describe("#640 ⑦ 갈래 값은 «서버도» 읽을 수 있어야 한다", () => {
  /*
   * 한 번 여기서 500 을 냈다 — isOrgView 를 "use client" 파일에서 내보내고
   * page.tsx(서버)에서 불렀더니 «Attempted to call isOrgView() from the server» 로
   * 화면이 죽었다. tsc 는 통과했다. 그래서 이 함수는 공용 모듈이 갖는다.
   */
  it("네 갈래를 알아본다", () => {
    expect(ORG_VIEWS).toEqual(["list", "chart", "perm", "rules"]);
    for (const view of ORG_VIEWS) expect(isOrgView(view)).toBe(true);
  });

  it("모르는 값은 거른다 — 주소창에 아무거나 넣어도 화면이 안 깨진다", () => {
    for (const bad of ["", "LIST", "목록", null, undefined, 3, {}]) expect(isOrgView(bad)).toBe(false);
  });
});

describe("#640 ⑥ 판정 → 화면 배선 (#638 이 이름 붙인 무검사 자리)", () => {
  const readyChart = {
    kind: "ready" as const,
    departments: [dept("d1", "본부")],
    members: [chartMember("대표", []), chartMember("사원", ["d1"])],
    unassignedCount: 1,
  };
  const readySummary = {
    kind: "ready",
    owner: summaryRow("대표", "owner"),
    admins: [] as MemberSummaryRow[],
    members: [summaryRow("사원")],
  };

  it("둘 다 읽었으면 표를 그린다", () => {
    const model = selectOrgViewModel({ chart: readyChart, summary: readySummary, exceptions: new Map() });
    expect(model?.members.map((m) => m.userId).sort()).toEqual(["대표", "사원"]);
  });

  it("조직도를 못 읽었으면 null 이다 — 빈 표로 위장하지 않는다", () => {
    expect(selectOrgViewModel({ chart: { kind: "error" }, summary: readySummary, exceptions: new Map() })).toBeNull();
  });

  it.each(["unavailable", "error", "owner_integrity_error"])("멤버십 요약이 %s 면 null 이다", (kind) => {
    expect(selectOrgViewModel({ chart: readyChart, summary: { kind }, exceptions: new Map() })).toBeNull();
  });

  it("보고 예외만 못 읽은 것은 «표를 못 그릴» 이유가 아니다 — 표는 그리고 그 열만 «확인 못 함» 이다", () => {
    const model = selectOrgViewModel({ chart: readyChart, summary: readySummary, exceptions: null });
    expect(model).not.toBeNull();
    expect(model?.reportingKnown).toBe(false);
  });
});

describe("#640 ⑤ 모르는 것을 «버리지» 않고 모른다고 말한다", () => {
  /*
   * 검수(PR #641)가 P1 으로 잡은 자리다.
   * 멤버십 요약의 isRole 은 owner/admin/member 만 통과시킨다 — 054 가 enum 에 넣은
   * team_lead 와 비활성 구성원은 거기서 빠진다. 그런 사람을 표에서 «버리면»
   * 왼쪽 트리와 오른쪽 표의 모집단이 갈려 한 부서가 서로 다른 수로 말해진다.
   */
  const droppedModel = () =>
    buildOrgViewModel({
      chart: {
        kind: "ready",
        departments: [dept("d1", "본부")],
        members: [chartMember("대표", []), chartMember("팀장", ["d1"]), chartMember("사원", ["d1"])],
        unassignedCount: 99, // 일부러 틀린 값 — 이 값을 그대로 쓰면 안 된다
      },
      owner: summaryRow("대표", "owner"),
      admins: [],
      members: [summaryRow("사원")], // 「팀장」이 여기 없다 (isRole 이 team_lead 를 거른 상황)
      exceptions: new Map(),
    });

  it("★ 요약에 없는 사람도 표에 남는다 — 사라지면 트리 수와 표 행수가 갈린다", () => {
    expect(droppedModel().members.map((m) => m.userId).sort()).toEqual(["대표", "사원", "팀장"]);
  });

  it("★ 그 사람의 역할·조회 범위는 null 이다 — 「구성원」으로 추측하지 않는다", () => {
    const 팀장 = droppedModel().members.find((m) => m.userId === "팀장");
    expect(팀장?.role).toBeNull();
    expect(팀장?.scope).toBeNull();
    expect(팀장?.title).toBeNull();
  });

  it("★ 왼쪽 트리의 인원과 오른쪽 표의 행수가 같은 모집단에서 나온다", () => {
    const model = droppedModel();
    const 본부 = model.departments.find((d) => d.id === "d1");
    expect(본부?.reachCount).toBe(membersOfDepartment(model, "d1", true).length);
  });

  it("★ 미배정을 이 화면 공식으로 다시 센다 — 넘겨받은 값을 그대로 쓰지 않는다", () => {
    // chart.unassignedCount 는 99 로 줬다. 실제 부서 없는 사람은 「대표」 하나뿐이다.
    expect(droppedModel().unassignedCount).toBe(1);
  });

  it("역할·호칭·조회 범위를 요약에서 그대로 옮긴다", () => {
    const model = build({
      departments: [dept("d1", "본부")],
      members: [chartMember("대표", []), chartMember("사원", ["d1"])],
      exceptions: new Map(),
    });
    const 대표 = model.members.find((m) => m.userId === "대표");
    expect(대표?.role).toBe("owner");
    expect(대표?.scope).toBe("assigned");
  });

  it("이름 순으로 정렬한다 — 표 순서가 매번 달라지면 못 읽는다", () => {
    const model = build({
      departments: [],
      members: [chartMember("하늘", []), chartMember("가람", []), chartMember("나무", [])],
      exceptions: new Map(),
    });
    expect(model.members.map((m) => m.displayName)).toEqual(["가람", "나무", "하늘"]);
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

/**
 * #644 ③ — 「호칭 미설정」과 「확인 못 함」은 다른 사실이다.
 *
 * 멤버십 요약(member-org-summary.ts)의 isRole 은 owner/admin/member 만 통과시킨다.
 * 054 가 enum 에 넣은 team_lead 와 비활성 구성원은 그 관문에서 빠지는데, 그 사람들의
 * 호칭은 «없는» 게 아니라 «못 읽은» 것이다 — member_account_profiles 에는 값이 있을 수 있다.
 * 같은 행에서 역할·조회 범위는 「확인 못 함」이라 말하면서 호칭만 「미설정」이라 단언하면
 * 그 한 줄이 스스로와 어긋난다.
 */
describe("#644 ③ 호칭을 «못 읽음» 과 «미설정» 으로 나눠 말한다", () => {
  const model = buildOrgViewModel({
    chart: {
      kind: "ready",
      departments: [dept("d1", "영업본부")],
      members: [chartMember("대표", []), chartMember("팀장", ["d1"])],
      unassignedCount: 0,
    },
    owner: summaryRow("대표", "owner"),
    admins: [],
    // ★ 팀장을 요약에 넣지 않는다 — team_lead 가 실제로 그렇게 빠진다.
    members: [],
    exceptions: new Map(),
  });

  it("요약에 없는 사람은 titleKnown 이 false 다 — 호칭이 «없다» 고 단언하지 않는다", () => {
    const lead = model.members.find((row) => row.userId === "팀장");
    expect(lead?.titleKnown).toBe(false);
    // 역할·조회 범위와 «같은 결» 이어야 한다. 하나만 단언하면 그 줄이 어긋난다.
    expect(lead?.role).toBeNull();
    expect(lead?.scope).toBeNull();
  });

  it("요약이 있으면 titleKnown 이 true 다 — 그때의 null 은 진짜 «미설정» 이다", () => {
    const owner = model.members.find((row) => row.userId === "대표");
    expect(owner?.titleKnown).toBe(true);
    expect(owner?.title).toBeNull();
  });
});
