import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { AccountMenu } from "@/components/account/AccountMenu";
import { AnalyticsIdentity } from "@/components/analytics/AnalyticsIdentity";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { buildAccountViewModel } from "@/lib/account/presentation";
import { loadWorkspaceRoutingSnapshot } from "@/lib/auth/workspace-entry-server";
import { loadLockedFeatures } from "@/lib/entitlements/server";
import {
  loadWorkspaceApprovals,
  loadWorkspaceEntryContext,
  type WorkspaceApprovals,
} from "@/lib/workspace-entry/server";
import { NotificationBell } from "@/components/notify/NotificationBell";
import { loadNotifySnapshot } from "@/lib/notify/server";
import { loadPlatformActor } from "@/lib/platform/actor";

// 앱 셸 — UI목업_모아워크셸_v0.3 (1단 사이드바 232px + 상단바).
// 색은 전부 globals.css 의 --mw-* 토큰 참조(하드코딩 hex 금지).
// getSession() 이 세션 없으면 /login 으로 보낸다(가드).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getSession();
  const routing = await loadWorkspaceRoutingSnapshot();
  const currentWorkspace = routing.kind === "ready"
    ? routing.memberships.filter((membership) => membership.orgId === ctx.org.id)
    : [];
  const logoHref = currentWorkspace.length === 1
    ? `/w/${currentWorkspace[0].slug}`
    : "/workspaces";
  const trustedOwnerOrgId = ctx.role === "owner" ? ctx.org.id : undefined;
  const workspaceApprovals: WorkspaceApprovals | null = trustedOwnerOrgId
    ? await loadWorkspaceApprovals(trustedOwnerOrgId)
    : null;
  const workspaceEntryContext = await loadWorkspaceEntryContext();
  const platformActor = await loadPlatformActor();
  const switcherWorkspaces = routing.kind === "ready"
    ? routing.memberships.map((membership) => ({
        orgId: membership.orgId,
        slug: membership.slug,
        name: membership.name,
        role: membership.role,
        status: "active" as const,
        signedImageUrl: null,
      }))
    : [];
  const switcherPendingRequests = workspaceEntryContext.kind === "ready"
    ? workspaceEntryContext.requests
        .filter((request) => request.status === "pending")
        .map((request) => ({
          requestId: request.requestId,
          name: request.kind === "create" ? "새 회사 요청" : "회사 합류 요청",
          kind: request.kind,
        }))
    : [];
  // Platform entry is a server-owned capability. Workspace-entry context is
  // useful for pending requests, but it is never used to elevate this action.
  const canAccessPlatform = platformActor.kind === "granted";

  // 엔타이틀먼트는 서버 진실 — 잠긴 기능키를 계산해 사이드바로 내린다.
  const features = Array.from(
    new Set(
      NAV_ITEMS.map((i) => i.feature).filter((f): f is NonNullable<typeof f> =>
        Boolean(f),
      ),
    ),
  );
  // ⚠ 예전엔 getRepo().isFeatureEnabled 로 직접 판정했는데, getRepo() 는 환경과 무관하게
  // 항상 LocalRepo(인메모리 시드)를 돌려줘서 프로덕션의 실 org UUID 가 조회되지 않았고
  // 결과적으로 **전 메뉴가 잠겼다**(P0). 이제 환경에 맞는 소스를 골라 읽는다.
  const lockedFeatures = await loadLockedFeatures(ctx.org.id, features);

  const initial = (ctx.user.name ?? "?").trim().charAt(0) || "?";
  const account = buildAccountViewModel(ctx);

  // 알림 스냅샷(벨 뱃지 + 사이드바 점/숫자). Supabase 미설정이면 빈 값이라 화면은 그대로 뜬다.
  const notify = await loadNotifySnapshot(ctx);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* 분석 필수 속성(org_id·role·plan_tier·app_version) 등록 + 내부 UUID 식별.
          DOM 을 그리지 않는다. 이메일·이름은 넘기지 않는다(PII 하드 금지). */}
      <AnalyticsIdentity
        userId={ctx.user.id}
        orgId={ctx.org.id}
        role={ctx.role}
        planTier={ctx.org.plan_tier}
      />
      {/* ── 사이드바 ── */}
      <aside
        className="relative flex h-auto w-full flex-none flex-col border-b px-3 py-3 md:sticky md:top-0 md:h-screen md:w-[232px] md:overflow-y-auto md:border-b-0 md:border-r md:py-[18px]"
        style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
      >
        <div className="px-2 pb-4 pt-1">
          <Logo height={30} href={logoHref} />
          <small
            className="mt-1.5 block pl-0.5 text-[11px]"
            style={{ color: "var(--mw-sub)" }}
          >
            {ctx.org.name} · 워크스페이스
          </small>
        </div>

        <div>
          <SidebarNav
            lockedFeatures={lockedFeatures}
            badges={workspaceApprovals
              ? { workspaceApprovals: workspaceApprovals.pendingCount }
              : undefined}
            // 알림 뱃지는 별도 prop — badges 는 서버 검증 키 전용 계약이라 침범하지 않는다.
            notifyBadges={notify.sidebar}
            workspaceSwitcher={{
              currentOrgId: ctx.org.id,
              workspaces: switcherWorkspaces,
              pendingRequests: switcherPendingRequests,
              destinations: {
                createHref: "/workspace-entry?mode=new",
                joinHref: "/workspace-entry?mode=resume",
                platformHref: canAccessPlatform
                  ? "/platform"
                  : undefined,
              },
              serverConfirmedCanAccessPlatform: canAccessPlatform,
            }}
          />
        </div>

        {/* 하단 사용자 */}
        <div
          className="mt-auto hidden items-center gap-2.5 border-t pl-2 pt-3 md:flex"
          style={{ borderColor: "var(--mw-line)" }}
        >
          <span
            className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full text-[13px] font-bold"
            style={{
              background: "var(--mw-primary)",
              color: "var(--mw-on-accent)",
            }}
          >
            {initial}
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="truncate">{ctx.user.name}</div>
            <small
              className="block text-[11px]"
              style={{ color: "var(--mw-sub)" }}
            >
              {account.roleLabel} · {account.scopeLabel}
            </small>
          </div>
        </div>
      </aside>

      {/* ── 본문 ── */}
      <div className="min-w-0 flex-1 px-4 py-4 sm:px-5 md:px-7 md:py-[22px]">
        {/* 페이지 제목은 각 화면이 자기 <h1> 로 그린다 — 셸은 우측 액션만 소유. */}
        <header className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {workspaceApprovals && workspaceApprovals.pendingCount > 0 ? (
              <Link
                href="/settings/members"
                className="hidden rounded-xl border px-3 py-2 text-[12px] font-semibold sm:inline-flex"
                style={{
                  background: "var(--mw-tint-coral)",
                  borderColor: "var(--mw-line)",
                  color: "var(--mw-people)",
                }}
              >
                승인 대기 {workspaceApprovals.pendingCount > 99 ? "99+" : workspaceApprovals.pendingCount}건
              </Link>
            ) : null}
            <div
              className="hidden w-[250px] rounded-xl border px-3.5 py-2 text-[13px] lg:block"
              style={{
                background: "var(--mw-card)",
                borderColor: "var(--mw-line)",
                color: "var(--mw-sub)",
              }}
            >
              🔍 업체·담당자 검색…
            </div>
            {/* 기존 🔔 자리에 그대로 연결한다(자리를 새로 만들지 않음).
                모바일(375px)에서도 알림을 확인해야 하므로 sm 미만 숨김은 걷어낸다. */}
            <NotificationBell initial={notify} />
            <ThemeToggle />
            <AccountMenu
              displayName={account.displayName}
              initial={account.initial}
              accountHref="/account"
              workspaceHref="/settings/account#workspace"
              sessionsHref="/settings/account/sessions"
              privacyHref="/settings/account/privacy"
              serverConfirmedCanAccessPlatform={canAccessPlatform}
              platformModeAction={canAccessPlatform
                ? { mode: "platform", next: "/platform" }
                : undefined}
            />
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
