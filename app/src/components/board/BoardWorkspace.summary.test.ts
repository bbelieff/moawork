/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, type ComponentType } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BoardSummaryStrip } from "./BoardSummaryStrip";
import { GroupBlock } from "./GroupBlock";
import type { BoardColumn } from "@/lib/boards/types";

const workspace = readFileSync(resolve(process.cwd(), "src/components/board/BoardWorkspace.tsx"), "utf8");
const group = readFileSync(resolve(process.cwd(), "src/components/board/GroupBlock.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(app)/boards/[id]/page.tsx"), "utf8");

describe("Issue #605 live summary consumer", () => {
  it("binds the leaf to each group after the canonical display filter", () => {
    expect(workspace).toMatch(/const visibleRows = applyFilters\(block\.rows, searchColumns, displayFilters, filterProjection, assigneeLabels\)/);
    expect(workspace).toMatch(/<BoardSummaryStrip[\s\S]*rows=\{visibleRows\}/);
    expect(workspace).toContain("columns={activeSummaryColumns}");
    expect(workspace).toContain("totalCount: block.rows.length");
  });

  it("keeps full summary columns separate from URL-hidden table columns and saved-view scope explicit", () => {
    expect(page).toContain("columns={visibleColumns}");
    expect(page).toContain("summaryColumns={columns}");
    expect(page).toContain("savedViewActive={Boolean(personRuntime.view)}");
    expect(page).not.toContain("savedViewActive={Boolean(sp.savedView)}");
    expect(workspace).toContain("return summaryColumns.filter");
    expect(workspace).not.toContain("presentNewLeadColumns(active)");
    expect(workspace).toContain('kind: "saved-view"');
    expect(workspace).toContain('kind: "filtered"');
  });

  it("replaces the legacy first-number sum and keeps the summary/settings row shrinkable", () => {
    expect(group).not.toContain("sumOfFirstNumberColumn");
    expect(group).toContain("{summarySlot}");
    expect(group).toContain("min-w-0 flex-1");
  });

  it("hydrates GroupBlock plus summary strip without invalid span/div nesting or console errors", async () => {
    const column: BoardColumn = {
      id: "amount", org_id: "org", board_id: "board", key: "amount", label: "금액",
      type: "money", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
    };
    const strip = createElement(BoardSummaryStrip, {
      config: [{ id: "amount", kind: "sum", columnKey: "amount" }],
      columns: [column],
      rows: [],
      coverage: { state: "complete" },
      scope: { kind: "all" },
      formatValue: (value: number) => String(value),
      settings: createElement("button", { type: "button" }, "요약 설정"),
    });
    const HydratableGroupBlock = GroupBlock as ComponentType<Omit<Parameters<typeof GroupBlock>[0], "children">>;
    const tree = createElement(HydratableGroupBlock, {
      name: "그룹", color: null, columns: [column], rows: [], summarySlot: strip,
      presetName: "", presetChanged: false,
    }, createElement("div", null, "본문"));
    const html = renderToString(tree);
    expect(html).not.toMatch(/<span[^>]*>\s*<div/);

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root: Root | undefined;
    await act(async () => { root = hydrateRoot(host, tree); await Promise.resolve(); });
    expect(host.querySelector("summary [data-board-summary-strip]")).not.toBeNull();
    expect(errors).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
    errors.mockRestore();
    host.remove();
  });
});
