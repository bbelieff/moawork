import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Issue #582 dark board visual contract", () => {
  it("uses opaque sticky surfaces and theme-aware table scrollbars", () => {
    const globals = read("../../app/globals.css");
    const group = read("./GroupBlock.tsx");
    const table = read("./GroupTable.tsx");

    expect(globals).toContain('[data-right-pinned="true"]');
    expect(globals).toContain('[data-view-focus="true"]');
    expect(globals).toContain("var(--mw-record) 14%, var(--mw-card)");
    expect(globals).toContain('.relative.isolate::-webkit-scrollbar-thumb');
    expect(globals).toContain(':is(tbody td, input, select, textarea)');
    expect(table).toContain("max-w-full overflow-auto");
    expect(group).toContain("14%, var(--mw-card)");
    expect(group).not.toContain("14%, transparent");
  });

  it("#839 board hierarchy: lighter pinned body, moving sticky lines, working row hover, light+dark tokens", () => {
    const globals = read("../../app/globals.css");
    const vivid = read("../../styles/moawork-vivid-v17.css");
    const scroll = read("./board-scroll.module.css");

    // 진행현황: 머리글은 14% 그대로, 본문만 옅게 — 칸 구분선이 보이게.
    expect(globals).toContain('td[data-right-pinned="true"] {\n  background: var(--mw-pinned-body) !important;');
    expect(globals).toContain("--mw-pinned-body: color-mix(in srgb, var(--mw-record) 6%, var(--mw-card))");
    // sticky 칸의 선은 collapse 테두리가 아니라 안쪽 그림자 — 가로 스크롤 중에도 칸과 함께 움직인다.
    expect(globals).toContain("inset 2px 0 0 var(--mw-primary)");
    expect(globals).toContain("inset 0 -1px 0 var(--mw-pinned-line)");
    expect(globals).toContain("inset 3px 0 0 var(--mw-group-accent, transparent)");
    // 행 호버는 무계층 카드색 규칙보다 구체적인 무계층 선택자로(Tailwind 유틸은 진다).
    expect(globals).toContain('[data-visual-block="group-table"] tbody > tr[data-board-row]:hover > td {');
    expect(globals).toContain('tr[data-just-added="true"] > td');
    // 토큰은 라이트 기본 + 다크 두 경로(명시 테마·OS 추종) 모두.
    expect(globals.match(/--mw-board-canvas:/g)).toHaveLength(3);
    for (const token of ["--mw-board-head", "--mw-grid-line", "--mw-row-hover"]) {
      expect(globals).toContain(`${token}: color-mix(`);
    }
    // 보드 바탕은 보드 뷰포트에만 — 전역 --mw-bg 는 그대로.
    expect(scroll).toContain("background: var(--mw-board-canvas);");
    expect(scroll).toContain("gap: var(--sp-4);");
    // v17 의 «그룹색은 점만» 변수 덮어쓰기는 걷어 냈다(띠는 GroupBlock 인라인).
    expect(vivid).not.toContain("--mw-group-header-bg");
    expect(vivid).not.toContain("--mw-group-rail-width:0px");
  });

  it("does not create cross-axis scrollbars in single-line board controls", () => {
    const globals = read("../../app/globals.css");
    const header = read("./BoardHeader.tsx");
    const toolbar = read("./BoardToolbar.tsx");

    expect(globals).toContain(".mw-board-inline-scroll::-webkit-scrollbar");
    expect(globals).toContain("scrollbar-width: none");
    expect(header).toContain("overflow-y-hidden");
    expect(toolbar).toContain("overflow-y-hidden");
  });
});
