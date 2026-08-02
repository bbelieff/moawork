import type { PlatformSectionKey } from "@/lib/platform/contracts";

export type PlatformNavItem = {
  key: PlatformSectionKey;
  href: string;
  label: string;
  description: string;
  group: "observe" | "operate" | "sandbox";
};

export const PLATFORM_NAV: readonly PlatformNavItem[] = [
  { key: "overview", href: "/platform", label: "개요", description: "운영 상태", group: "observe" },
  { key: "organizations", href: "/platform/organizations", label: "고객사 관리", description: "승인·회사 현황", group: "observe" },
  { key: "billing", href: "/platform/billing", label: "결제·매출", description: "집계 준비 상태", group: "observe" },
  { key: "analytics", href: "/platform/analytics", label: "운영 분석", description: "집계 지표", group: "observe" },
  { key: "access", href: "/platform/access", label: "접근 기록", description: "감사 정보", group: "operate" },
  { key: "support", href: "/platform/support", label: "지원", description: "읽기 전용 지원", group: "operate" },
  { key: "system", href: "/platform/system", label: "시스템", description: "연결 상태", group: "operate" },
  { key: "admins", href: "/platform/admins", label: "어드민 관리", description: "권한은 별도 계약", group: "operate" },
  { key: "demo", href: "/platform/demo", label: "데모 워크스페이스", description: "Canary 검토 환경", group: "sandbox" },
];

export const PLATFORM_NAV_GROUPS = [
  { key: "observe", label: "현황" },
  { key: "operate", label: "운영" },
  { key: "sandbox", label: "검토 환경" },
] as const;

export function activePlatformSection(pathname: string): PlatformSectionKey {
  const match = PLATFORM_NAV.find((item) => (
    (item.href !== "/platform" && pathname.startsWith(`${item.href}/`)) || item.href === pathname
  ));
  return match?.key ?? "overview";
}
