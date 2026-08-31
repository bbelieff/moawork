import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OrgChart } from "@/lib/org/departments";

vi.mock("@/app/(app)/settings/members/department-actions", () => ({
  assignDepartmentMemberAction: vi.fn(),
  createDepartmentAction: vi.fn(),
  moveDepartmentAction: vi.fn(),
  renameDepartmentAction: vi.fn(),
}));

import { DepartmentManager } from "./DepartmentManager";

const chart: OrgChart = {
  kind: "ready",
  departments: [
    { id: "00000000-0000-4000-8000-0000000000d1", name: "운영", parentId: null, headUserId: null, sortOrder: 0, memberCount: 1 },
    { id: "00000000-0000-4000-8000-0000000000d2", name: "심사", parentId: "00000000-0000-4000-8000-0000000000d1", headUserId: null, sortOrder: 0, memberCount: 0 },
  ],
  members: [
    { userId: "00000000-0000-4000-8000-0000000000e1", displayName: "테스트 구성원", avatarUrl: null, departmentIds: ["00000000-0000-4000-8000-0000000000d1"], primaryDepartmentId: "00000000-0000-4000-8000-0000000000d1", active: true },
    { userId: "00000000-0000-4000-8000-0000000000e2", displayName: "퇴사 구성원", avatarUrl: null, departmentIds: [], primaryDepartmentId: null, active: false },
  ],
  unassignedCount: 1,
};

describe("#571 조직도 관리 화면", () => {
  it("manager에게 트리·생성·이름/상위 편집·활성 구성원 배정을 한 화면에 둔다", () => {
    const html = renderToStaticMarkup(<DepartmentManager chart={chart} canManage />);
    expect(html).toContain("조직도 관리");
    expect(html).toContain("부서 구조");
    expect(html).toContain("운영");
    expect(html).toContain("심사");
    expect(html).toContain("활성 조직원 1");
    expect(html).toContain("주부서 미지정 1");
    expect(html).toContain("부서 만들기");
    expect(html).toContain("이름 저장");
    expect(html).toContain("위치 저장");
    expect(html).toContain("테스트 구성원");
    expect(html).not.toContain("퇴사 구성원");
  });

  /*
   * #640 QA — 「조직원」이 한 화면에서 두 가지를 뜻하던 것을 막는다.
   *
   * 이 카드 바로 «위» 에 OrgViewTabs 요약줄이 「부서 N · 조직원 N · 미배정 N」을 적는데,
   * 그쪽 조직원은 «비활성 포함 전체» 다(org-view.ts 의 views 는 active 로 거르지 않는다).
   * 이 카드가 세는 것은 «활성» 이다 — 아래에 실제로 줄 세우는 사람이 그들뿐이라서다.
   * 수는 둘 다 맞는데 이름이 같아서, 세로로 나란히 선 두 수가 서로를 거짓말로 만든다.
   * 데모 8명 + 대표 + 비활성 1명 상태에서 실제로 「조직원 9」와 「조직원 8」이 그렇게 섰다.
   */
  it("「조직원」이 무엇을 세는지 이름으로 밝힌다 — 위 요약줄과 같은 낱말로 다른 수를 말하지 않는다", () => {
    const html = renderToStaticMarkup(<DepartmentManager chart={chart} canManage />);
    // 활성 1 · 전체 2 인 조직이다. 이 카드가 세는 것은 활성이고, 그렇게 «적어야» 한다.
    expect(html).toContain("활성 조직원 1");
    // 「활성」을 뗀 맨 배지가 되살아나면 위의 「조직원 2」와 다시 충돌한다.
    // ★ 배지만 겨눈다 — 「조직원 주부서」 같은 «다른 뜻의 제목» 까지 잡으면 시험이 헛돈다.
    expect(html).not.toContain(">조직원 1<");
  });

  it("member는 같은 트리와 배정을 읽되 모든 쓰기 버튼이 없다", () => {
    const html = renderToStaticMarkup(<DepartmentManager chart={chart} canManage={false} />);
    expect(html).toContain("조회만 가능");
    expect(html).toContain("테스트 구성원");
    expect(html).toContain("운영");
    expect(html).not.toContain("부서 만들기");
    expect(html).not.toContain("이름 저장");
    expect(html).not.toContain("위치 저장");
  });

  it("빈 조직과 읽기 오류를 서로 다른 상태로 설명하고 하드코딩 부서를 만들지 않는다", () => {
    const empty = renderToStaticMarkup(<DepartmentManager chart={{ kind: "ready", departments: [], members: [], unassignedCount: 0 }} canManage />);
    const error = renderToStaticMarkup(<DepartmentManager chart={{ kind: "error" }} canManage />);
    expect(empty).toContain("아직 부서가 없어요");
    expect(empty).toContain("새 워크스페이스는 부서 0개로 시작합니다");
    expect(error).toContain("조직도를 불러오지 못했어요");
    expect(error).not.toContain("아직 부서가 없어요");
  });
});
