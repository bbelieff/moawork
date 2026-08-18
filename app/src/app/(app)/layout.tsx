import type { ReactNode } from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { AppTabs } from "@/components/shell/AppTabs";
import { IconSprite } from "@/components/shell/icons";
import { GlobalSearch } from "@/components/shell/GlobalSearch";
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
import { ensureApprovedWorkspaceOnEntry } from "@/lib/workspace-entry/bootstrap";
import { createClient } from "@/lib/supabase/server";

function WorkspaceBootstrapUnavailable({ slug }: { slug: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-[var(--sp-5)]">
      <section role="alert" className="w-full rounded-[var(--mw-r-3)] border border-[var(--mw-line)] bg-[var(--mw-card)] p-[var(--sp-6)]">
        <h1 className="text-xl font-semibold">회사 기본 구조를 불러오지 못했습니다</h1>
        <p className="mt-[var(--sp-2)] text-sm text-[var(--mw-sub)]">
          빈 회사로 표시하지 않았습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.
        </p>
        <a
          className="mt-[var(--sp-4)] inline-flex rounded-[var(--mw-r-2)] bg-[var(--mw-primary)] px-[var(--sp-4)] py-[var(--sp-2)] font-semibold text-[var(--mw-on-accent)]"
          href={`/w/${slug}`}
        >
          다시 시도
        </a>
      </section>
    </main>
  );
}

// 앱 셸 — UI목업_워크스페이스_최종_v6 (1단 사이드바 220px + 상단바). BBE-126(2026-08-10) 밀도 개정.
// 색·간격·글자 크기는 전부 globals.css/moawork-tokens.css 의 --mw-*·--sp-*·--fs-* 토큰 참조(하드코딩 hex·임의 px 금지).
// getSession() 이 세션 없으면 /login 으로 보낸다(가드).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getSession();
  const routing = await loadWorkspaceRoutingSnapshot();
  const currentWorkspace = routing.kind === "ready"
    ? routing.memberships.filter((membership) => membership.orgId === ctx.org.id)
    : [];
  if (ctx.role === "owner" && currentWorkspace.length === 1) {
    try {
      await ensureApprovedWorkspaceOnEntry(await createClient(), currentWorkspace[0].slug);
    } catch {
      return <WorkspaceBootstrapUnavailable slug={currentWorkspace[0].slug} />;
    }
  }
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
      {/* IconSprite 는 한 번만 마운트 — Icon 이 <use href="#i-…"> 로 여기 심볼을 참조한다. */}
      <IconSprite />
      {/* ── 사이드바 ── */}
      <aside
        className="relative flex h-auto w-full flex-none flex-col border-b px-[var(--sp-3)] py-[var(--sp-3)] md:sticky md:top-0 md:h-screen md:w-[var(--mw-shell-nav-w)] md:overflow-visible md:border-b-0 md:border-r md:py-[var(--sp-4)]"
        style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
      >
        {/* 목업 v6 `.brand` — 로고 한 덩이만. 높이 48px · 좌우 --sp-3 · 아래 경계선.
            회사명은 여기 적지 않는다: 바로 아래 WorkspaceSwitcher 가 같은 이름을
            «누를 수 있는» 형태로(회사 전환 + 역할) 보여준다. 둘 다 그리면 중복이다(BBE-194).
            로고 height 40 = 락업 최소 너비 120px(design-tokens §5)을 만족하는 최소 높이.
            락업 viewBox 는 2400×800(3:1)이라 22 로 그리면 자연 너비가 66px 뿐이어서
            Logo 의 minWidth:120 이 가로로 1.8배 잡아늘였다 — 그 찌그러짐도 같이 없어진다. */}
        <div
          className="flex items-center border-b px-[var(--sp-3)]"
          style={{ height: "var(--mw-shell-header-h)", borderColor: "var(--mw-line)" }}
        >
          <Logo height={40} href={logoHref} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <SidebarNav
            workspaceBasePath={currentWorkspace.length === 1 ? `/w/${currentWorkspace[0].slug}` : undefined}
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
          className="mt-auto hidden items-center border-t md:flex"
          style={{
            borderColor: "var(--mw-line)",
            gap: "var(--sp-2)",
            paddingLeft: "var(--sp-2)",
            paddingTop: "var(--sp-3)",
          }}
        >
          <span
            className="flex flex-none items-center justify-center rounded-full font-bold"
            style={{
              width: "var(--mw-shell-avatar-size)",
              height: "var(--mw-shell-avatar-size)",
              fontSize: "var(--fs-13)",
              background: "var(--mw-primary)",
              color: "var(--mw-on-accent)",
            }}
          >
            {initial}
          </span>
          <div className="min-w-0 flex-1" style={{ fontSize: "var(--fs-13)" }}>
            <div className="truncate">{ctx.user.name}</div>
            <small
              className="block"
              style={{ color: "var(--mw-sub)", fontSize: "var(--fs-11)" }}
            >
              {account.roleLabel} · {account.scopeLabel}
            </small>
          </div>
        </div>
      </aside>

      {/* ── 본문 ── */}
      <div
        className="min-w-0 flex-1 px-[var(--sp-4)] py-[var(--sp-4)] sm:px-[var(--sp-5)] md:px-[var(--sp-6)] md:py-[var(--sp-6)]"
      >
        {/* 페이지 제목은 각 화면이 자기 <h1> 로 그린다 — 셸은 우측 액션만 소유. */}
        <header
          className="mb-[var(--sp-5)] flex flex-wrap items-center"
          style={{ gap: "var(--sp-2)" }}
        >
          <div className="ml-auto flex items-center" style={{ gap: "var(--sp-2)" }}>
            {workspaceApprovals && workspaceApprovals.pendingCount > 0 ? (
              <Link
                href="/settings/members"
                className="hidden border font-semibold sm:inline-flex"
                style={{
                  borderRadius: "var(--mw-r-2)",
                  paddingInline: "var(--sp-3)",
                  paddingBlock: "var(--sp-2)",
                  fontSize: "var(--fs-12)",
                  background: "var(--mw-tint-coral)",
                  borderColor: "var(--mw-line)",
                  color: "var(--mw-people)",
                }}
              >
                승인 대기 {workspaceApprovals.pendingCount > 99 ? "99+" : workspaceApprovals.pendingCount}건
              </Link>
            ) : null}
            {/* 목업 v6 `.top > .search` 자리 — 여기가 검색의 정본 위치다.
                예전엔 같은 자리에 「업체·담당자 검색…」 이라고 쓴 <div> 가 있었는데
                onClick 도 button 도 없는 «죽은 장식»이었다(PR #14 셸 목업의 잔재).
                진짜 통합 검색(BBE-22)은 사이드바에 처박혀 있어서 «정체불명»으로 보였다.
                기능을 지운 게 아니라 그 진짜 트리거를 이 자리로 옮긴 것이다(BBE-194). */}
            <GlobalSearch />
            {/* 기존 🔔 자리에 그대로 연결한다(자리를 새로 만들지 않음).
                모바일(375px)에서도 알림을 확인해야 하므로 sm 미만 숨김은 걷어낸다. */}
            <NotificationBell initial={notify} />
            <ThemeToggle />
            <AccountMenu
              displayName={account.displayName}
              loginEmail={account.loginEmail}
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
        {/* 목업 「탭 6개 한 화면」 — 여섯 업무 탭을 셸의 «같은 자리»에 그린다(BBE-142).
            탭 밖 화면(설정·계정·플랫폼)에서는 AppTabs 가 스스로 아무것도 그리지 않는다. */}
        <AppTabs
          lockedFeatures={lockedFeatures}
          workspaceBasePath={currentWorkspace.length === 1 ? `/w/${currentWorkspace[0].slug}` : undefined}
        />
        <main>{children}</main>
      </div>
    </div>
  );
}
