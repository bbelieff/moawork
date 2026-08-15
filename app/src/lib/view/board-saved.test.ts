import { describe, expect, it } from "vitest";
import { decodeBoardFilters } from "@/components/board/filters";
import { applySavedKanbanView, parseSavedBoardViewConfig, savedBoardViewFromRow, savedViewUrl, systemViewUrl } from "./board-saved";

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

  it("restores filters, sort, layout, hidden and order without touching the shared view row", () => {
    const url = savedViewUrl({
      id: "shared-1", name: "공용", visibility: "shared", ownerId: "other-user",
      isDefault: false, lastUsedAt: null,
      config: { kind: "calendar", filters: { q: "kim", assignees: [], byColumn: { status: ["done"] }, sortKey: "date", sortDir: "desc", columnLimit: 3 }, groupBy: "status", layout: { g1: ["date"] }, hiddenColumns: ["secret"], columnOrder: ["date"], calendarFieldKey: "date" },
    }, "https://example.test/boards/b1?view=table");
    expect(url).toContain("savedView=shared-1");
    expect(url).toContain("view=calendar");
    expect(url).toContain("group=status");
    const parsedUrl = new URL(url);
    expect(decodeBoardFilters(parsedUrl.searchParams.get("mwFilters"))).toMatchObject({ q: "kim", sortKey: "date", sortDir: "desc" });
    expect(JSON.parse(parsedUrl.searchParams.get("mwHidden") ?? "[]")).toEqual(["secret"]);
    expect(JSON.parse(parsedUrl.searchParams.get("mwOrder") ?? "[]")).toEqual(["date"]);
  });

  it("maps deletion fallback rows through the public SavedBoardView contract", () => {
    expect(savedBoardViewFromRow({ id: "v2", name: "fallback", visibility: "shared", owner_id: "u2", config_jsonb: { kind: "table" }, is_default: true, last_used_at: "2026-08-16T00:00:00Z" })).toMatchObject({
      id: "v2", name: "fallback", visibility: "shared", ownerId: "u2", isDefault: true,
      config: { kind: "table" }, lastUsedAt: "2026-08-16T00:00:00Z",
    });
  });

  it("clears every saved-view parameter when returning to a system view", () => {
    const url = new URL(systemViewUrl("board", "https://example.test/boards/b1?savedView=v1&mwFilters=x&mwLayout=x&mwHidden=x&mwOrder=x&group=status&sort=date&calendarField=due"));
    expect(url.searchParams.get("view")).toBe("kanban");
    expect([...url.searchParams.keys()]).toEqual(["view"]);
  });

  it("applies saved filters and sort to actual kanban card ids, count and order", () => {
    const column = { id: "c1", org_id: "o1", board_id: "b1", key: "score", label: "점수", type: "number", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null } as const;
    const item = (id: string, score: number) => ({ id, org_id: "o1", board_id: "b1", group_id: "g1", title: id, assigned_to: null, sort_order: 0, created_at: "", updated_at: "", values: { score } });
    const rows = [item("low", 1), item("high", 9), item("mid", 5)];
    const result = applySavedKanbanView([{ id: "lane", items: rows }], rows, [column], { q: "", assignees: [], byColumn: {}, sortKey: "score", sortDir: "desc", columnLimit: 0 });
    expect(result[0].items.map((row) => row.id)).toEqual(["high", "mid", "low"]);
    expect(result[0].items).toHaveLength(3);
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
