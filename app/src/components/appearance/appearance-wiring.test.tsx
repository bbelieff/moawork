import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AppearanceControl } from "./AppearanceControl";
import { RouteAppearance } from "./RouteAppearance";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/sample-lab",
  useRouter: () => ({ push: vi.fn() }),
}));

const SRC = new URL("../../", import.meta.url);
function read(rel: string): string {
  return readFileSync(new URL(rel, SRC), "utf8");
}

/**
 * v17 vivid 배선 계약 — «어디에 달렸는가» 가 깨지면 눈으로 못 잡는다.
 * 실제 컴포넌트·CSS·레이아웃 본문을 읽어 명시 속성/선택자/마운트를 확인한다.
 */
describe("v17 vivid 배선", () => {
  it("RouteAppearance는 DOM을 그리지 않는다", () => {
    expect(renderToStaticMarkup(<RouteAppearance boardNavKeys={{}} basePath="/w/sample-lab" />)).toBe("");
  });

  it("외관 조절기는 접근 가능한 버튼+팝오버 계약을 지킨다", () => {
    const html = renderToStaticMarkup(<AppearanceControl />);
    expect(html).toContain('aria-label="화면 표시 설정"');
    expect(html).toContain('aria-haspopup="dialog"');
    // 팝오버는 닫힌 채로 시작 — localStorage를 렌더 중에 읽지 않는다.
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toMatch(/\stitle="/);
  });

  it("셸 활성 메뉴는 vivid 변수 + 파랑 폴백을 함께 단다", () => {
    const sidebar = read("components/shell/SidebarNav.tsx");
    expect(sidebar).toContain("mw-nav-active");
    expect(sidebar).toContain("var(--mw-nav-active-bg, var(--mw-record))");
    expect(sidebar).toContain("var(--mw-nav-active-fg, var(--mw-on-accent))");
  });

  it("실제 주요 CTA에만 명시 속성이 달린다 — 파괴적·상태 셀 제외", () => {
    for (const file of [
      "components/board/BoardHeader.tsx",
      "components/board/NewLeadIntakeForm.tsx",
      "components/board/WorkflowProgressCell.tsx",
      "components/companies/CompanyCsvImport.tsx",
    ]) {
      expect(read(file)).toContain('data-mw-cta="primary"');
    }
    // 전체 버튼 전역 스타일 금지 — vivid CSS에 button 전역 선택자가 없다.
    const css = read("styles/moawork-vivid-v17.css");
    expect(css).not.toMatch(/^[ \t]*button[ \{,]/m);
  });

  it("vivid CSS는 라우트 5종·효과 on/off·다크·강제색상·모션감소를 모두 덮는다", () => {
    const css = read("styles/moawork-vivid-v17.css");
    for (const accent of ["new", "contact", "work", "company", "dash"]) {
      expect(css).toContain(`html[data-mw-accent="${accent}"]`);
    }
    expect(css).toContain('html[data-mw-accent][data-mw-effects="on"] [data-mw-cta="primary"]');
    expect(css).toContain('html[data-mw-accent][data-mw-effects="off"] [data-mw-cta="primary"]');
    expect(css).toContain('html[data-mw-accent][data-theme="dark"]');
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("[data-workspace-mark]");
    expect(css).toContain("[data-visual-block=\"board-header\"]");
    // 출처 스톱이 그대로다.
    for (const stop of ["#ea580c", "#facc15", "#ef4444", "#ec4899", "#22c55e", "#98ec2d", "#0ea5e9", "#06b6d4", "#3969e7", "#7d2ae7", "#07b9ce"]) {
      expect(css).toContain(stop);
    }
  });

  it("앱 셸에 라우트 배선과 외관 조절기가 마운트된다", () => {
    const layout = read("app/(app)/layout.tsx");
    expect(layout).toContain("<RouteAppearance");
    expect(layout).toContain("boardNavKeys={boardNavKeys}");
    expect(layout).toContain("<AppearanceControl />");
    expect(layout).toContain("<ThemeToggle />");
  });

  it("워크스페이스 표식에 vivid 링용 명시 속성이 있다", () => {
    expect(read("components/workspace/WorkspaceMark.tsx")).toContain("data-workspace-mark");
  });
});
