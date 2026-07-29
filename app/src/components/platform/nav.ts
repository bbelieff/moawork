// T07 · 플랫폼 콘솔 IA — belie 확정 8메뉴(2026-07-29).
//
//   개요 · 고객사 관리 · 결제·매출 · 접근 기록 · 지원 문의 · 운영 분석 · 시스템 · 어드민 관리
//
// ⚠ 분석 메뉴 이름은 **"운영 분석"** 으로 확정됐다. 다른 이름(지표/애널리틱스/인사이트 등)을
//   짓지 않는다. 라벨과 경로(/platform/analytics)를 임의로 바꾸지 말 것.

export type PlatformNavItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** 아직 소유 트랙이 저장소를 만들지 않은 화면 — '준비 중'으로 표시한다. */
  pending?: boolean;
};

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  { key: "overview", label: "개요", href: "/platform", icon: "◫" },
  { key: "orgs", label: "고객사 관리", href: "/platform/orgs", icon: "🏢" },
  { key: "billing", label: "결제·매출", href: "/platform/billing", icon: "₩" },
  { key: "access", label: "접근 기록", href: "/platform/access", icon: "🔑", pending: true },
  { key: "support", label: "지원 문의", href: "/platform/support", icon: "💬", pending: true },
  { key: "analytics", label: "운영 분석", href: "/platform/analytics", icon: "📈" },
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
