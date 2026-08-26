import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SavedBoardView } from "@/lib/view/board-saved";
import { ViewTabs } from "./ViewTabs";

const config = {
  kind: "table" as const,
  filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc" as const, columnLimit: 0 },
  groupBy: "",
  layout: {},
  hiddenColumns: [],
  columnOrder: [],
  calendarFieldKey: null,
  sorts: [],
  textMode: "single" as const,
  focusColumnKey: null,
};

const views: SavedBoardView[] = [
  { id: "shared", name: "오늘 연락", visibility: "shared", ownerId: "u2", config, isDefault: true, lastUsedAt: null },
  { id: "private", name: "내 후속", visibility: "private", ownerId: "u1", config, isDefault: false, lastUsedAt: null },
];

describe("ViewTabs", () => {
  it("renders system and persisted views as actual tabs rather than route navigation", () => {
    const html = renderToStaticMarkup(
      <ViewTabs views={views} activeId="private" onSelectMain={() => {}} onSelect={() => {}} onRequestCreate={() => {}} />,
    );
    expect(html).toContain("메인 테이블");
    expect(html).toContain("오늘 연락");
    expect(html).toContain("내 후속");
    expect(html).toContain("공용");
    expect(html).toContain("나만");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain("고객관리");
  });

  it("keeps active tab text readable in dark mode and suppresses decorative scrollbars", () => {
    const css = readFileSync(new URL("./view.module.css", import.meta.url), "utf8");
    expect(css).toContain("overflow-y:hidden");
    expect(css).toContain("scrollbar-width:none");
    expect(css).toContain("color:var(--mw-record)");
    expect(css).not.toContain("color:#3535a8");
  });
});
