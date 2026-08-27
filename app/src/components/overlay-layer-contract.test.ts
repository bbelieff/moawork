import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/gu, "\n");
const globals = read("src/app/globals.css");
const layout = read("src/app/(app)/layout.tsx");
const switcher = read("src/components/workspace/WorkspaceSwitcher.tsx");
const switcherCss = read("src/components/workspace/workspace-switcher.module.css");
const filter = read("src/components/board/FilterChip.tsx");
const columnMenu = read("src/components/board/BoardAnchoredMenu.tsx");
const columnPanel = read("src/components/board/ColumnExpandedPanel.tsx");
const workBoard = read("src/components/work-management/WorkBoardSurface.tsx");
const workBoardCss = read("src/components/work-management/work-management.module.css");

function layer(name: string) {
  const match = globals.match(new RegExp(`--mw-layer-${name}:\\s*(\\d+);`, "u"));
  if (!match) throw new Error(`missing layer token: ${name}`);
  return Number(match[1]);
}

describe("Issue #568 global overlay contract", () => {
  it("board < page popover < shell < shell popover < tooltip < scrim < dialog < toast 순서를 고정한다", () => {
    expect([
      layer("board-cell"),
      layer("board-header"),
      layer("board-corner"),
      layer("page-popover"),
      layer("shell"),
      layer("shell-popover"),
      layer("tooltip"),
      layer("scrim"),
      layer("dialog"),
      layer("toast"),
    ]).toEqual([10, 20, 30, 40, 50, 60, 65, 70, 80, 90]);
  });

  it("sticky sidebar와 회사 전환·필터를 각자의 의미 레이어에 둔다", () => {
    expect(layout).toContain('className="mw-layer-shell relative flex');
    expect(switcher).toContain("createPortal(children, document.body)");
    expect(switcher).toContain("data-workspace-switcher-dialog");
    expect(switcherCss).toContain("z-index: var(--mw-layer-shell-popover)");
    expect(switcherCss).toContain("z-index: var(--mw-layer-scrim)");
    expect(switcherCss).toContain("z-index: var(--mw-layer-dialog)");
    expect(switcherCss).not.toMatch(/z-index:\s*(?:69|70);/u);
    expect(filter).toContain('className="mw-layer-page-popover fixed inset-0"');
    expect(filter).not.toContain('className="mw-layer-dialog fixed inset-0"');
  });

  it("공용 layer utility가 의미 토큰만 사용한다", () => {
    for (const name of ["page-popover", "shell", "shell-popover", "tooltip", "scrim", "dialog", "toast"]) {
      expect(globals).toContain(`.mw-layer-${name} { z-index: var(--mw-layer-${name}); }`);
    }
  });

  it("실제 전역 dialog가 shell보다 낮은 기존 숫자에 머물지 않는다", () => {
    expect(workBoard).toContain('className={`${styles.drawer} mw-layer-dialog`}');
    expect(workBoardCss).toContain(".drawer{position:fixed;z-index:var(--mw-layer-dialog);");
    expect(workBoardCss).not.toContain(".drawer{position:fixed;z-index:20;");
  });

  it("컬럼 메뉴와 확장 패널은 body portal의 page-popover 레이어를 쓴다", () => {
    expect(columnMenu).toContain("<BoardDialogPortal>");
    expect(columnMenu).toContain("mw-layer-page-popover fixed");
    expect(columnPanel).toContain("<BoardDialogPortal>");
    expect(columnPanel).toContain("mw-layer-page-popover fixed");
    expect(columnPanel).not.toContain("mw-layer-dialog");
  });
});
