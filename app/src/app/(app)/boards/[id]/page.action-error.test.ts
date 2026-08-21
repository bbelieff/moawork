import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8").replace(/\r\n/gu, "\n");

describe("board action error shell", () => {
  it("renders one error banner outside every current and future view branch", () => {
    expect(source.match(/data-testid="board-action-error"/gu)).toHaveLength(1);

    const contentStart = source.indexOf("const boardContent =");
    const commonReturn = source.indexOf("\n  return (", contentStart);
    const banner = source.indexOf('data-testid="board-action-error"', commonReturn);
    const contentSlot = source.indexOf("{boardContent}", commonReturn);

    expect(contentStart).toBeGreaterThan(-1);
    expect(commonReturn).toBeGreaterThan(contentStart);
    expect(banner).toBeGreaterThan(commonReturn);
    expect(contentSlot).toBeGreaterThan(banner);
    expect(source.slice(contentStart, commonReturn)).not.toContain('data-testid="board-action-error"');
  });

  it("keeps all four views inside the shared content slot", () => {
    expect(source).toContain('sp.view === "kanban"');
    expect(source).toContain('sp.view === "flat"');
    expect(source).toContain('sp.view === "calendar"');
    expect(source).toContain(': "table"');
    expect(source.slice(source.indexOf("const boardContent ="))).toMatch(
      /view === "kanban"[\s\S]+view === "flat" \|\| view === "calendar"[\s\S]+<BoardWorkspace/,
    );
  });
});
