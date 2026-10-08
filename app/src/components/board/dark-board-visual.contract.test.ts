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
    // #845: 그룹 띠 틴트는 톤 16%(승인 목업 Palette.dc 의 rgba(.16)).
    expect(group).toContain("16%, var(--mw-card)");
    expect(group).not.toContain("14%, transparent");
  });

  it("#839 board hierarchy: lighter pinned body, moving sticky lines, working row hover, light+dark tokens", () => {
    const globals = read("../../app/globals.css");
    const vivid = read("../../styles/moawork-vivid-v17.css");
    const scroll = read("./board-scroll.module.css");

    // 진행현황(2026-10-07 대표 피드백): 머리글은 다른 머리글과 같은 탭 테마색 줄, 본문은 카드색 — 칙칙한 틴트를 뺐다.
    expect(globals).toContain('td[data-right-pinned="true"] {\n  background: var(--mw-pinned-body) !important;');
    expect(globals).toContain("--mw-pinned-body: var(--mw-card)");
    expect(globals).toContain('th[data-right-pinned="true"] {\n  background: var(--mw-board-head) !important;');
    expect(globals).toContain("--mw-board-head: color-mix(in srgb, var(--mw-cta-solid, var(--mw-fg)) 12%, var(--mw-card))");
    // sticky 칸의 선은 collapse 테두리가 아니라 안쪽 그림자 — 가로 스크롤 중에도 칸과 함께 움직인다.
    expect(globals).toContain("inset 1px 0 0 var(--mw-grid-line)");
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

  it("#845 group tones: every route accent defines a 2-color × 5-depth ramp in light and both dark paths", () => {
    const globals = read("../../app/globals.css");
    const vivid = read("../../styles/moawork-vivid-v17.css");
    const tokens = [1, 2, 3, 4, 5].flatMap((level) => [`--mw-tab-a-${level}`, `--mw-tab-b-${level}`]);
    // 기본값(강조 라우트 없음) — 라이트 + 다크 두 경로, 멈춤 회색 포함.
    for (const token of [...tokens, "--mw-tab-stop"]) {
      expect(globals.match(new RegExp(`${token}:`, "g")), token).toHaveLength(3);
    }
    // 탭별 사다리 — 실제 강조 라우트 7종 모두(라이트 · 명시 다크 · OS 다크).
    const rules = [...vivid.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((match) => ({ selectors: match[1].split(",").map((selector) => selector.trim()), body: match[2] }));
    for (const route of ["new", "contact", "inperson", "work", "company", "news", "dash"]) {
      for (const selector of [
        `html[data-mw-accent="${route}"]`,
        `html[data-mw-accent="${route}"][data-theme="dark"]`,
        `html[data-mw-accent="${route}"]:not([data-theme="light"])`,
      ]) {
        const ladder = rules.find((rule) => rule.selectors.includes(selector) && rule.body.includes("--mw-tab-a-1"));
        expect(ladder, selector).toBeDefined();
        for (const token of tokens) expect(ladder!.body, `${selector} ${token}`).toContain(`${token}:`);
      }
    }
    // 계약업체 실무(work)는 승인 목업 Palette.dc 의 초록·연두 사다리 그대로다.
    expect(vivid).toContain("--mw-tab-a-1: #86efac; --mw-tab-a-2: #4ade80; --mw-tab-a-3: #22c55e; --mw-tab-a-4: #16a34a; --mw-tab-a-5: #15803d;");
    expect(vivid).toContain("--mw-tab-b-1: #bef264; --mw-tab-b-2: #a3e635; --mw-tab-b-3: #84cc16; --mw-tab-b-4: #65a30d; --mw-tab-b-5: #4d7c0f;");
    // 라우트 사다리는 라이트 6 + 명시 다크 6 + OS 다크 6 규칙(contact·dash 는 한 규칙을 함께 쓴다).
    expect(vivid.match(/--mw-tab-a-1:/g)).toHaveLength(18);
  });

  it("does not create cross-axis scrollbars in single-line board controls", () => {
    const globals = read("../../app/globals.css");
    const header = read("./BoardHeader.tsx");
    const toolbar = read("./BoardViewBar.tsx");

    expect(globals).toContain(".mw-board-inline-scroll::-webkit-scrollbar");
    expect(globals).toContain("scrollbar-width: none");
    expect(header).toContain("overflow-y-hidden");
    expect(toolbar).toContain("overflow-y-hidden");
  });
});
