import type { PlatformSectionKey } from "@/lib/platform/contracts";

export type PlatformNavItem = {
  key: PlatformSectionKey;
  href: string;
  label: string;
  description: string;
};

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  { key: "overview", href: "/platform", label: "개요", description: "운영 상태" },
  { key: "organizations", href: "/platform/organizations", label: "조직", description: "조직 메타데이터" },
  { key: "billing", href: "/platform/billing", label: "결제·매출", description: "집계 준비 상태" },
  { key: "access", href: "/platform/access", label: "접근 기록", description: "감사 정보" },
  { key: "support", href: "/platform/support", label: "지원", description: "읽기 전용 지원" },
  { key: "analytics", href: "/platform/analytics", label: "운영 분석", description: "집계 지표" },
  { key: "system", href: "/platform/system", label: "시스템", description: "연결 상태" },
  { key: "admins", href: "/platform/admins", label: "어드민 관리", description: "권한은 별도 계약" },
];

export function activePlatformSection(pathname: string): PlatformSectionKey {
  const match = PLATFORM_NAV.find((item) => (
    (item.href !== "/platform" && pathname.startsWith(`${item.href}/`)) || item.href === pathname
  ));
  return match?.key ?? "overview";
}
