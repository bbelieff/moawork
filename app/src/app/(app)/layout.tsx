import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getRepo } from "@/lib/repo";
import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { SidebarNav } from "@/components/shell/SidebarNav";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { roleLabel, scopeLabel } from "@/lib/auth/roles";

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

  async function signOut() {
    "use server";
    const jar = await cookies();
    jar.delete("mw_uid");
    jar.delete("mw_org");
    jar.delete("mw_as");
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1">
      {/* ── 사이드바 ── */}
      <aside
        className="sticky top-0 flex h-screen w-[232px] flex-none flex-col overflow-y-auto border-r px-3 py-[18px]"
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

        <SidebarNav lockedFeatures={lockedFeatures} />

        {/* 하단 사용자 */}
        <div
          className="mt-auto flex items-center gap-2.5 border-t pl-2 pt-3"
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
              {roleLabel(ctx.role)} · {scopeLabel(ctx.scope)}
            </small>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="로그아웃"
              aria-label="로그아웃"
              className="rounded-lg border px-1.5 py-1 text-[11px]"
              style={{ borderColor: "var(--mw-line)", color: "var(--mw-sub)" }}
            >
              ⏻
            </button>
          </form>
        </div>
      </aside>

      {/* ── 본문 ── */}
      <div className="min-w-0 flex-1 px-7 py-[22px]">
        {/* 페이지 제목은 각 화면이 자기 <h1> 로 그린다 — 셸은 우측 액션만 소유. */}
        <header className="mb-5 flex items-center gap-3">
          <div className="ml-auto flex items-center gap-3">
            <div
              className="w-[250px] rounded-xl border px-3.5 py-2 text-[13px]"
              style={{
                background: "var(--mw-card)",
                borderColor: "var(--mw-line)",
                color: "var(--mw-sub)",
              }}
            >
              🔍 업체·담당자 검색…
            </div>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl border"
              style={{
                background: "var(--mw-card)",
                borderColor: "var(--mw-line)",
              }}
              title="알림"
            >
              🔔
            </div>
            <ThemeToggle />
          </div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
