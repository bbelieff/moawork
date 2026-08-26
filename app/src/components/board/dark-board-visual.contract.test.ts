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
