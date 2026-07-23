import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { AccountMenu } from "@/components/account/AccountMenu";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { buildAccountViewModel } from "@/lib/account/presentation";

// 앱 셸 — UI목업_모아워크셸_v0.3 (1단 사이드바 232px + 상단바).
// 색은 전부 globals.css 의 --mw-* 토큰 참조(하드코딩 hex 금지).
// getSession() 이 세션 없으면 /login 으로 보낸다(가드).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getSession();
  const repo = getRepo();

  // 엔타이틀먼트는 서버 진실 — 잠긴 기능키를 계산해 사이드바로 내린다.
  const features = Array.from(
    new Set(
      NAV_ITEMS.map((i) => i.feature).filter((f): f is NonNullable<typeof f> =>
        Boolean(f),
      ),
    ),
  );
  const lockedFeatures = features.filter(
    (f) => !repo.isFeatureEnabled(ctx.org.id, f),
  );

  const initial = (ctx.user.name ?? "?").trim().charAt(0) || "?";
  const account = buildAccountViewModel(ctx);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* ── 사이드바 ── */}
      <aside
        className="relative flex h-auto w-full flex-none flex-col border-b px-3 py-3 md:sticky md:top-0 md:h-screen md:w-[232px] md:overflow-y-auto md:border-b-0 md:border-r md:py-[18px]"
        style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
      >
        <div className="px-2 pb-4 pt-1">
          <Logo height={30} />
          <small
            className="mt-1.5 block pl-0.5 text-[11px]"
            style={{ color: "var(--mw-sub)" }}
          >
            {ctx.org.name} · 워크스페이스
          </small>
        </div>

        <div className="hidden md:block">
          <SidebarNav lockedFeatures={lockedFeatures} />
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
            <div
              className="hidden h-9 w-9 items-center justify-center rounded-xl border sm:flex"
              style={{
                background: "var(--mw-card)",
                borderColor: "var(--mw-line)",
              }}
              title="알림"
            >
              🔔
            </div>
            <ThemeToggle />
            <AccountMenu
              displayName={account.displayName}
              initial={account.initial}
              workspaceName={account.workspaceName}
              accountHref="/account"
              workspaceHref="/settings/account#workspace"
              sessionsHref="/settings/account/sessions"
              privacyHref="/settings/account/privacy"
            />
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
