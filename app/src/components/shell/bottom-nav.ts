import {
  NAV_SECTIONS,
  WORK_TOOL_ITEMS,
  navItemsForSection,
  type NavItem,
  type NavSection,
} from "./nav-items";
import {
  USER_TAB_NAV_KEY_PREFIX,
  withoutDismissedDefaults,
  workNavSections,
  type SidebarUserTab,
} from "./user-tabs";

/**
 * 휴대폰 아래 메뉴(2026-10-09 대표 결정) — 사이드바와 «같은 목적지 목록» 을 다섯 칸과 두 시트로 나눈다.
 *
 * 홈 · 알림 은 바로 가는 링크, 업무 는 계약 전/계약 후 탭 시트, 찾기 는 기존 통합 검색, 더보기 는 나머지 전부.
 * 사이드바 정본(nav-items·user-tabs)에서 목록을 «꺼내 쓰기만» 한다 — 여기서 항목을 새로 적지 않는다.
 * 그래야 사이드바에 메뉴가 생기면 휴대폰에도 같이 생긴다(bottom-nav.test 가 집합을 대조한다).
 */
export type BottomTabKey = "home" | "alerts" | "work" | "search" | "more";

/** 아래 메뉴 바에 직접 걸리는 메뉴 키 — 시트에 다시 넣지 않는다. */
export const BOTTOM_HOME_KEY = "dash";
export const BOTTOM_ALERTS_KEY = "notifications";

function section(key: string): NavSection {
  const found = NAV_SECTIONS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`사이드바 묶음을 찾을 수 없습니다: ${key}`);
  return found;
}

const WORK_SECTION_KEYS = ["before-contract", "after-contract"] as const;
const COMING_SOON_SECTION_KEY = "coming-soon";

/** 업무 탭으로 치는 메뉴 키 — 계약 전·계약 후·준비 중 묶음 + 화면에 없는 옛 리드컨택 키. */
const WORK_NAV_KEYS: ReadonlySet<string> = new Set([
  ...[...WORK_SECTION_KEYS, COMING_SOON_SECTION_KEY].flatMap((key) => section(key).items),
  "contact",
]);

/** 사이드바가 켠 메뉴 키 → 아래 메뉴의 칸. 아무것도 안 켜졌으면 아무 칸도 켜지 않는다. */
export function bottomTabForNavKey(navKey: string | null): BottomTabKey | null {
  if (!navKey) return null;
  if (navKey === BOTTOM_HOME_KEY) return "home";
  if (navKey === BOTTOM_ALERTS_KEY) return "alerts";
  if (navKey.startsWith(USER_TAB_NAV_KEY_PREFIX) || WORK_NAV_KEYS.has(navKey)) return "work";
  return "more";
}

export type BottomSheetSection = { key: string; label: string; items: readonly NavItem[]; collapsed?: boolean };

/** 업무 시트 — 사이드바 «업무» 묶음과 같은 순서·같은 소분류(지운 기본 탭 제외, 사용자 탭은 끝), 준비 중은 접힘. */
export function bottomWorkSheetSections(
  userTabs: readonly SidebarUserTab[] | undefined,
  dismissedSources: readonly string[] | undefined,
): BottomSheetSection[] {
  const comingSoon = section(COMING_SOON_SECTION_KEY);
  return [
    ...workNavSections(WORK_SECTION_KEYS.map(section), userTabs, dismissedSources).map(({ section: work, items }) => ({
      key: work.key,
      label: work.label,
      items,
    })),
    { key: comingSoon.key, label: comingSoon.label, items: navItemsForSection(comingSoon), collapsed: true },
  ];
}

/** 더보기 시트 — 아래 바·업무 시트에 없는 사이드바 목적지 전부(종합의 나머지 · 업무도구 · 설정). */
export function bottomMoreSheetSections(dismissedSources: readonly string[] | undefined): BottomSheetSection[] {
  const overview = section("overview");
  const settings = section("settings");
  return [
    {
      key: overview.key,
      label: overview.label,
      items: withoutDismissedDefaults(navItemsForSection(overview), dismissedSources)
        .filter((item) => item.key !== BOTTOM_HOME_KEY && item.key !== BOTTOM_ALERTS_KEY),
    },
    { key: "work-tools", label: "업무도구", items: WORK_TOOL_ITEMS },
    { key: settings.key, label: settings.label, items: navItemsForSection(settings) },
  ].filter((entry) => entry.items.length > 0);
}
