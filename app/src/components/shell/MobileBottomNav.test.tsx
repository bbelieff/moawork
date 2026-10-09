// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileBottomNav, type MobileBottomNavProps } from "./MobileBottomNav";
import { SidebarNav } from "./SidebarNav";
import { GlobalSearch } from "./GlobalSearch";
import type { SidebarUserTab } from "./user-tabs";

// 2026-10-09 휴대폰 아래 메뉴. ★ 되돌리면 빨개지는 것:
//   - 다섯 칸 외의 칸을 더하거나 빼면 → 첫 검사
//   - 활성 판정을 사이드바와 다른 식으로 바꾸면 → 활성 검사
//   - 사이드바에 메뉴가 생겼는데 아래 메뉴·시트 어디에도 없으면 → 목적지 집합 검사
//   - 「찾기」 가 통합 검색을 못 열면 → 검색 검사

let pathname = "/w/sample-lab";
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));
// 「새 탭」 줄은 서버 액션을 끌고 온다 — 목적지가 아니라 만들기 동작이라 여기서는 자리만.
vi.mock("./SidebarNewTab", () => ({ SidebarNewTab: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "/w/sample-lab";
let root: Root | null = null;

afterEach(async () => {
  pathname = BASE;
  search = "";
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "visualViewport");
});

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const nextFrame = () => act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

const USER_TABS: SidebarUserTab[] = [
  { id: "t-1", name: "영업 파이프라인", icon: null, navSection: "before-contract" },
  { id: "t-2", name: "사후 관리", icon: null, navSection: "after-contract" },
];
const BOARD_NAV_KEYS = { "b-new": "new", "b-work": "work", "b-contact": "contact", "t-1": "board:t-1", "t-2": "board:t-2" };

function props(extra: Partial<MobileBottomNavProps> = {}): MobileBottomNavProps {
  return { lockedFeatures: [], workspaceBasePath: BASE, boardNavKeys: BOARD_NAV_KEYS, userTabs: USER_TABS, ...extra };
}

function bottomNav() {
  return document.querySelector<HTMLElement>('nav[aria-label="아래 메뉴"]')!;
}
function tab(key: string) {
  return bottomNav().querySelector<HTMLElement>(`[data-bottom-tab="${key}"]`)!;
}
function activeTabs() {
  return [...bottomNav().querySelectorAll<HTMLElement>("[aria-current=\"page\"]")].map((element) => element.dataset.bottomTab);
}
async function openSheet(key: "work" | "more") {
  await act(async () => tab(key).click());
  await nextFrame();
  return document.querySelector<HTMLElement>(`[data-bottom-nav-sheet="${key}"]`)!;
}
/** key → href(갈 수 없는 «준비 중» 은 null). */
function destinations(scope: ParentNode) {
  return new Map([...scope.querySelectorAll<HTMLElement>("[data-nav-key]")].map((element) => [
    element.dataset.navKey!,
    element.getAttribute("href"),
  ]));
}

describe("휴대폰 아래 메뉴", () => {
  it("md 미만 전용 nav 에 홈·알림·업무·찾기·더보기 다섯 칸만 그린다", async () => {
    await render(<MobileBottomNav {...props()} />);
    const nav = bottomNav();
    expect(nav.classList).toContain("md:hidden");
    expect(nav.classList).toContain("mw-bottom-nav");
    const items = [...nav.querySelectorAll("li")];
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.textContent?.trim())).toEqual(["홈", "알림", "업무", "찾기", "더보기"]);
    expect(tab("home").getAttribute("href")).toBe(BASE);
    expect(tab("alerts").getAttribute("href")).toBe(`${BASE}/settings/notifications`);
  });

  it.each([
    [BASE, "", "home"],
    [`${BASE}/settings/notifications`, "", "alerts"],
    [`${BASE}/boards/b-work`, "", "work"],
    [`${BASE}/boards/t-1`, "", "work"],
    [`${BASE}/boards/b-contact`, "consultation=inperson", "work"],
    [`${BASE}/settings/members`, "", "more"],
    [`${BASE}/policyfund/news`, "", "more"],
    [`${BASE}/account`, "", "more"],
  ])("%s?%s 에서는 %s 칸 하나만 켠다", async (path, query, expected) => {
    pathname = path;
    search = query;
    await render(<MobileBottomNav {...props()} />);
    expect(activeTabs()).toEqual([expected]);
  });

  it("어느 메뉴에도 속하지 않는 주소에서는 아무 칸도 켜지 않는다", async () => {
    pathname = `${BASE}/somewhere-else`;
    await render(<MobileBottomNav {...props()} />);
    expect(activeTabs()).toEqual([]);
  });

  it("누른 칸을 다음 화면이 오기 전에 바로 켠다", async () => {
    pathname = `${BASE}/settings/members`;
    await render(<MobileBottomNav {...props()} />);
    await act(async () => tab("home").click());
    expect(activeTabs()).toEqual(["home"]);
  });

  it("업무 시트는 사이드바 업무 묶음과 같은 탭을 같은 순서·같은 주소로 보여 준다", async () => {
    const dismissed = ["core.default-tab/notice"];
    await render(
      <>
        <SidebarNav {...props({ dismissedSources: dismissed })} />
        <MobileBottomNav {...props({ dismissedSources: dismissed })} />
      </>,
    );
    const sidebar = document.querySelector<HTMLElement>('nav[aria-label="주요 메뉴"]')!;
    const sidebarWork = [
      ...sidebar.querySelectorAll<HTMLElement>('section[aria-labelledby^="sidebar-"] [data-nav-key], details[data-nav-section="coming-soon"] [data-nav-key]'),
    ].map((element) => [element.dataset.navKey, element.getAttribute("href")]);
    const sheet = await openSheet("work");
    const sheetWork = [...sheet.querySelectorAll<HTMLElement>("[data-nav-key]")]
      .map((element) => [element.dataset.navKey, element.getAttribute("href")]);
    expect(sheetWork).toEqual(sidebarWork);
    // 사용자 탭과 직행 주소(경유지 없이 보드로)도 그대로다.
    expect(sheetWork).toContainEqual(["board:t-1", `${BASE}/boards/t-1`]);
    expect(sheetWork).toContainEqual(["new", `${BASE}/boards/b-new`]);
    expect([...sheet.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual(["계약 전", "계약 후"]);
  });

  it.each([
    ["기본", {}],
    ["지운 기본 탭·잠긴 기능·사용자 탭 없음", { dismissedSources: ["core.default-tab/notice", "core.default-tab/contact"], lockedFeatures: ["core.crm", "core.org"], userTabs: [] }],
  ])("★ 사이드바의 모든 목적지가 아래 메뉴 ∪ 업무 시트 ∪ 더보기 시트에 있다 (%s)", async (_label, extra) => {
    const shared = props(extra as Partial<MobileBottomNavProps>);
    await render(
      <>
        <SidebarNav {...shared} />
        <MobileBottomNav {...shared} />
      </>,
    );
    const sidebar = destinations(document.querySelector('nav[aria-label="주요 메뉴"]')!);
    expect(sidebar.size).toBeGreaterThan(10);

    const phone = new Map<string, string | null>([
      ["dash", tab("home").getAttribute("href")],
      ["notifications", tab("alerts").getAttribute("href")],
    ]);
    const work = await openSheet("work");
    for (const [key, href] of destinations(work)) phone.set(key, href);
    await act(async () => work.querySelector<HTMLButtonElement>('button[aria-label="업무 닫기"]')!.click());
    const more = await openSheet("more");
    for (const [key, href] of destinations(more)) phone.set(key, href);

    expect([...phone.keys()].sort()).toEqual([...sidebar.keys()].sort());
    for (const [key, href] of sidebar) expect(phone.get(key), key).toBe(href);
  });

  it("더보기 시트에 업무도구·설정·내 프로필·온보딩이 있고 홈·알림은 다시 넣지 않는다", async () => {
    await render(<MobileBottomNav {...props()} />);
    const more = await openSheet("more");
    const keys = [...destinations(more).keys()];
    expect(keys).toEqual(expect.arrayContaining(["policy-news", "members", "preset", "workspace-settings", "profile", "onboard", "tabs", "auto", "notice"]));
    expect(keys).not.toContain("dash");
    expect(keys).not.toContain("notifications");
  });

  it("「찾기」 는 상단바에 있는 그 통합 검색을 연다", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await render(
      <>
        <GlobalSearch />
        <MobileBottomNav {...props()} />
      </>,
    );
    expect(document.querySelector('[role="dialog"][aria-label="통합 검색"]')).toBeNull();
    await act(async () => tab("search").click());
    expect(document.querySelector('[role="dialog"][aria-label="통합 검색"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("알림 칸에 사이드바와 같은 안 읽은 수를 보인다", async () => {
    await render(<MobileBottomNav {...props({ notifyBadges: { notifications: { kind: "count", count: 3, display: "3" } } })} />);
    expect(tab("alerts").querySelector('[aria-label="알림 할 일 3건"]')?.textContent).toBe("3");
  });

  it("승인 대기는 더보기 칸의 점과 시트 안 조직관리 숫자로 보인다", async () => {
    await render(<MobileBottomNav {...props({ badges: { workspaceApprovals: 4 } })} />);
    expect(tab("more").querySelector("[data-bottom-tab-dot]")).not.toBeNull();
    expect(tab("work").querySelector("[data-bottom-tab-dot]")).toBeNull();
    const more = await openSheet("more");
    expect(more.querySelector('[data-nav-key="members"] [aria-label="승인 대기 4건"]')?.textContent).toBe("4");
  });

  it("시트는 이름 붙은 aria-modal 대화상자이고, 초점을 안에 두고, Esc 로 닫으면 누른 칸으로 초점을 돌려준다", async () => {
    await render(<MobileBottomNav {...props()} />);
    const trigger = tab("work");
    trigger.focus();
    const sheet = await openSheet("work");
    const dialog = sheet.closest<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("업무");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await nextFrame();
    expect(document.querySelector("[data-bottom-nav-sheet]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("시트에서 탭을 고르면 시트를 닫고 그 칸(업무)을 바로 켠다", async () => {
    pathname = `${BASE}/settings/members`;
    await render(<MobileBottomNav {...props()} />);
    const sheet = await openSheet("work");
    await act(async () => sheet.querySelector<HTMLElement>('[data-nav-key="board:t-2"]')!.click());
    expect(document.querySelector("[data-bottom-nav-sheet]")).toBeNull();
    expect(activeTabs()).toEqual(["work"]);
  });

  it("준비 중 메뉴는 시트에서도 눌리지 않는 줄로 남는다", async () => {
    await render(<MobileBottomNav {...props()} />);
    const sheet = await openSheet("work");
    const vendor = sheet.querySelector<HTMLElement>('[data-nav-key="vendor"]')!;
    expect(vendor.tagName).toBe("SPAN");
    expect(vendor.getAttribute("aria-disabled")).toBe("true");
    expect(sheet.querySelector('details[data-bottom-sheet-section="coming-soon"]')?.hasAttribute("open")).toBe(false);
  });

  it("화면 키보드가 올라오면 메뉴를 숨긴다", async () => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    await render(<MobileBottomNav {...props()} />);
    expect(bottomNav().hasAttribute("data-keyboard-open")).toBe(false);
    await act(async () => {
      viewport.height = window.innerHeight - 300;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(bottomNav().hasAttribute("data-keyboard-open")).toBe(true);
    await act(async () => {
      viewport.height = window.innerHeight;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(bottomNav().hasAttribute("data-keyboard-open")).toBe(false);
  });
});
