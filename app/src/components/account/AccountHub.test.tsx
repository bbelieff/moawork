import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountViewModel } from "@/lib/account/presentation";
import { AccountHub } from "./AccountHub";

const account: AccountViewModel = {
  displayName: "테스트 사용자",
  maskedEmail: "te***@example.invalid",
  initial: "테",
  workspaceName: "테스트 회사",
  roleLabel: "사원",
  roleDescription: "사원으로 참여하고 있어요.",
  scopeLabel: "내게 배정된 업무",
  teamMessage: "아직 소속 팀이 없어요.",
  canManageCompany: false,
};

describe("AccountHub", () => {
  it("C안 핵심 정보와 현재 로그인만 렌더한다", () => {
    const html = renderToStaticMarkup(
      <AccountHub
        account={account}
        links={{ sessions: "/candidate/sessions", privacy: "/candidate/privacy" }}
      />,
    );

    expect(html).toContain("내 정보");
    expect(html).toContain("내 회사와 팀");
    expect(html).toContain("현재 로그인");
    expect(html).toContain("te***@example.invalid");
    expect(html).not.toContain("test-user@example.invalid");
    expect(html).not.toContain("1급");
    expect(html).not.toContain("지원 모드");
    expect(html).not.toContain("모든 기기에서 로그아웃");
  });

  it("대표에게만 점진적 회사 관리 설명을 보여준다", () => {
    const employee = renderToStaticMarkup(<AccountHub account={account} />);
    const owner = renderToStaticMarkup(
      <AccountHub
        account={{ ...account, roleLabel: "대표", canManageCompany: true }}
      />,
    );

    expect(employee).not.toContain("회사가 성장하면 여는 관리");
    expect(owner).toContain("회사가 성장하면 여는 관리");
    expect(owner).not.toContain("회사 관리</a>");
  });

  it("links가 없어도 안전한 읽기 화면을 렌더한다", () => {
    expect(() =>
      renderToStaticMarkup(<AccountHub account={account} />),
    ).not.toThrow();
  });
});
