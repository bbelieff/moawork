import type { BoardNavSection } from "@/lib/boards/types";
import { resolveBoardIconKey } from "@/lib/boards/board-icons";
import { TAB_SOURCE_NAV_KEY } from "./active-nav";
import { navItemsForSection, type NavItem, type NavSection } from "./nav-items";

/**
 * #849 — 사이드바의 «사용자 탭» 과 «지운 기본 탭» 을 다루는 순수 모듈.
 *
 * 사이드바(클라이언트 부품)와 셸 로더(서버)가 같이 읽으므로 서버 전용 모듈을 import 하지 않는다
 * (`active-nav.ts` 머리 주석과 같은 이유 — `@/lib/default-tabs` 배럴은 supabase/server 까지 끌고 온다).
 */

/**
 * 사용자 탭의 메뉴 키 접두어. 보드 id → 메뉴 키 지도(`boardNavKeys`)에 «board:<id>» 로 들어가서
 * 그 보드 화면에 있으면 사이드바의 그 줄 하나만 켜진다. 기본 메뉴 키(new·work …)와 겹치지 않는다.
 */
export const USER_TAB_NAV_KEY_PREFIX = "board:";

export function userTabNavKey(boardId: string): string {
  return `${USER_TAB_NAV_KEY_PREFIX}${boardId}`;
}

/** 사이드바가 받는 사용자 탭 한 줄. 서버 로더가 정렬(sort_order)까지 끝내서 넘긴다. */
export type SidebarUserTab = {
  id: string;
  name: string;
  /**
   * 보드에 저장된 아이콘 값. 머리말과 같은 규칙(resolveBoardIconKey)으로 그린다 — 고른 키는 그 그림,
   * 옛 이모지는 뜻이 같은 그림, 비었으면 문서 아이콘(#849 L01 · #845 2026-10-08).
   */
  icon: string | null;
  /** 업무 › 계약 전/계약 후. 값이 없던 탭은 로더가 계약 후로 맞춘다. */
  navSection: BoardNavSection;
};

/**
 * 같은 정본 보드를 보는 메뉴 묶음. 리드컨택 보드 하나를 상담 단계 보기 두 개가 같이 쓴다 —
 * 그 탭을 지우면 셋 다 갈 곳이 없으므로 같이 숨긴다.
 */
const SAME_BOARD_NAV_KEYS: Readonly<Record<string, readonly string[]>> = {
  contact: ["contact", "consult-remote", "consult-inperson"],
};

/** 지운 기본 탭의 source → 숨길 기본 메뉴 키. 모르는 source 는 아무것도 숨기지 않는다. */
export function hiddenNavKeysFor(dismissedSources?: readonly string[]): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const source of dismissedSources ?? []) {
    const navKey = Object.hasOwn(TAB_SOURCE_NAV_KEY, source) ? TAB_SOURCE_NAV_KEY[source] : undefined;
    if (!navKey) continue;
    for (const key of SAME_BOARD_NAV_KEYS[navKey] ?? [navKey]) hidden.add(key);
  }
  return hidden;
}

/** 회사가 지운 기본 탭의 메뉴를 뺀다 — 눌러도 «없는 탭» 안내만 나오는 줄을 남기지 않는다. */
export function withoutDismissedDefaults(
  items: readonly NavItem[],
  dismissedSources?: readonly string[],
): readonly NavItem[] {
  if (!dismissedSources?.length) return items;
  const hidden = hiddenNavKeysFor(dismissedSources);
  return hidden.size ? items.filter((item) => !hidden.has(item.key)) : items;
}

/**
 * 탭 자리(DB 값 boards.nav_section) → 사이드바 업무 소분류 key.
 * 두 상수(BOARD_NAV_SECTIONS · NAV_SECTIONS)는 서로 모르는 곳에 있다 — 같은 글자라고 기대지 않고 여기서 잇는다.
 */
export const USER_TAB_SECTION_KEY: Readonly<Record<BoardNavSection, string>> = {
  "before-contract": "before-contract",
  "after-contract": "after-contract",
};
/** 자리를 못 찾은 탭이 들어갈 곳 — 값이 없던 탭과 같은 «계약 후». */
const FALLBACK_SECTION_KEY = USER_TAB_SECTION_KEY["after-contract"];

function userTabNavItem(tab: SidebarUserTab): NavItem {
  return {
    key: userTabNavKey(tab.id),
    label: tab.name,
    icon: "folder",
    // 머리말과 같은 그림 — 사용자 탭은 출처(source)가 없으므로 저장값만으로 정한다(없으면 문서).
    tabIcon: resolveBoardIconKey(tab.icon),
    href: `/boards/${encodeURIComponent(tab.id)}`,
  };
}

/**
 * 업무 소분류(계약 전/계약 후)마다 그 끝에 붙일 사용자 탭을 «보통 메뉴 줄» 모양으로 나눈다(받은 순서 유지).
 * 같은 renderItem 으로 그리므로 높이·여백·모서리·글자·활성 색이 다른 줄과 같다.
 *
 * ★ 탭은 절대 빠지지 않는다 — 자리가 그려지는 소분류에 없으면(소분류 key 가 바뀌었거나 모르는 값)
 *   계약 후, 그것도 없으면 마지막 소분류 끝에 둔다. 사이드바에서 사라진 탭은 다시 찾을 길이 없다.
 */
export function userTabNavItemsBySection(
  userTabs: readonly SidebarUserTab[] | undefined,
  sectionKeys: readonly string[],
): ReadonlyMap<string, NavItem[]> {
  const bySection = new Map<string, NavItem[]>(sectionKeys.map((key) => [key, []]));
  if (sectionKeys.length === 0) return bySection;
  const fallback = bySection.has(FALLBACK_SECTION_KEY) ? FALLBACK_SECTION_KEY : sectionKeys[sectionKeys.length - 1];
  for (const tab of userTabs ?? []) {
    const wanted = Object.hasOwn(USER_TAB_SECTION_KEY, tab.navSection) ? USER_TAB_SECTION_KEY[tab.navSection] : undefined;
    bySection.get(wanted && bySection.has(wanted) ? wanted : fallback)!.push(userTabNavItem(tab));
  }
  return bySection;
}

/**
 * 사이드바 업무 묶음의 소분류별 줄 — 기본 메뉴(지운 기본 탭은 뺀다) 뒤에 그 소분류의 사용자 탭.
 * 줄이 하나도 없는 소분류는 빼고 돌려준다 — 제목(계약 전/계약 후)만 남은 빈 구역을 그리지 않게
 * (눈에는 고아 제목, 화면낭독기에는 빈 이름표 구역이 된다).
 */
export function workNavSections(
  sections: readonly NavSection[],
  userTabs: readonly SidebarUserTab[] | undefined,
  dismissedSources: readonly string[] | undefined,
): Array<{ section: NavSection; items: readonly NavItem[] }> {
  const userTabItems = userTabNavItemsBySection(userTabs, sections.map((section) => section.key));
  return sections
    .map((section) => ({
      section,
      items: [
        ...withoutDismissedDefaults(navItemsForSection(section), dismissedSources),
        ...(userTabItems.get(section.key) ?? []),
      ],
    }))
    .filter(({ items }) => items.length > 0);
}
