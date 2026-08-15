import { describe, expect, it } from "vitest";
import { parseSavedBoardViewConfig, savedViewUrl } from "./board-saved";

describe("parseSavedBoardViewConfig", () => {
  it("keeps filter, sort, grouping, and layout state", () => {
    const parsed = parseSavedBoardViewConfig({
      kind: "calendar",
      filters: { q: "서울", assignees: ["u1"], byColumn: { status: ["done"] }, sortKey: "date", sortDir: "desc", columnLimit: 8 },
      groupBy: "status",
      layout: { g1: ["name", "status"] },
      hiddenColumns: ["secret"],
      columnOrder: ["name", "status"],
      calendarFieldKey: "date",
    });
    expect(parsed).toMatchObject({ kind: "calendar", groupBy: "status", calendarFieldKey: "date" });
    expect(parsed.filters).toMatchObject({ q: "서울", sortKey: "date", sortDir: "desc", columnLimit: 8 });
    expect(parsed.layout.g1).toEqual(["name", "status"]);
    expect(parsed.hiddenColumns).toEqual(["secret"]);
  });

  it("selects a shared view through a read-only URL without an owner touch", () => {
    const url = savedViewUrl({
      id: "shared-1", name: "공용", visibility: "shared", ownerId: "other-user",
      isDefault: false, lastUsedAt: null,
      config: { kind: "calendar", filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", columnLimit: 0 }, groupBy: "status", layout: {}, hiddenColumns: [], columnOrder: [], calendarFieldKey: "date" },
    }, "https://example.test/boards/b1?view=table");
    expect(url).toContain("savedView=shared-1");
    expect(url).toContain("view=calendar");
    expect(url).toContain("group=status");
  });

  it("rejects malformed values without widening the contract", () => {
    expect(parseSavedBoardViewConfig({ filters: { assignees: "u1", columnLimit: -5 } })).toEqual({
      kind: "board",
      filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", columnLimit: 0 },
      groupBy: "",
      layout: {},
      hiddenColumns: [],
      columnOrder: [],
      calendarFieldKey: null,
    });
  });
});
