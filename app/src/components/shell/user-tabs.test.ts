import { describe, expect, it } from "vitest";
import {
  CONTACT_TAB_SOURCE,
  CONTRACT_WORK_TAB_SOURCE,
  NEW_LEAD_TAB_SOURCE,
  NOTICE_TAB_SOURCE,
} from "@/lib/default-tabs";
import { BOARD_NAV_SECTIONS } from "@/lib/boards/types";
import { resolveRouteAccent } from "@/lib/appearance/vivid";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav-items";
import {
  hiddenNavKeysFor,
  USER_TAB_SECTION_KEY,
  userTabNavItemsBySection,
  userTabNavKey,
  withoutDismissedDefaults,
  workNavSections,
  type SidebarUserTab,
} from "./user-tabs";

const TABS: SidebarUserTab[] = [
  { id: "t-before", name: "리드 접수", icon: null, navSection: "before-contract" },
  { id: "t-after-1", name: "영업 파이프라인", icon: "📋", navSection: "after-contract" },
  { id: "t-after-2", name: "계약 진행", icon: null, navSection: "after-contract" },
];

describe("#849 지운 기본 탭 → 숨길 메뉴", () => {
  it("네 기본 탭 source 가 정본 상수와 같은 메뉴를 숨긴다(상수가 바뀌면 여기서 먼저 빨개진다)", () => {
    expect([...hiddenNavKeysFor([NEW_LEAD_TAB_SOURCE])]).toEqual(["new"]);
    // 리드컨택 정본 보드 하나를 상담 단계 보기 둘이 같이 쓴다 — 셋 다 갈 곳이 없어진다.
    expect([...hiddenNavKeysFor([CONTACT_TAB_SOURCE])].sort()).toEqual(["consult-inperson", "consult-remote", "contact"]);
    expect([...hiddenNavKeysFor([CONTRACT_WORK_TAB_SOURCE])]).toEqual(["work"]);
    expect([...hiddenNavKeysFor([NOTICE_TAB_SOURCE])]).toEqual(["notice"]);
  });

  it("모르는 source·빈 목록은 아무것도 숨기지 않는다", () => {
    expect(hiddenNavKeysFor(["core.default-tab/unknown", "constructor", "trash/x/core.default-tab/notice"]).size).toBe(0);
    expect(hiddenNavKeysFor(undefined).size).toBe(0);
    expect(withoutDismissedDefaults(NAV_ITEMS, [])).toBe(NAV_ITEMS);
  });

  it("메뉴 목록에서 해당 줄만 뺀다 — 순서는 그대로", () => {
    const keys = withoutDismissedDefaults(NAV_ITEMS, [NOTICE_TAB_SOURCE, CONTRACT_WORK_TAB_SOURCE]).map((item) => item.key);
    expect(keys).not.toContain("notice");
    expect(keys).not.toContain("work");
    expect(keys).toEqual(NAV_ITEMS.map((item) => item.key).filter((key) => key !== "notice" && key !== "work"));
  });
});

describe("#849 사용자 탭 → 메뉴 줄", () => {
  const WORK_SECTIONS = NAV_SECTIONS.slice(1, 3);
  const WORK_KEYS = WORK_SECTIONS.map((section) => section.key);

  it("★ 탭 자리(DB 값)마다 사이드바 업무 소분류가 실제로 있다 — 소분류 key 가 바뀌면 여기서 먼저 빨개진다", () => {
    const nestedKeys = NAV_SECTIONS.filter((section) => section.nested && !section.collapsible).map((section) => section.key);
    for (const place of BOARD_NAV_SECTIONS) expect(nestedKeys).toContain(USER_TAB_SECTION_KEY[place]);
    expect(WORK_KEYS).toEqual(BOARD_NAV_SECTIONS.map((place) => USER_TAB_SECTION_KEY[place]));
  });

  it("고른 소분류의 탭만, 받은 순서대로, 폴더 아이콘의 보드 링크로 만든다", () => {
    const bySection = userTabNavItemsBySection(TABS, WORK_KEYS);
    expect(bySection.get("after-contract")).toEqual([
      { key: "board:t-after-1", label: "영업 파이프라인", icon: "folder", href: "/boards/t-after-1" },
      { key: "board:t-after-2", label: "계약 진행", icon: "folder", href: "/boards/t-after-2" },
    ]);
    expect(bySection.get("before-contract")!.map((item) => item.key)).toEqual(["board:t-before"]);
    expect(userTabNavItemsBySection(undefined, WORK_KEYS).get("after-contract")).toEqual([]);
  });

  it("★ 탭은 절대 빠지지 않는다 — 소분류 key 가 바뀌었거나 모르는 자리 값이면 계약 후(없으면 마지막 소분류) 끝에", () => {
    const odd: SidebarUserTab = { id: "t-odd", name: "자리 모름", icon: null, navSection: "sidebar-top" as never };
    expect(userTabNavItemsBySection([odd], WORK_KEYS).get("after-contract")!.map((item) => item.key)).toEqual(["board:t-odd"]);
    // 소분류 key 가 «pre»/«post» 로 바뀐 세계 — 모든 탭이 마지막 소분류로 모인다.
    const renamed = userTabNavItemsBySection(TABS, ["pre", "post"]);
    expect(renamed.get("pre")).toEqual([]);
    expect(renamed.get("post")!.map((item) => item.key)).toEqual(["board:t-before", "board:t-after-1", "board:t-after-2"]);
    expect(userTabNavItemsBySection(TABS, []).size).toBe(0);
  });

  it("보드 id 는 주소 조각으로 안전하게 넣는다", () => {
    const [item] = userTabNavItemsBySection([{ id: "a/b?c", name: "x", icon: null, navSection: "after-contract" }], WORK_KEYS)
      .get("after-contract")!;
    expect(item.href).toBe("/boards/a%2Fb%3Fc");
  });

  it("기본 메뉴 키와 겹치지 않는다", () => {
    const defaultKeys = new Set(NAV_ITEMS.map((item) => item.key));
    for (const tab of TABS) expect(defaultKeys.has(userTabNavKey(tab.id))).toBe(false);
  });
});

describe("#849 업무 소분류별 줄", () => {
  const WORK_SECTIONS = NAV_SECTIONS.slice(1, 3);
  const keysOf = (rows: ReturnType<typeof workNavSections>) =>
    rows.map(({ section, items }) => [section.key, items.map((item) => item.key)]);

  it("기본 메뉴 뒤에 그 소분류의 사용자 탭을 붙인다", () => {
    const rows = keysOf(workNavSections(WORK_SECTIONS, TABS, []));
    expect(rows).toEqual([
      ["before-contract", ["new", "consult-remote", "consult-inperson", "board:t-before"]],
      ["after-contract", ["work", "company", "acct", "topco", "board:t-after-1", "board:t-after-2"]],
    ]);
  });

  it("★ 줄이 하나도 안 남은 소분류는 빼서 제목만 남은 빈 구역을 그리지 않는다", () => {
    const afterOnly = TABS.filter((tab) => tab.navSection === "after-contract");
    const rows = keysOf(workNavSections(WORK_SECTIONS, afterOnly, [NEW_LEAD_TAB_SOURCE, CONTACT_TAB_SOURCE]));
    expect(rows.map(([key]) => key)).toEqual(["after-contract"]);
    // 사용자 탭이 하나라도 있으면 기본 메뉴를 다 지워도 남는다.
    expect(keysOf(workNavSections(WORK_SECTIONS, TABS, [NEW_LEAD_TAB_SOURCE, CONTACT_TAB_SOURCE]))[0])
      .toEqual(["before-contract", ["board:t-before"]]);
  });
});

describe("#849 라우트 강조 — 사용자 탭 «board:<id>»", () => {
  // 활성 판정(resolveActiveNavKey·resolveConsultationNavKey)의 «board:<id>» 경우는 active-nav.test.ts 가 잰다.
  it("라우트 강조는 «board:*» 를 모르는 키로 보고 기본(대시보드) 강조로 폴백한다", () => {
    expect(resolveRouteAccent("board:t-1")).toBe("dash");
  });
});
