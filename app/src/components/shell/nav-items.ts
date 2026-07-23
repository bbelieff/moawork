import { FEATURES, type FeatureKey } from "@/lib/product";

// 사이드바 IA — belie 확정 11메뉴(2026-07-21), UI목업_모아워크셸_v0.3 기준.
// 순서·라벨·아이콘은 목업과 1:1. 변경은 기획 확정 후에만.
//
// href 가 없는 항목은 담당 트랙이 아직 화면을 만들지 않은 것 —
// T03(셸)은 자리만 잡고 링크하지 않는다(타 트랙 화면 침범 금지).
// feature 가 있으면 엔타이틀먼트 OFF 일 때 자물쇠로 표시한다.

export type NavItem = {
  key: string;
  label: string;
  /** 목업의 이모지 글리프 — 아이콘 세트 도입 전까지 사용. */
  icon: string;
  /** 라우트가 있으면 링크, 없으면 비활성(준비 중). */
  href?: string;
  /** 이 메뉴가 요구하는 기능키. 미보유 시 자물쇠. */
  feature?: FeatureKey;
  /** 담당 트랙(주석용) */
  owner?: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dash", label: "대시보드", icon: "◫", href: "/", feature: FEATURES.dash, owner: "T04" },
  { key: "new", label: "신규업체", icon: "🔥", href: "/newcust", feature: FEATURES.crm, owner: "T02" },
  { key: "contact", label: "컨택업체", icon: "📞", feature: FEATURES.crm, owner: "T02" },
  { key: "work", label: "업무관리", icon: "🛠", href: "/policyfund", feature: FEATURES.policyfund, owner: "T09" },
  { key: "company", label: "업체관리", icon: "🏢", feature: FEATURES.crm, owner: "T02" },
  { key: "notice", label: "공지사항", icon: "📋", owner: "미배정" },
  { key: "members", label: "멤버관리", icon: "👥", href: "/settings/members", feature: FEATURES.org, owner: "T03" },
  { key: "vendor", label: "거래처등록", icon: "➕", feature: FEATURES.crm, owner: "T02" },
  { key: "topco", label: "이달의 계약회사", icon: "🏆", feature: FEATURES.dash, owner: "T04/B5" },
  { key: "acct", label: "회계", icon: "₩", owner: "T09" },
  // Phase 2 벤더 모듈 — MVP 엔타이틀먼트 OFF 라 기본 자물쇠.
  { key: "addons", label: "추가서비스", icon: "🧩", feature: FEATURES.notify, owner: "T06/T08" },
] as const;
