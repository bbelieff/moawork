import { describe, expect, it } from "vitest";
import { parseSavedBoardViewConfig } from "./board-saved";

describe("parseSavedBoardViewConfig", () => {
  it("keeps filter, sort, grouping, and layout state", () => {
    const parsed = parseSavedBoardViewConfig({
      kind: "calendar",
      filters: { q: "서울", assignees: ["u1"], byColumn: { status: ["done"] }, sortKey: "date", sortDir: "desc", columnLimit: 8 },
      groupBy: "status",
      layout: { g1: ["name", "status"] },
      calendarFieldKey: "date",
    });
    expect(parsed).toMatchObject({ kind: "calendar", groupBy: "status", calendarFieldKey: "date" });
    expect(parsed.filters).toMatchObject({ q: "서울", sortKey: "date", sortDir: "desc", columnLimit: 8 });
    expect(parsed.layout.g1).toEqual(["name", "status"]);
  });

  it("rejects malformed values without widening the contract", () => {
    expect(parseSavedBoardViewConfig({ filters: { assignees: "u1", columnLimit: -5 } })).toEqual({
      kind: "board",
      filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", columnLimit: 0 },
      groupBy: "",
      layout: {},
      calendarFieldKey: null,
    });
  });
});
