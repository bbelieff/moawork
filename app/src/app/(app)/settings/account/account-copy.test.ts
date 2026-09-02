import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMyPrivacyAccountData: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-1" } })),
}));

vi.mock("@/lib/account/memberAccountOps", () => ({
  getMyPrivacyAccountData: mocks.getMyPrivacyAccountData,
}));

vi.mock("./actions", () => ({
  requestPrivacyExport: vi.fn(),
}));

import AccountPrivacyPage from "./privacy/page";

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("account settings copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("개인정보 화면이 RPC 결과를 쉬운 한국어 항목으로 보여준다", async () => {
    mocks.getMyPrivacyAccountData.mockResolvedValue({
      identity: {
        id: "user-1",
        email: "me@example.test",
        name: "김모아",
        avatar_url: "https://example.test/avatar.png",
      },
      workspace_profile: {
        role: "admin",
        scope: "assigned",
        title: "운영 담당",
        team_key: "sales-a",
      },
    });

    const html = renderToStaticMarkup(await AccountPrivacyPage());

    expect(html).toContain("김모아");
    expect(html).toContain("me@example.test");
    expect(html).toContain("회사 역할");
    /*
     * ★ 전에는 이 줄이 `toContain("팀장")` 이었다. 픽스처의 role 은 `admin` 인데도.
     *   화면이 admin 을 「팀장」이라고 부르고 있었고, **이 시험이 그 결함을 지키고 있었다.**
     *   관리자인 사람이 «개인정보와 데이터» 화면에서 자기 역할을 팀장으로 읽었다는 뜻이다.
     */
    expect(html).toContain("관리자");
    expect(html).not.toContain("팀장");
    expect(html).toContain("볼 수 있는 업무");
    expect(html).toContain("본인 담당분");
    expect(html).toContain("운영 담당");
    expect(html).toContain("sales-a");
    for (const rawKey of ["identity", "workspace_profile", "avatar_url", "role", "scope", "team_key"]) {
      expect(html).not.toContain(rawKey);
    }
  });

  it("★ 팀장도 자기 역할을 본다 — 전에는 「확인할 수 없어요」로 떨어졌다", async () => {
    /*
     * 손으로 적은 이름표에 team_lead 가 «아예 없었다». 그래서 팀장인 사람은
     * 자기 역할 칸에서 「확인할 수 없어요」를 봤다 — 우리는 알고 있는데도.
     * 정본(lib/auth/roles.ts)에서 파생시키면 역할이 늘어도 빠질 자리가 없다.
     */
    mocks.getMyPrivacyAccountData.mockResolvedValue({
      identity: { id: "user-2", email: "lead@example.test", name: "이팀장", avatar_url: null },
      workspace_profile: { role: "team_lead", scope: "department", title: null, team_key: null },
    });

    const html = renderToStaticMarkup(await AccountPrivacyPage());

    expect(html).toContain("팀장");
    expect(html).toContain("부서 이하 전체");
    expect(html).not.toContain("확인할 수 없어요");
  });

  it("개인정보 화면이 회사 중심 용어와 실제 다음 행동을 안내한다", () => {
    const source = readSource("./privacy/page.tsx");

    expect(source).toContain("<h1>내 개인정보</h1>");
    expect(source).toContain("로그인 정보와 회사 업무 자료는 나누어 보호해요.");
    expect(source).toContain(
      "내 로그인 정보와 현재 회사에서 사용하는 내 정보만 보여드려요.",
    );
    expect(source).toContain("내 정보 내보내기 요청하기");
    expect(source).toContain("개인정보를 불러오지 못했어요");
    expect(source).toContain("잠시 후 이 화면을 다시 열어 주세요.");
    expect(source).not.toContain("JSON.stringify");
    expect(source).not.toContain("내 데이터 내보내기 요청");

    expect(source).toContain('aria-label="내 개인정보"');
    expect(source).toContain("<form action={requestPrivacyExport}>");
    expect(source).toContain('href: "/settings/account/privacy"');
  });

  it("로그인 기기 화면이 세션 대신 기기와 로그아웃 행동을 안내한다", () => {
    const source = readSource("./sessions/page.tsx");

    expect(source).toContain("지금 사용하는 기기에서 안전하게 로그아웃할 수 있어요.");
    expect(source).toContain("로그인한 기기 정보를 불러오지 못했어요");
    expect(source).toContain("로그인한 기기 {sessions.length}개");
    expect(source).toContain('session.current_session ? "지금 사용하는 기기" : "다른 기기"');
    expect(source).toContain("이 기기에서 로그아웃");
    expect(source).not.toContain("활성 세션");
    expect(source).not.toContain('"현재 세션"');
    expect(source).not.toContain('"다른 세션"');
    expect(source).not.toContain("이 세션 로그아웃");

    expect(source).toContain('aria-label="로그인 세션"');
    expect(source).toContain("<form action={revokeCurrentSession}");
    expect(source).toContain("<form action={revokeAllSessions}>");
    expect(source).toContain('name="sessionId"');
  });

  it("계정 공통 상태는 기존 재시도와 로딩 의미를 유지한다", () => {
    const errorSource = readSource("./error.tsx");
    const loadingSource = readSource("./loading.tsx");

    expect(errorSource).toContain("계정 정보를 불러오지 못했어요");
    expect(errorSource).toContain("바뀐 내용은 없어요. 잠시 뒤 다시 확인해 주세요.");
    expect(errorSource).toContain("onClick={() => unstable_retry()}");
    expect(errorSource).toContain("다시 불러오기");

    expect(loadingSource).toContain('aria-busy="true"');
    expect(loadingSource).toContain('role="status"');
    expect(loadingSource).toContain("계정 정보를 불러오고 있어요.");
  });
});
