import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import { loadTodayHome } from "@/lib/dash/today-server";
import { TodayHome } from "@/components/dash/TodayHome";
import { CompanyStatusSection } from "@/components/dash/CompanyStatusSection";
import type { MemberRole } from "@/lib/types";
import { PlatformAccessNotice } from "@/components/platform/PlatformAccessNotice";

// 홈 = V6 «오늘». 로고를 누르면 오는 화면이고, 워크스페이스에 들어와 처음 보는 화면이다.
// 정본: docs/design/UI목업_워크스페이스_최종_v6.html:1528~1570 —
//   "보드가 아니라 «오늘 뭘 해야 하나»가 먼저 나와야 한다."
//
// ★ 2026-08-18 총괄 확정으로 «되돌렸다». BBE-186 은 분석 위젯을 /dash 로 내보냈고 이 자리에
//   「다시 붙이지 마라」고 적어 뒀는데, 총괄이 목업 부제의 «회사 현황» 이 맞다고 판단해
//   **별도 화면이 아니라 홈 한 화면 아래** 로 넣기로 했다(BBE-215).
//
//   그래서 홈은 이제 두 층이다:
//     위  — 오늘: KPI 줄 · 내 할 일 · 최근 알림 · 바로 가기
//     아래 — 회사 현황: 파이프라인·전환율·계약상황·수납·정산·재접촉·후속연락
//
//   ★ 옛 지시를 «지우지 않고» 뒤집힌 경위를 남긴다. 안 그러면 다음 사람이 이 절을 보고
//     「BBE-186 을 어겼네」로 읽고 되돌린다. 규칙이 바뀐 것이지 어긴 것이 아니다.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const asParam = typeof sp.as === "string" ? sp.as : undefined;
  const accessError = typeof sp.error === "string" ? sp.error : undefined;
  const month = typeof sp.month === "string" ? sp.month : undefined;

  const base = await getSession();
  const devToolsEnabled = process.env.NODE_ENV !== "production";
  const ctx = devToolsEnabled ? applyAs(base, asParam) : base;
  const today = await loadTodayHome(ctx.org.id);
  const roles: MemberRole[] = ["owner", "admin", "member"];

  return (
    <div className="flex flex-col gap-[var(--sp-4)]">
      <PlatformAccessNotice error={accessError} />
      {devToolsEnabled ? (
        <section className="flex flex-wrap items-center gap-[var(--sp-2)]">
          <span className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">보기 역할(개발용):</span>
          {roles.map((role) => (
            <Link
              key={role}
              href={`/?as=${role}`}
              className={`rounded-[var(--mw-r-1)] border px-[var(--sp-2)] py-[2px] text-[length:var(--fs-12)] ${
                ctx.role === role
                  ? "border-[var(--mw-t-1)] bg-[var(--mw-t-1)] text-[var(--mw-on-accent)]"
                  : "border-[var(--mw-bd)] text-[var(--mw-t-2)] hover:bg-[var(--mw-s-1)]"
              }`}
            >
              {role}
            </Link>
          ))}
          <span className="ml-[var(--sp-2)] text-[length:var(--fs-11)] text-[var(--mw-t-4)]">
            현재 {ctx.role}/{ctx.scope} — member+assigned 는 본인 담당만 집계됩니다.
          </span>
        </section>
      ) : null}

      <header className="flex flex-wrap items-baseline justify-between gap-[var(--sp-2)]">
        <h1 className="text-[length:var(--fs-18)] font-semibold text-[var(--mw-t-1)]">오늘</h1>
        <span className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
          {today.kind === "ready" ? `${today.snapshot.period.today} (KST)` : "KST"}
        </span>
      </header>

      <FeatureGateServer orgId={ctx.org.id} feature={FEATURES.dash} label="대시보드">
        <TodayHome state={today} />
      </FeatureGateServer>

      {/* ── 아래 절: 회사 현황 (BBE-215) ── */}
      <CompanyStatusSection ctx={ctx} month={month} today={today} />
    </div>
  );
}
