import { FEATURES, type FeatureKey } from "@/lib/product";
import type { IconName } from "./icons";

// 사이드바 IA — UI목업_워크스페이스_최종_v6 D05·D06 기준.
// NAV_ITEMS 는 주소·기능·표시 이름의 단일 정본이고, NAV_SECTIONS 는 그 항목을 계층화한다.
// 표시 이름을 바꾸더라도 href 는 canonical 주소로 유지해 저장 링크·자동화·프리셋을 보호한다.
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

/** 업무도구의 실제 목적지가 정해지면 이 목록에 추가한다. */
export const WORK_TOOL_ITEMS: readonly NavItem[] = [
  { key: "policy-news", label: "정책자금뉴스", icon: "news", href: "/policyfund/news" },
];

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dash", label: "대시보드", icon: "grid", href: "/", feature: FEATURES.dash, owner: "T04" },
  { key: "notifications", label: "알림", icon: "notice", href: "/settings/notifications", owner: "T06" },
  { key: "notice", label: "공지사항", icon: "notice", href: "/notices", owner: "미배정" },
  { key: "new", label: "신규리드 관리", icon: "new", href: "/newcust", feature: FEATURES.crm, owner: "BBE-26" },
  { key: "contact", label: "리드컨택 관리", icon: "contact", href: "/contract", feature: FEATURES.crm, owner: "T02" },
  // 상담 STEP 탭 — 같은 리드컨택 정본 보드의 단계 보기다(STEP1=신규리드 관리·STEP2=비대면·STEP3=대면).
  // 행을 복제하지 않고 /consult-remote·/consult-inperson 경유지에서 같은 보드의
  // ?consultation=remote|inperson 보기로 보낸다. 기존 /contract 주소는 그대로 둔다.
  { key: "consult-remote", label: "비대면 상담", icon: "contact", href: "/consult-remote", feature: FEATURES.crm, owner: "T02" },
  { key: "consult-inperson", label: "대면 상담", icon: "contact", href: "/consult-inperson", feature: FEATURES.crm, owner: "T02" },
  { key: "work", label: "계약업체 실무", icon: "work", href: "/work", feature: FEATURES.policyfund, owner: "T09" },
  { key: "company", label: "업체관리 현황", icon: "company", href: "/companies", feature: FEATURES.crm, owner: "T02" },
  { key: "vendor", label: "거래처등록", icon: "vendor", feature: FEATURES.crm, owner: "T02" },
  { key: "topco", label: "이달의 계약회사", href: "/dash/top-companies", icon: "topco", feature: FEATURES.dash, owner: "T04/B5" },
  // BBE-240: 연도별 전체 원장 실화면 배선 — "준비 중"에서 "계약 후"로 이동.
  { key: "acct", label: "회계", icon: "acct", href: "/ledger", feature: FEATURES.policyfund, owner: "T09" },
  // Phase 2 벤더 모듈 — MVP 엔타이틀먼트 OFF 라 기본 자물쇠.
  { key: "addons", label: "추가서비스", icon: "addons", feature: FEATURES.notify, owner: "T06/T08" },
  { key: "tabs", label: "탭 관리", icon: "grid", href: "/settings/workspace-builder", feature: FEATURES.org, owner: "BBE-126" },
  { key: "auto", label: "자동화", icon: "work", href: "/settings/automations", feature: FEATURES.policyfund, owner: "T06" },
  { key: "members", label: "조직관리", icon: "org", href: "/settings/members", feature: FEATURES.org, owner: "T03", badgeKey: "workspaceApprovals" },
  { key: "preset", label: "프리셋", icon: "preset", href: "/presets", owner: "BBE-142" },
  { key: "workspace-settings", label: "내 회사 관리", icon: "company", href: "/settings/account#workspace" },
  { key: "profile", label: "내 프로필", icon: "org", href: "/account", owner: "T03" },
  { key: "onboard", label: "온보딩", icon: "new", href: "/onboarding", owner: "BBE-112" },
] as const;

export type NavSection = {
  key: string;
  label: string;
  items: readonly NavItem["key"][];
  /** 업무 아래 소분류는 들여써 큰 갈래와 구분한다. */
  nested?: boolean;
  /** 준비 중 묶음만 기본 접힘이며 사용자가 펼칠 수 있다. */
  collapsible?: boolean;
};

/** 목업 D05: 종합 / 업무(계약 전·계약 후·준비 중) / 설정. */
export const NAV_SECTIONS: readonly NavSection[] = [
  { key: "overview", label: "종합", items: ["dash", "notifications", "notice"] },
  // v17: 화면에는 세 단계만 노출한다. contact의 주소와 정본 보드는 기존 링크용으로 보존한다.
  { key: "before-contract", label: "계약 전", items: ["new", "consult-remote", "consult-inperson"], nested: true },
  { key: "after-contract", label: "계약 후", items: ["work", "company", "acct", "topco"], nested: true },
  {
    key: "coming-soon",
    label: "준비 중",
    items: ["vendor", "addons"],
    nested: true,
    collapsible: true,
  },
  { key: "settings", label: "설정", items: ["tabs", "auto", "members", "preset", "workspace-settings", "profile", "onboard"] },
] as const;

const NAV_ITEM_BY_KEY = new Map(NAV_ITEMS.map((item) => [item.key, item]));

export function navItemsForSection(section: NavSection): readonly NavItem[] {
  return section.items.map((key) => {
    const item = NAV_ITEM_BY_KEY.get(key);
    if (!item) throw new Error(`사이드바 항목을 찾을 수 없습니다: ${key}`);
    return item;
  });
}
