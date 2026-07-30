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
    expect(html).toContain('href="/workspaces"');
    expect(html).toContain("현재 요청 취소 후 새 회사 시작");
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain("로그아웃");
    expect((html.match(/<button/g) ?? [])).toHaveLength(3);
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
