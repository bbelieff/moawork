// T07 · 플랫폼 콘솔 IA.
//
// 개요 · 고객사 관리 · 접근 기록 · 지원 문의 · 지표 · 시스템 · 어드민 관리
// 순서는 운영 동선 기준이다 — 열자마자 손볼 것(고객사)이 위, 설정성(시스템/어드민)이 아래.

export type PlatformNavItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** 아직 화면이 없으면 '준비 중'으로 표시한다. */
  pending?: boolean;
};

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  { key: "overview", label: "개요", href: "/platform", icon: "◫" },
  { key: "orgs", label: "고객사 관리", href: "/platform/orgs", icon: "🏢" },
  { key: "access", label: "접근 기록", href: "/platform/access", icon: "🔑", pending: true },
  { key: "support", label: "지원 문의", href: "/platform/support", icon: "💬", pending: true },
  { key: "metrics", label: "지표", href: "/platform/metrics", icon: "📈" },
  { key: "billing", label: "결제·매출", href: "/platform/billing", icon: "₩" },
  { key: "system", label: "시스템", href: "/platform/system", icon: "⚙" },
  { key: "admins", label: "어드민 관리", href: "/platform/admins", icon: "👤" },
] as const;

/**
 * 현재 경로에 해당하는 메뉴 key.
 * `/platform` 은 정확히 일치할 때만 개요다 — 접두사로 보면 모든 하위 경로가 개요로 잡힌다.
 */
export function activeNavKey(pathname: string): string {
  const exact = PLATFORM_NAV.find((i) => i.href === pathname);
  if (exact) return exact.key;
  const nested = PLATFORM_NAV.filter((i) => i.href !== "/platform").find((i) =>
    pathname.startsWith(`${i.href}/`),
  );
  return nested?.key ?? "overview";
}
