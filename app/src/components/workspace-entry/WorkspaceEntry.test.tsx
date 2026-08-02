import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MyWorkspaceEntryRequest } from "@/lib/workspace-entry/server";
import {
  nextWorkspaceEntryQuestion,
  resolveWorkspaceEntryView,
  WorkspaceEntry,
  workspaceAddressPreview,
  workspaceEntryCopy,
  workspaceEntryPendingSummary,
  workspaceEntryProgress,
} from "./WorkspaceEntry";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

const pendingJoin: MyWorkspaceEntryRequest = {
  requestId: "10000000-0000-4000-8000-000000000001",
  kind: "join",
  status: "pending",
  createdAt: "2026-07-27T00:00:00.000Z",
  resolvedAt: null,
  decisionState: "pending",
  approvedTargetSlug: null,
  reviewDeadline: null,
};

describe("WorkspaceEntry B-3 state contract", () => {
  it("keeps only the current question in the create flow", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry initialView="create" />);

    expect(html).toContain('data-entry-view="create-name"');
    expect(html).toContain("회사 이름은 무엇인가요?");
    expect(html).toContain('data-focus-target="current-question"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("회사 시작 안내");
    expect(html).not.toContain("B-3 · 하나씩 묻기");
    expect((html.match(/<input/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("회사 주소는 무엇으로 할까요?");
    expect(workspaceEntryProgress("create-name")).toEqual({ label: "회사 이름", detail: "현재 질문 1개" });
    expect(nextWorkspaceEntryQuestion("create-name")).toBe("create-slug");
    expect(nextWorkspaceEntryQuestion("create-slug")).toBe("create-confirm");
    expect(workspaceEntryCopy("create-confirm").title).toContain("신청 내용을 확인");
    expect(workspaceAddressPreview("  My__팀 Workspace--01 ")).toBe("https://www.moa-work.com/w/my-workspace-01");
  });

  it("asks for only an English Workspace address before join confirmation", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry initialView="join" />);

    expect(html).toContain('data-entry-view="join-address"');
    expect(html).toContain("합류할 영문 Workspace 주소는 무엇인가요?");
    expect((html.match(/<input/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("초대 코드");
    expect(nextWorkspaceEntryQuestion("join-address")).toBe("join-confirm");
    expect(workspaceEntryCopy("join-confirm").title).toContain("합류 신청을 확인");
  });

  it("shows one next action before pending request management", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry requests={[pendingJoin]} />);

    expect(html).toContain('data-entry-view="pending"');
    expect(html).toContain('aria-label="대기 요청 상태"');
    expect(html).toContain('aria-label="대기 요청 행동"');
    expect(html).toContain("검토 중 · 회사 접근 0곳");
    expect(html).toContain("대기 요청 요약");
    expect(html).toContain("회사 합류 요청");
    expect(html).toContain("취소하거나 다시 입력하기");
    expect(html).toContain('aria-label="현재 질문 요약"');
    expect(html).toContain('href="/workspaces"');
    expect(html).not.toContain("현재 요청 취소 후 새 회사 시작");
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain("로그아웃");
    expect((html.match(/<button/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain("취소하고 다시 입력할게요");
    expect(html).not.toContain("7일 이내");
    expect(html).not.toContain("자동 만료");
    expect(workspaceEntryProgress("pending").detail).toBe("다음 행동 1개");
  });

  it("shows a 14-day expiry only when the backend deadline proves it", () => {
    const verified = {
      ...pendingJoin,
      reviewDeadline: "2026-08-10T00:00:00.000Z",
    } satisfies MyWorkspaceEntryRequest;
    const unverified = {
      ...pendingJoin,
      reviewDeadline: "2026-08-03T00:00:00.000Z",
    } satisfies MyWorkspaceEntryRequest;

    expect(workspaceEntryPendingSummary(verified)?.expiryLabel).toContain("요청 후 14일 자동 만료");
    expect(workspaceEntryPendingSummary(unverified)?.expiryLabel).toBeNull();
    expect(renderToStaticMarkup(<WorkspaceEntry requests={[verified]} />)).toContain("요청 후 14일 자동 만료");
    expect(renderToStaticMarkup(<WorkspaceEntry requests={[unverified]} />)).not.toContain("자동 만료");
  });

  it("fails closed for a platform operator without tenant actions", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry isPlatformAdmin platformRequests={[]} />);

    expect(html).toContain('data-entry-view="operator"');
    expect(html).toContain("고객 회사 접근과 완전히 분리된 운영 영역이에요.");
    expect(html).toContain("회사 접근 행동 없음");
    expect(html).not.toContain("새 회사를 시작할게요");
    expect(html).not.toContain("기존 회사에 합류할게요");
    expect(html).not.toContain("회사 만들기 요청 보내기");
    expect(html).not.toContain("합류 요청 보내기");
  });

  it("keeps an inactive block account-safe with no tenant action", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry initialView="blocked" />);

    expect(html).toContain('data-entry-view="blocked"');
    expect(html).toContain("회사 접근 상태를 다시 확인해야 해요.");
    expect(html).toContain("안전하게 재확인");
    expect(html).not.toContain("tenant 행동");
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("새 회사를 시작할게요");
    expect(html).not.toContain("기존 회사에 합류할게요");
  });

  it("applies fail-closed initial-state precedence deterministically", () => {
    expect(resolveWorkspaceEntryView({ initialView: "fork", hasPendingRequest: true, hasRejectedRequest: true, isPlatformAdmin: false })).toBe("pending");
    expect(resolveWorkspaceEntryView({ initialView: "create", hasPendingRequest: false, hasRejectedRequest: false, isPlatformAdmin: false })).toBe("create-name");
    expect(resolveWorkspaceEntryView({ initialView: "fork", hasPendingRequest: true, hasRejectedRequest: true, isPlatformAdmin: true })).toBe("operator");
    expect(workspaceEntryCopy("rejected").lead).toContain("안전한 다음 행동");
    expect(renderToStaticMarkup(<WorkspaceEntry initialView="rejected" />)).not.toContain("거절 사유");
  });
});

describe("진입 화면 탈출구 — 플랫폼 관리자 전용", () => {
  // 버그: 플랫폼 관리자가 소속 0이면 이 화면이 막다른 길이었다. 회사로 들어갈 수 없는데
  // 어드민 링크는 회사 안 스위처(⚙)에만 있었다.
  // 관리자는 pending 이 아니라 operator 뷰에 착지한다(resolveWorkspaceEntryView 가 우선 분기).
  // 그래서 탈출구는 operator 뷰에 있어야 실제로 도달 가능하다.
  it("플랫폼 관리자에게 현재 mode preference 전환과 로그아웃을 보여준다", () => {
    const html = renderToStaticMarkup(
      <WorkspaceEntry requests={[pendingJoin]} isPlatformAdmin />,
    );
    expect(html).toContain('data-entry-view="operator"');
    expect(html).toContain('action="/mode/preference"');
    expect(html).toContain('name="mode" value="platform"');
    expect(html).toContain('name="next" value="/platform"');
    expect(html).not.toContain('href="/platform"');
    expect(html).toContain("플랫폼 관리로 가기");
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain("로그아웃");
  });

  it("일반 사용자에게는 플랫폼 링크가 존재조차 렌더되지 않는다", () => {
    const html = renderToStaticMarkup(<WorkspaceEntry requests={[pendingJoin]} />);
    // 존재를 노출하지 않는다 — 숨기는 게 아니라 마크업에 없어야 한다.
    expect(html).not.toContain('action="/mode/preference"');
    expect(html).not.toContain('name="mode" value="platform"');
    expect(html).not.toContain('href="/platform"');
    expect(html).not.toContain("플랫폼 관리로 가기");
    // 기존 출구는 그대로(일반 사용자 흐름 불변).
    // ※ "현재 요청 취소 후 새 회사 시작" 버튼은 main 366cf7b(compact pending screen)이
    //    제거했다. 이 테스트의 검증 대상은 위의 플랫폼 링크 미노출이므로, 남은 출구로 확인한다.
    expect(html).toContain('href="/workspaces"');
    expect(html).toContain("로그아웃");
  });
});
