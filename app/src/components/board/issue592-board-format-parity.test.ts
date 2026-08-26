import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Issue #592 board table format parity", () => {
  it("keeps one neutral compact format for ordinary and specialized board cells", () => {
    const style = read("./table-style.ts");
    const table = read("./GroupTable.tsx");
    const loan = read("./NewLeadLoanCell.tsx");
    const score = read("./NewLeadCreditScoreCell.tsx");
    const workflow = read("./WorkflowProgressCell.tsx");
    const detail = read("./ItemDetailPanel.tsx");

    expect(style).toContain("BOARD_TABLE_CONTROL");
    expect(style).toContain("h-7 w-full");
    expect(style).toContain("border-mw-line bg-mw-card");
    expect(style).toContain('BOARD_TABLE_ROW = "h-8"');
    expect(table).toContain('data-board-table-format="uniform"');
    expect(table).not.toContain('canonicalNewLead ? "h-8" : "h-9"');
    expect(detail).not.toContain('canonicalNewLead ? "min-h-7" : "min-h-8"');
    for (const specialized of [loan, score, workflow]) {
      expect(specialized).toContain("BOARD_TABLE_CONTROL");
    }
  });

  it("offers a deterministic all-group fixture without changing the existing one-group gate", () => {
    const fixture = read("../../app/login/visual-fixture/page.tsx");
    expect(fixture).toContain("showAllGroups ? undefined : 1");
    expect(fixture).toContain('params.groups === "all"');
    expect(fixture).toContain("groups.map((group, index)");
  });
});
