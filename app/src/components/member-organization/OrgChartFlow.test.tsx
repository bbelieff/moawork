import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildOrgViewModel } from "@/lib/org/org-view";
import type { DepartmentMember, DepartmentNode, OrgChart } from "@/lib/org/departments";
import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";
import { OrgChartFlow } from "./OrgChartFlow";

/**
 * #644 ① — 「하위 포함」이 «하위가 있을 때만» 붙는가.
 *
 * 전에는 카드가 서로 «모집단이 다른» 두 수를 나란히 놓았다:
 *   memberCount  loadOrgChart 가 센 것 — 활성만
 *   reachCount   toTree 가 센 것 — 자기 + 하위 전부, 활성 무관
 * 그래서 하위 부서가 하나도 없는 부서에 비활성이 한 명만 있어도
 * 「1명 · 하위 포함 2」라고, 있지도 않은 하위가 있는 것처럼 말했다.
 */

const dept = (id: string, name: string, parentId: string | null = null): DepartmentNode =>
  ({ id, name, parentId, headUserId: null, sortOrder: 0, memberCount: 0 });

const member = (userId: string, departmentIds: string[], active = true): DepartmentMember =>
  ({ userId, displayName: userId, avatarUrl: null, departmentIds, primaryDepartmentId: departmentIds[0] ?? null, active });

const summaryRow = (userId: string, role: MemberSummaryRow["role"] = "member"): MemberSummaryRow =>
  ({ orgId: "org-1", userId, displayName: userId, role, scope: "assigned", title: null, teamKey: null, createdAt: "2026-01-01T00:00:00Z" });

function render(chart: Extract<OrgChart, { kind: "ready" }>) {
  const model = buildOrgViewModel({
    chart,
    owner: summaryRow("대표", "owner"),
    admins: [],
    members: chart.members.filter((row) => row.userId !== "대표").map((row) => summaryRow(row.userId)),
    exceptions: new Map(),
  });
  return renderToStaticMarkup(<OrgChartFlow model={model} />);
}

describe("#644 ① 조직도 카드가 없는 하위를 있는 것처럼 말하지 않는다", () => {
  it("하위 부서가 0개면 비활성이 섞여 있어도 「하위 포함」을 붙이지 않는다", () => {
    const html = render({
      kind: "ready",
      // ★ loadOrgChart 가 실제로 주는 모양 — memberCount 는 «활성만» 센 1 이다.
      departments: [{ ...dept("d1", "총무팀"), memberCount: 1 }],
      members: [member("사원B", ["d1"]), member("사원C", ["d1"], false)],
      unassignedCount: 0,
    });
    // 카드가 이름표로 두 사람을 그리므로 수도 2 여야 한다 — 보여 주는 것과 말하는 것이 같아야 한다.
    expect(html).toContain("2명");
    expect(html).not.toContain("하위 포함");
  });

  it("하위 부서가 있고 아래에 사람이 더 있으면 그때는 「하위 포함」을 붙인다", () => {
    const html = render({
      kind: "ready",
      departments: [dept("d1", "영업본부"), dept("d2", "영업1팀", "d1")],
      members: [member("본부장", ["d1"]), member("팀장", ["d2"])],
      unassignedCount: 0,
    });
    expect(html).toContain("하위 포함 2");
  });
});
