import type { MemberSummaryRow } from "@/lib/auth/member-org-summary";
import { buildOrgViewModel, type OrgViewModel } from "@/lib/org/org-view";

/**
 * #640 — 「보는 방식 네 갈래」를 실제 뷰포트에서 눈으로 확인하기 위한 픽스처.
 *
 * ★ 손으로 만든 모델을 넘기지 않는다.
 *   진짜 buildOrgViewModel() 을 통과시킨다 — 그래야 화면과 «계산» 이 같이 검증된다.
 *   모델을 손으로 지어 넘기면 화면만 예뻐지고 계산은 아무것도 증명되지 않는다(#638).
 *
 * ★ 이름은 전부 «가상» 이다. 고객 고유값을 넣지 않는다(CLAUDE.md 절대 금지 2가지).
 */

const OWNER = "70000000-0000-4000-8000-0000000000a0";
const HEAD = "70000000-0000-4000-8000-0000000000a1";
const STAFF = "70000000-0000-4000-8000-0000000000a2";
const SUB = "70000000-0000-4000-8000-0000000000a3";
const IDLE = "70000000-0000-4000-8000-0000000000a4";

const D_HQ = "d0000000-0000-4000-8000-000000000001";
const D_TEAM = "d0000000-0000-4000-8000-000000000002";
const D_PART = "d0000000-0000-4000-8000-000000000003";
const D_SUPPORT = "d0000000-0000-4000-8000-000000000004";

const row = (
  userId: string,
  displayName: string,
  role: MemberSummaryRow["role"],
  scope: MemberSummaryRow["scope"],
  title: string | null,
): MemberSummaryRow => ({
  orgId: "org-visual",
  userId,
  displayName,
  role,
  scope,
  title,
  teamKey: null,
  createdAt: "2026-01-01T00:00:00Z",
});

/**
 * 화면이 말해야 하는 상태를 «한 화면에 전부» 담는다 —
 * 3단 부서 · 책임자 있음 · 책임자 공석 · 겸직 · 미배정 · 비활성.
 */
export function loadVisualOrgViewModel(options: { reportingKnown: boolean } = { reportingKnown: true }): OrgViewModel {
  const members = [
    { userId: OWNER, displayName: "가상 대표", avatarUrl: null, departmentIds: [] as string[], primaryDepartmentId: null, active: true },
    { userId: HEAD, displayName: "가상 본부장", avatarUrl: null, departmentIds: [D_HQ], primaryDepartmentId: D_HQ, active: true },
    // 겸직 — 1팀과 경영지원 양쪽에 있다. 두 부서 어디를 골라도 보여야 한다.
    { userId: STAFF, displayName: "가상 팀장", avatarUrl: null, departmentIds: [D_TEAM, D_SUPPORT], primaryDepartmentId: D_TEAM, active: true },
    { userId: SUB, displayName: "가상 파트원", avatarUrl: null, departmentIds: [D_PART], primaryDepartmentId: D_PART, active: true },
    { userId: IDLE, displayName: "가상 미배정", avatarUrl: null, departmentIds: [], primaryDepartmentId: null, active: false },
  ];

  // ★ memberCount 를 0 으로 박아 두면 조직도가 모든 부서를 「0명」이라고 말한다.
  //   진짜 loadOrgChart() 는 «활성 + 직접 배정» 으로 센다 — 픽스처도 같은 규칙을 쓴다.
  //   안 그러면 화면 확인 증거가 실제 화면과 다른 것을 보여 준다.
  const directCount = (deptId: string) =>
    members.filter((member) => member.active && member.departmentIds.includes(deptId)).length;

  return buildOrgViewModel({
    chart: {
      kind: "ready",
      departments: [
        { id: D_HQ, name: "영업본부", parentId: null, headUserId: HEAD, sortOrder: 0, memberCount: directCount(D_HQ) },
        { id: D_TEAM, name: "1팀", parentId: D_HQ, headUserId: STAFF, sortOrder: 0, memberCount: directCount(D_TEAM) },
        { id: D_PART, name: "지원파트", parentId: D_TEAM, headUserId: null, sortOrder: 0, memberCount: directCount(D_PART) },
        { id: D_SUPPORT, name: "경영지원", parentId: null, headUserId: null, sortOrder: 1, memberCount: directCount(D_SUPPORT) },
      ],
      members,
      unassignedCount: members.filter((member) => member.departmentIds.length === 0).length,
    },
    owner: row(OWNER, "가상 대표", "owner", "all", "대표이사"),
    admins: [row(HEAD, "가상 본부장", "admin", "department", "본부장")],
    members: [
      row(STAFF, "가상 팀장", "team_lead", "department", "팀장"),
      row(SUB, "가상 파트원", "member", "assigned", null),
      row(IDLE, "가상 미배정", "member", "assigned", null),
    ],
    // null 을 주면 화면이 「확인 못 함」이라고 말해야 한다 — 그 상태도 눈으로 본다.
    exceptions: options.reportingKnown ? new Map() : null,
  });
}
