import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./SidebarNav";
import type { SidebarUserTab } from "./user-tabs";

/**
 * #849 PR2 — 사용자 탭이 사이드바 업무 › 계약 전/계약 후 «맨 끝» 에 보통 메뉴 줄로 들어가고,
 * 지운 기본 탭의 메뉴는 숨으며, 「새 탭」 줄은 탭 관리 권한이 있을 때만 보인다.
 */

const route = vi.hoisted(() => ({ pathname: "/w/sample-lab", search: "" }));
afterEach(() => { route.pathname = "/w/sample-lab"; route.search = ""; });
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ push: vi.fn() }),
}));
// 서버 액션 본체(세션·DB)는 이 검사의 대상이 아니다 — 폼이 «무엇을» 보내는지는 SidebarNewTab 검사가 잰다.
vi.mock("@/app/(app)/boards/actions", () => ({ createTabFromSidebarAction: vi.fn() }));

const BASE = "/w/sample-lab";
const TABS: SidebarUserTab[] = [
  { id: "t-after-1", name: "영업 파이프라인", icon: null, navSection: "after-contract" },
  { id: "t-before", name: "리드 접수", icon: null, navSection: "before-contract" },
  { id: "t-after-2", name: "계약 진행", icon: null, navSection: "after-contract" },
];

function render(props: Partial<React.ComponentProps<typeof SidebarNav>> = {}) {
  return renderToStaticMarkup(<SidebarNav lockedFeatures={[]} workspaceBasePath={BASE} {...props} />);
}

/** 한 소분류(<section aria-labelledby="sidebar-…">) 안의 메뉴 키를 순서대로. */
function sectionKeys(html: string, sectionKey: string): string[] {
  const section = html.match(new RegExp(`<section aria-labelledby="sidebar-${sectionKey}">([\\s\\S]*?)</section>`))?.[1] ?? "";
  return [...section.matchAll(/data-nav-key="([^"]+)"/g)].map((match) => match[1]);
}

function linkFor(html: string, key: string): string {
  return html.match(new RegExp(`<a[^>]*data-nav-key="${key}"[^>]*>`))?.[0] ?? "";
}

describe("사이드바 사용자 탭", () => {
  it("고른 소분류의 «맨 끝» 에 정렬 순서대로 붙는다", () => {
    const html = render({ userTabs: TABS });
    const before = sectionKeys(html, "before-contract");
    const after = sectionKeys(html, "after-contract");

    expect(before.at(-1)).toBe("board:t-before");
    expect(before.filter((key) => key.startsWith("board:"))).toEqual(["board:t-before"]);
    expect(after.slice(-2)).toEqual(["board:t-after-1", "board:t-after-2"]);
    // 기본 메뉴는 그 앞에 그대로 있다.
    expect(after.indexOf("work")).toBeGreaterThanOrEqual(0);
    expect(after.indexOf("work")).toBeLessThan(after.indexOf("board:t-after-1"));
  });

  it("보통 중첩 메뉴 줄과 같은 모양 — 폴더 선 아이콘·이름·워크스페이스 안 보드 주소", () => {
    const html = render({ userTabs: TABS });
    const link = linkFor(html, "board:t-after-1");
    const work = linkFor(html, "work");

    expect(link).toContain(`href="${BASE}/boards/t-after-1"`);
    // 높이·여백·모서리·글자 크기는 다른 중첩 줄(계약업체 실무)과 같은 값이다.
    const metrics = (tag: string) => tag.match(/style="([^"]*)"/)?.[1]
      .split(";")
      .filter((rule) => /^(gap|height|border-radius|padding-left|padding-right|font-size):/.test(rule));
    expect(metrics(link)).toEqual(metrics(work));
    const row = html.match(/<a[^>]*data-nav-key="board:t-after-1"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    expect(row).toContain('href="#i-folder"');
    expect(row).toContain("영업 파이프라인");
    // 이모지 아이콘을 UI 아이콘으로 쓰지 않는다(D43).
    expect(row).not.toContain("📋");
  });

  it("그 보드에 있으면 그 줄 «하나만» 같은 활성 색으로 켜진다", () => {
    route.pathname = `${BASE}/boards/t-before`;
    const html = render({ userTabs: TABS, boardNavKeys: { "t-before": "board:t-before", "b-work": "work" } });
    const active = html.match(/<a[^>]*aria-current="page"[^>]*>/g) ?? [];

    expect(active).toHaveLength(1);
    expect(active[0]).toContain('data-nav-key="board:t-before"');
    expect(active[0]).toContain("mw-nav-active");
    expect(active[0]).toContain("var(--mw-nav-active-bg, var(--mw-record))");
  });

  it("사용자 탭이 없으면 기존 사이드바와 같다", () => {
    expect(render({ userTabs: [] })).toBe(render());
  });
});

describe("지운 기본 탭", () => {
  it("지운 기본 탭의 메뉴를 숨긴다 — 리드컨택을 지우면 상담 단계 보기도 같이", () => {
    const html = render({ dismissedSources: ["core.default-tab/contact", "core.default-tab/notice"] });

    for (const key of ["contact", "consult-remote", "consult-inperson", "notice"]) {
      expect(html).not.toContain(`data-nav-key="${key}"`);
    }
    for (const key of ["new", "work", "dash", "company"]) {
      expect(html).toContain(`data-nav-key="${key}"`);
    }
  });

  it("신규리드·계약업체 실무도 각각 숨는다", () => {
    const html = render({ dismissedSources: ["core.default-tab/new-lead", "core.default-tab/contract-work"] });
    expect(html).not.toContain('data-nav-key="new"');
    expect(html).not.toContain('data-nav-key="work"');
    // 상담 메뉴는 남는다 — 단계 보기 두 줄이든(지금) 「상담관리」 한 줄이든(#838) 같은 리드컨택 묶음이다.
    const consultation = sectionKeys(html, "before-contract")
      .filter((key) => ["contact", "consult-remote", "consult-inperson"].includes(key));
    expect(consultation.length).toBeGreaterThan(0);
  });

  it("★ 계약 전 기본 탭을 다 지우고 그 자리 사용자 탭도 없으면 «계약 전» 제목째 그리지 않는다", () => {
    const afterOnly = TABS.filter((tab) => tab.navSection === "after-contract");
    const html = render({ userTabs: afterOnly, dismissedSources: ["core.default-tab/new-lead", "core.default-tab/contact"] });

    expect(html).not.toContain('aria-labelledby="sidebar-before-contract"');
    expect(html).not.toContain('id="sidebar-before-contract"');
    expect(sectionKeys(html, "after-contract").slice(-2)).toEqual(["board:t-after-1", "board:t-after-2"]);
  });

  it("기본 탭을 다 지워도 그 자리 사용자 탭이 있으면 «계약 전» 이 남는다", () => {
    const html = render({ userTabs: TABS, dismissedSources: ["core.default-tab/new-lead", "core.default-tab/contact"] });
    expect(sectionKeys(html, "before-contract")).toEqual(["board:t-before"]);
  });
});

describe("「새 탭」 줄", () => {
  it("탭 관리 권한이 없으면 그리지 않는다", () => {
    expect(render()).not.toContain('data-nav-key="new-tab"');
    expect(render({ canCreateTab: false })).not.toContain("새 탭");
  });

  it("권한이 있으면 업무 묶음 맨 끝(준비 중 다음)에, 닫힌 팝오버 버튼으로 그린다", () => {
    const html = render({ canCreateTab: true, userTabs: TABS });
    const button = html.match(/<button[^>]*data-nav-key="new-tab"[^>]*>([\s\S]*?)<\/button>/);

    expect(button?.[0]).toContain('aria-haspopup="dialog"');
    expect(button?.[0]).toContain('aria-expanded="false"');
    expect(button?.[1]).toContain('href="#i-plus"');
    expect(button?.[1]).toContain("새 탭");
    expect(html.indexOf('data-nav-section="coming-soon"')).toBeLessThan(html.indexOf('data-nav-key="new-tab"'));
    expect(html.indexOf('data-nav-key="new-tab"')).toBeLessThan(html.indexOf(">설정<"));
    // 열리기 전에는 대화상자를 그리지 않는다.
    expect(html).not.toContain('role="dialog"');
  });

  it("다른 중첩 줄과 같은 높이·여백·모서리·글자, 흐린 글자색", () => {
    const html = render({ canCreateTab: true });
    const style = html.match(/<button[^>]*data-nav-key="new-tab"[^>]*style="([^"]*)"/)?.[1] ?? "";
    expect(style).toContain("height:var(--mw-shell-item-h)");
    expect(style).toContain("padding-left:var(--sp-6)");
    expect(style).toContain("border-radius:var(--mw-r-3)");
    expect(style).toContain("font-size:var(--mw-shell-item-fs)");
    expect(style).toContain("color:var(--mw-sub)");
  });
});

/**
 * #845 대표 결정(2026-10-08) — 탭 아이콘 한 벌을 사이드바에도 쓴다(머리말과 같은 그림).
 * 아이콘은 16px 회색, 지금 탭만 탭 색으로 진하다. 사용자 탭은 고른 아이콘 키가 있을 때만 그 그림, 아니면 폴더.
 */
describe("사이드바 탭 아이콘", () => {
  const rowOf = (html: string, key: string) => html.match(new RegExp(`<a[^>]*data-nav-key="${key}"[^>]*>([\\s\\S]*?)</a>`))?.[1] ?? "";

  it("업무 탭 줄은 머리말과 같은 16px 선 아이콘을 쓴다", () => {
    const html = render();
    const expected: Record<string, string> = {
      new: "lead",
      "consult-remote": "video",
      "consult-inperson": "people",
      work: "case",
      company: "building",
      acct: "receipt",
      notice: "notice",
    };
    for (const [key, icon] of Object.entries(expected)) {
      const row = rowOf(html, key);
      expect(row, key).toContain(`data-tab-icon="${icon}"`);
      expect(row, key).toContain('width="16"');
      expect(row, key).not.toContain('href="#i-');
    }
    // 탭이 아닌 메뉴(대시보드 등)는 셸 아이콘 그대로다.
    expect(rowOf(html, "dash")).toContain('href="#i-grid"');
  });

  it("아이콘은 회색이고 지금 탭만 탭 색으로 진하다", () => {
    route.pathname = `${BASE}/work`;
    const html = render();
    const iconColor = (key: string) => rowOf(html, key).match(/<span aria-hidden="true"[^>]*style="color:([^"]+)"/)?.[1];
    expect(iconColor("work")).toBe("var(--mw-tab-icon, currentColor)");
    expect(iconColor("company")).toBe("var(--mw-sub)");
    expect(iconColor("dash")).toBe("var(--mw-sub)");
  });

  it("사용자 탭은 고른 아이콘 키면 그 그림, 비었거나 이모지면 폴더", () => {
    const html = render({
      userTabs: [
        { id: "t-key", name: "달력 탭", icon: "calendar", navSection: "after-contract" },
        { id: "t-emoji", name: "이모지 탭", icon: "📋", navSection: "after-contract" },
      ],
    });
    expect(rowOf(html, "board:t-key")).toContain('data-tab-icon="calendar"');
    expect(rowOf(html, "board:t-key")).not.toContain('href="#i-folder"');
    expect(rowOf(html, "board:t-emoji")).toContain('href="#i-folder"');
    expect(rowOf(html, "board:t-emoji")).not.toContain("📋");
  });
});
