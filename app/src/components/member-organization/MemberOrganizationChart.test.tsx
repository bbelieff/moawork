import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberOrganizationChart, isUnavailableRpcError, normalizePermissionScopeKey } from "./MemberOrganizationChart";

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
