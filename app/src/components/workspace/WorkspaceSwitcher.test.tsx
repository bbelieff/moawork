import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { prepareWorkspaceList, WorkspaceSwitcher, type SwitcherWorkspace } from "./WorkspaceSwitcher";

const active: SwitcherWorkspace[] = [
  { orgId: "org-b", slug: "sample-bridge", name: "샘플 브리지", role: "member", status: "active" },
  { orgId: "org-a", slug: "sample-lab", name: "샘플랩", role: "owner", status: "active", signedImageUrl: "https://assets.example.invalid/signed/sample.webp" },
  { orgId: "org-inactive", slug: "old-company", name: "중지된 회사", role: "admin", status: "inactive" },
];

const destinations = {
  createHref: "/workspace-entry?mode=new",
  joinHref: "/workspace-entry?mode=join",
  platformHref: "/platform",
};

describe("prepareWorkspaceList", () => {
  it("현재 회사를 먼저 두고 active 입력만 렌더 계약에 남긴다", () => {
    expect(prepareWorkspaceList("org-a", active)).toEqual({ ok: true, current: active[1], workspaces: [active[1], active[0]] });
  });

  it("중복 org/slug, 잘못된 slug, 현재 회사 불일치는 fail-closed다", () => {
    expect(prepareWorkspaceList("org-a", [...active, { ...active[0] }])).toEqual({ ok: false });
    expect(prepareWorkspaceList("org-a", [active[1], { ...active[0], slug: active[1].slug }])).toEqual({ ok: false });
    expect(prepareWorkspaceList("org-a", [{ ...active[1], slug: "BAD_SLUG" }])).toEqual({ ok: false });
    expect(prepareWorkspaceList("missing", active)).toEqual({ ok: false });
  });
});

describe("WorkspaceSwitcher", () => {
  function render(serverConfirmedCanAccessPlatform = false) {
    return renderToStaticMarkup(
      <WorkspaceSwitcher
        currentOrgId="org-a"
        workspaces={active}
        pendingRequests={[{ requestId: "request-1", name: "예시 합류 회사", kind: "join" }]}
        destinations={destinations}
        serverConfirmedCanAccessPlatform={serverConfirmedCanAccessPlatform}
        onNavigate={async () => {}}
        defaultOpen
      />,
    );
  }

  it("dialog/list 의미, current/pending 상태와 canonical workspace 루트만 렌더한다", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="활성 회사 목록"');
    expect(html).toContain('data-destination="/w/sample-lab"');
    expect(html).toContain('data-destination="/w/sample-bridge"');
    expect(html).not.toContain('/w/sample-bridge/');
    expect(html).toContain("사용 중");
    expect(html).toContain("승인 대기");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("중지된 회사");
  });

  it("create/join은 trusted href seam만 쓰고 stale intent를 만들지 않는다", () => {
    const html = render();
    expect(html).toContain('data-destination="/workspace-entry?mode=new"');
    expect(html).toContain('data-destination="/workspace-entry?mode=join"');
    expect(html).toContain("활성 회사만 선택할 수 있어요.");
    expect(html).toContain("새 워크스페이스를 시작해요");
    expect(html).toContain("초대 정보로 안전하게 찾아요");
    expect(html).not.toContain("intent=create");
    expect(html).not.toContain("intent=join");
  });

  it("platform 항목은 서버 확인 capability와 href가 함께 있을 때만 DOM에 존재한다", () => {
    expect(render(false)).not.toContain("관리자 모드로");
    expect(render(true)).toContain("관리자 모드로");
    const html = renderToStaticMarkup(<WorkspaceSwitcher currentOrgId="org-a" workspaces={active} destinations={{ createHref: "/new", joinHref: "/join" }} serverConfirmedCanAccessPlatform onNavigate={async () => {}} defaultOpen />);
    expect(html).not.toContain("관리자 모드로");
  });

  it("잘못된 active/current 계약은 이동 항목 없이 복구 안내만 보여준다", () => {
    const html = renderToStaticMarkup(<WorkspaceSwitcher currentOrgId="missing" workspaces={active} destinations={destinations} onNavigate={async () => {}} defaultOpen />);
    expect(html).toContain("회사를 확인할 수 없어요");
    expect(html).not.toContain("새 회사 만들기");
    expect(html).not.toContain("관리자 모드로");
  });

  it("counts, badges, fake backend success를 렌더하지 않는다", () => {
    const html = render();
    expect(html).not.toContain("badge");
    expect(html).not.toContain("99+");
    expect(html).not.toContain("성공했어요");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ #262 — «되돌리면 빨개지는가» 를 보장하는 자리 (DC-18 지적)
//
//   BBE-208 에서 이 라이브 리전을 role="status" 고정에서 판정 파생으로 바꿨는데,
//   되돌려도 스위트 전체가 초록이었다. navigationError 는 테스트 어디에도 없었다.
//   전수 검사기는 role={변수} 를 원리적으로 못 읽으므로 «그려서» 재는 수밖에 없다.
//
//   실패쪽(navigationError 있음 → alert)은 내부 state 라 정적 렌더로 못 만든다.
//   그쪽은 result-notice.test.ts 의 VERDICT_BANNERS 가 배선을 못 박는다.
//   여기서 성공쪽을 못 박아야 «전부 alert 로 칠하는 도망» 이 막힌다.
// ─────────────────────────────────────────────────────────────────────────────
describe("WorkspaceSwitcher 라이브 리전 — 판정 파생", () => {
  const html = renderToStaticMarkup(
    <WorkspaceSwitcher
      currentOrgId="org-a"
      workspaces={active}
      destinations={destinations}
      onNavigate={async () => {}}
    />,
  );

  // 되돌리면 빨개진다: role={noticeRole(!navigationError)} → role="alert"
  it("★ 이동 실패가 «없을» 때는 status 다 — 전부 alert 로 칠하면 빨개진다", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  // 되돌리면 빨개진다: role={noticeRole(!navigationError)} → role="alert"
  it("★ 조용한 화면을 alert 로 떠들지 않는다", () => {
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-live="assertive"');
  });
});
