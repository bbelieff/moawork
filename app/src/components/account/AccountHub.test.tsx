import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountOrgProfile, AccountViewModel } from "@/lib/account/presentation";
import { AccountHub } from "./AccountHub";
import type { ManagedWorkspace } from "./WorkspaceManagementPanel";

const account: AccountViewModel = {
  displayName: "테스트 사용자",
  loginEmail: "test-user@example.invalid",
  initial: "테",
  workspaceName: "테스트 회사",
  roleLabel: "구성원",
  roleDescription: "구성원으로 참여하고 있어요.",
  scopeLabel: "본인 담당분",
  canManageCompany: false,
  scopeNote: null,
};

const orgProfile: AccountOrgProfile = {
  title: { kind: "ready", value: "운영 담당" },
  department: { kind: "ready", value: "고객지원팀" },
  job: { kind: "ready", value: "고객 요청을 분류하고 다음 담당자에게 연결해요." },
  reportsTo: { kind: "ready", value: "테스트 팀장" },
};

const workspaces: ManagedWorkspace[] = [{
  orgId: "org-owner",
  name: "대표 회사",
  slug: "owner-company",
  role: "owner",
  status: "active",
  deletionRequestedAt: null,
}, {
  orgId: "org-member",
  name: "참여 회사",
  slug: "member-company",
  role: "member",
  status: "active",
  deletionRequestedAt: null,
}];

describe("AccountHub", () => {
  it("C안 핵심 정보와 현재 로그인만 렌더한다", () => {
    const html = renderToStaticMarkup(
      <AccountHub
        account={account}
        orgProfile={orgProfile}
        links={{ sessions: "/candidate/sessions", privacy: "/candidate/privacy" }}
      />,
    );

    expect(html).toContain("내 정보");
    expect(html).toContain("내 회사 관리");
    expect(html).toContain("현재 로그인");
    expect(html).toContain("test-user@example.invalid");
    expect(html).not.toContain("1급");
    expect(html).not.toContain("지원 모드");
    expect(html).not.toContain("모든 기기에서 로그아웃");
  });

  it("대표에게만 점진적 회사 관리 설명을 보여준다", () => {
    const employee = renderToStaticMarkup(<AccountHub account={account} orgProfile={orgProfile} />);
    const owner = renderToStaticMarkup(
      <AccountHub
        account={{ ...account, roleLabel: "대표", canManageCompany: true }}
        orgProfile={orgProfile}
      />,
    );

    expect(employee).not.toContain("회사가 성장하면 여는 관리");
    expect(owner).toContain("회사가 성장하면 여는 관리");
    expect(owner).not.toContain("회사 관리</a>");
  });

  it("links가 없어도 안전한 읽기 화면을 렌더한다", () => {
    expect(() =>
      renderToStaticMarkup(<AccountHub account={account} orgProfile={orgProfile} />),
    ).not.toThrow();
  });

  it("접근 가능한 회사 전체와 역할별 삭제 경계를 보여준다", () => {
    const html = renderToStaticMarkup(<AccountHub account={account} orgProfile={orgProfile} workspaces={workspaces} />);
    expect(html).toContain("대표 회사");
    expect(html).toContain("참여 회사");
    expect(html).toContain("확인을 위해");
    expect(html).toContain("회사 삭제는 현재 대표만 요청할 수 있어요");
    expect(html).not.toContain("접근 가능한 회사가 없어요");
  });

  it("전역 로그인 정보와 현재 회사의 조직 정보를 분리해서 보여준다", () => {
    const html = renderToStaticMarkup(<AccountHub account={account} orgProfile={orgProfile} />);
    const globalCard = html.match(/<section[^>]*data-account-scope="global"[\s\S]*?<\/section>/)?.[0] ?? "";
    const companyCard = html.match(/<section[^>]*data-account-scope="organization"[\s\S]*?<\/section>/)?.[0] ?? "";

    expect(html).toContain("현재 회사에서의 내 정보");
    expect(html).toContain("표시 이름과 로그인 정보는 모든 회사에서 같고");
    expect(globalCard).toContain("표시 이름");
    expect(globalCard).toContain("로그인 이메일");
    expect(globalCard).not.toContain("역할");
    expect(globalCard).not.toContain("볼 수 있는 범위");
    expect(companyCard).toContain("역할");
    expect(companyCard).toContain("볼 수 있는 범위");
    expect(companyCard).toContain("운영 담당");
    expect(companyCard).toContain("고객지원팀");
    expect(companyCard).toContain("테스트 팀장");
    expect(html.indexOf('data-account-scope="global"')).toBeLessThan(html.indexOf('data-account-scope="organization"'));
  });

  it("비어 있음과 읽기 오류를 서로 다른 문구로 보존한다", () => {
    const html = renderToStaticMarkup(
      <AccountHub
        account={account}
        orgProfile={{
          title: { kind: "empty", message: "아직 호칭이 정해지지 않았어요." },
          department: { kind: "empty", message: "아직 주부서가 정해지지 않았어요." },
          job: { kind: "error", message: "직무 안내를 확인하지 못했어요." },
          reportsTo: { kind: "error", message: "보고 대상을 확인하지 못했어요." },
        }}
      />,
    );

    expect(html).toContain("아직 호칭이 정해지지 않았어요.");
    expect(html).toContain("직무 안내를 확인하지 못했어요.");
    expect(html).not.toContain("직무 안내가 아직 작성되지 않았어요.");
    expect(html).toContain('data-profile-state="empty"');
    expect(html).toContain('data-profile-state="error"');
  });
});
