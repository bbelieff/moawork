import { FEATURES, type FeatureKey } from "@/lib/product";
import type { IconName } from "./icons";

// 사이드바 IA — belie 확정 11메뉴(2026-07-21), UI목업_워크스페이스_최종_v6 기준.
// 순서·라벨은 목업과 1:1. 변경은 기획 확정 후에만.
// 아이콘은 BBE-126(2026-08-10)에서 이모지 → SVG 심볼(D43)로 교체. 매핑은 목업 T.* 의 icon 키와 동일.
//
// href 가 없는 항목은 담당 트랙이 아직 화면을 만들지 않은 것 —
// T03(셸)은 자리만 잡고 링크하지 않는다(타 트랙 화면 침범 금지).
// feature 가 있으면 엔타이틀먼트 OFF 일 때 자물쇠로 표시한다.

export type NavItem = {
  key: string;
  label: string;
  /** SVG 심볼 이름 — components/shell/icons.tsx 참조. */
  icon: IconName;
  /** 라우트가 있으면 링크, 없으면 비활성(준비 중). */
  href?: string;
  /** 이 메뉴가 요구하는 기능키. 미보유 시 자물쇠. */
  feature?: FeatureKey;
  /** 담당 트랙(주석용) */
  owner?: string;
  /** 서버가 검증한 배지 값만 연결하는 소비자 키. */
  badgeKey?: NavBadgeKey;
};

export type NavBadgeKey = "workspaceApprovals";

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dash", label: "대시보드", icon: "grid", href: "/", feature: FEATURES.dash, owner: "T04" },
  { key: "new", label: "신규업체", icon: "new", href: "/newcust", feature: FEATURES.crm, owner: "BBE-26" },
  { key: "contact", label: "컨택업체", icon: "contact", feature: FEATURES.crm, owner: "T02" },
  { key: "work", label: "업무관리", icon: "work", href: "/policyfund", feature: FEATURES.policyfund, owner: "T09" },
  { key: "company", label: "업체관리", icon: "company", feature: FEATURES.crm, owner: "T02" },
  { key: "notice", label: "공지사항", icon: "notice", owner: "미배정" },
  { key: "members", label: "멤버관리", icon: "org", href: "/settings/members", feature: FEATURES.org, owner: "T03", badgeKey: "workspaceApprovals" },
  { key: "vendor", label: "거래처등록", icon: "vendor", feature: FEATURES.crm, owner: "T02" },
  { key: "topco", label: "이달의 계약회사", icon: "topco", feature: FEATURES.dash, owner: "T04/B5" },
  { key: "acct", label: "회계", icon: "acct", owner: "T09" },
  // Phase 2 벤더 모듈 — MVP 엔타이틀먼트 OFF 라 기본 자물쇠.
  { key: "addons", label: "추가서비스", icon: "addons", feature: FEATURES.notify, owner: "T06/T08" },
] as const;
