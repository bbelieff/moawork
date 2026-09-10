// @vitest-environment jsdom
//
// ★ jsdom 이 필요한 이유 — «버튼이 그려지는가» 만으로는 이 화면의 결함을 못 잡는다.
//   같은 판정이 두 곳(버튼을 그릴지 / 눌렀을 때 열지)에 있어서, 한쪽만 고치면
//   «보이는데 눌러도 아무 일이 안 나는» 상태가 된다. 그건 «눌러 봐야» 보인다.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MemberOrganizationChart, isUnavailableRpcError, normalizePermissionScopeKey, canEditMemberPermissions } from "./MemberOrganizationChart";
import { MEMBER_ROLES } from "@/lib/auth/roles";

const owner = { orgId: "org-a", userId: "owner-a", displayName: "대표", role: "owner" as const, scope: "all" as const, title: "대표", teamKey: "leadership", createdAt: "2026-01-01" };
const member = { orgId: "org-a", userId: "member-a", displayName: "사원", role: "member" as const, scope: "assigned" as const, title: null, teamKey: null, createdAt: "2026-01-02" };

describe("MemberOrganizationChart", () => {
  it("keeps the owner immutable and exposes lower-member profile editing only to an owner", () => {
    const ownerHtml = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles viewerUserId="owner-a" />);
    expect(ownerHtml).toContain("보호된 대표");
    expect(ownerHtml).toContain("직책·팀 수정");
    const viewerHtml = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles={false} viewerUserId="owner-a" />);
    expect(viewerHtml).not.toContain("직책·팀 수정");
    expect(viewerHtml).toContain("조회만 가능");
  });

  it("shows 013 controls only for a server-confirmed owner and never on the protected owner card", () => {
    const ownerHtml = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles viewerUserId="owner-a" />);
    expect(ownerHtml).toContain("업무 역할 설정");
    expect(ownerHtml).toContain("세부 권한 설정");
    expect(ownerHtml).toContain("보호된 대표");

    const viewerHtml = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles={false} viewerUserId="owner-a" />);
    expect(viewerHtml).not.toContain("업무 역할 설정");
    expect(viewerHtml).not.toContain("세부 권한 설정");
  });

  /*
   * ★ #702 — 「세부 권한 설정」은 «대표가 아닌 모두» 에게 열린다.
   *
   *   전에는 `role === "member"` 일 때만 그렸다. 그래서 사람을 팀장으로 올리는 순간
   *   그 사람의 세부 권한을 **제품에서 손댈 수 없었다.** DB 쪽
   *   `bind_workspace_member_permission_exception` 은 «대표만» 거부하는데 화면이 더 좁았다.
   *
   *   가장 나빴던 조합 — 구성원에게 「막기」를 걸고 팀장으로 올리면 막힌 것은 남는데
   *   (예외는 사람 단위이고 지우는 SQL 이 저장소에 0건이다) 버튼만 사라졌다.
   *
   * ★★ 역할을 손으로 적지 않고 MEMBER_ROLES 를 돈다 — 역할이 늘면 이 시험도 같이 늘어난다.
   *    2026-08-11 에 team_lead 가 생겼을 때 «시험이 역할을 안 바꿔 봐서» 일곱 군데가 어긋났다.
   */
  it.each(MEMBER_ROLES.filter((role) => role !== "owner").map((role) => [role]))(
    "★ %s 인 사람도 「세부 권한 설정」을 열 수 있다 — 대표가 아니면 DB 가 받는다",
    (role) => {
      const target = { ...member, userId: `u-${role}`, role };
      const html = renderToStaticMarkup(
        <MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[target]} canEditProfiles viewerUserId="owner-a" />,
      );
      expect(html, `${role} 카드에 버튼이 없다`).toContain("세부 권한 설정");
    },
  );

  it("★ 대표 카드에는 여전히 안 뜬다 — 뜨면 DB 가 거부하므로 거짓말이 된다", () => {
    const html = renderToStaticMarkup(
      <MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[]} canEditProfiles viewerUserId="owner-a" />,
    );
    expect(html).toContain("보호된 대표");
    expect(html).not.toContain("세부 권한 설정");
  });

  /*
   * ★★ 위 시험만으로는 «반쪽 수정» 을 통과시킨다 — 버튼이 «그려지는지» 만 보기 때문이다.
   *
   *   실제로 이 수정을 하다가 그 상태를 한 번 만들었다: 카드의 버튼 조건은 고쳤는데
   *   `beginPermissionEdit` 안의 `role !== "member"` 는 그대로여서,
   *   **버튼은 보이는데 눌러도 아무 일이 안 나는** 상태였다.
   *   같은 값이 두 곳에서 따로 버려지는 것 — #683 검수 P0-1 과 같은 병이다.
   *
   *   그래서 판정을 `canEditMemberPermissions` 하나로 합쳤고, 여기서 그 함수를 직접 잰다.
   *   두 곳이 «같은 함수» 를 쓰므로 이제 구조적으로 갈라질 수 없다.
   */
  describe("canEditMemberPermissions — 그리는 쪽과 여는 쪽이 «같은» 판정을 쓴다", () => {
    it.each(MEMBER_ROLES.filter((role) => role !== "owner").map((role) => [role]))(
      "★ %s 는 열 수 있다 — DB 가 대표만 거부하므로 화면이 더 좁으면 거짓말이다",
      (role) => {
        expect(canEditMemberPermissions(role)).toBe(true);
      },
    );

    it("대표는 못 연다 — DB(require_active_nonowner)와 같은 답이다", () => {
      expect(canEditMemberPermissions("owner")).toBe(false);
    });

    it("★ 역할이 늘어도 «대표만» 이 기준이다 — 목록을 손으로 적지 않는다", () => {
      const allowed = MEMBER_ROLES.filter(canEditMemberPermissions);
      expect(allowed).toEqual(MEMBER_ROLES.filter((role) => role !== "owner"));
    });
  });

  /*
   * ★★★ «눌러 보는» 시험 — 위 시험들만으로는 반쪽 수정을 통과시킨다.
   *
   *   실측으로 확인했다: `beginPermissionEdit` 의 판정만 옛날(`role !== "member"`)로
   *   되돌려 놓아도 **위 시험 14개가 전부 통과**했다. 버튼이 그려지는 것과
   *   눌렀을 때 열리는 것은 다른 일이고, 앞의 것만 재고 있었기 때문이다.
   *
   *   그래서 여기서는 실제로 «누른다». 팀장 카드의 「세부 권한 설정」을 눌러
   *   편집창이 열리는지 본다. 열리지 않으면 그건 사용자가 겪는 그대로다 —
   *   버튼은 보이는데 눌러도 아무 일이 안 난다.
   */
  describe("눌러서 열린다 — 그려지는 것과 열리는 것은 다른 일이다", () => {
    let host: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
      if (root) act(() => root!.unmount());
      host?.remove();
      root = null;
      host = null;
    });

    function open(role: (typeof MEMBER_ROLES)[number]) {
      const target = { ...member, userId: `u-${role}`, displayName: `대상-${role}`, role };
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => {
        root!.render(
          <MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[target]} canEditProfiles viewerUserId="owner-a" />,
        );
      });
      const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "세부 권한 설정");
      expect(button, `${role} 카드에 「세부 권한 설정」 버튼이 없다`).toBeTruthy();
      act(() => {
        button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      return { text: host.textContent ?? "", displayName: target.displayName };
    }

    it.each(MEMBER_ROLES.filter((role) => role !== "owner").map((role) => [role]))(
      "★ %s — 누르면 세부 권한 편집창이 실제로 열린다",
      (role) => {
        const { text, displayName } = open(role);
        expect(text, `${role}: 버튼은 보이는데 눌러도 안 열린다`).toContain(`${displayName}의 세부 권한`);
      },
    );
  });

  // BBE-88: 조직도가 이름만 보여줘서 같은 사람의 다른 계정(요청 계정 vs 승인 계정)을
  // 화면에서 구분할 수 없었다. "나" 표식은 지금 로그인한 계정 카드에만 붙는다.
  it("marks only the viewer's own card so two accounts with the same name stay distinguishable", () => {
    const asOwner = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles viewerUserId="owner-a" />);
    expect(asOwner).toContain(">나<");
    expect(asOwner.indexOf(">나<")).toBeLessThan(asOwner.indexOf("보호된 대표"));

    const asMember = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles={false} viewerUserId="member-a" />);
    expect(asMember).toContain(">나<");
    expect(asMember.indexOf("보호된 대표")).toBeLessThan(asMember.indexOf(">나<"));

    const asOutsider = renderToStaticMarkup(<MemberOrganizationChart orgId="org-a" owner={owner} admins={[]} members={[member]} canEditProfiles={false} viewerUserId="someone-else" />);
    expect(asOutsider).not.toContain(">나<");
    expect(asOutsider).toContain("보호된 대표");
  });

  it("normalizes only the contract-safe lower-member permission scope key", () => {
    expect(normalizePermissionScopeKey(" Board:Sales ")).toBe("board:sales");
    expect(normalizePermissionScopeKey("scope with spaces")).toBeNull();
    expect(normalizePermissionScopeKey("_")).toBeNull();
  });

  it("classifies an absent hosted RPC as unavailable without treating any reply as success", () => {
    expect(isUnavailableRpcError({ code: "PGRST202" })).toBe(true);
    expect(isUnavailableRpcError({ code: "42883" })).toBe(true);
    expect(isUnavailableRpcError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isUnavailableRpcError(null)).toBe(false);
  });
});
