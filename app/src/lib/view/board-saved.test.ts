import { describe, expect, it } from "vitest";
import { applyFilters, decodeBoardFilters } from "@/components/board/filters";
import type { ItemWithValues } from "@/lib/boards";
import {
  applySavedKanbanView,
  applySavedPersonScope,
  boardViewSwitchUrl,
  durableNewLeadSavedViewConfig,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  parsePersonScopeInput,
  parseSavedBoardViewConfig,
  presentNewLeadSavedViewConfig,
  savedBoardViewFromRow,
  savedViewUrl,
  systemViewUrl,
} from "./board-saved";

describe("parseSavedBoardViewConfig", () => {
  it("round-trips viewer, team and fixed person scopes without silently widening them", () => {
    expect(parsePersonScopeInput("viewer", null)).toEqual({ personScope: "viewer", personScopeUserId: null });
    expect(parsePersonScopeInput("team", "ignored")).toEqual({ personScope: "team", personScopeUserId: null });
    expect(parsePersonScopeInput("fixed", "member-2")).toEqual({ personScope: "fixed", personScopeUserId: "member-2" });
    expect(() => parsePersonScopeInput("fixed", null)).toThrow("requires a user");
  });
  it("keeps filter, sort, grouping, and layout state", () => {
    const parsed = parseSavedBoardViewConfig({
      kind: "calendar",
      filters: { q: "서울", assignees: ["u1"], byColumn: { status: ["done"] }, sortKey: "date", sortDir: "desc", columnLimit: 8 },
      groupBy: "status",
      layout: { g1: ["name", "status"] },
      hiddenColumns: ["secret"],
      columnOrder: ["name", "status"],
      calendarFieldKey: "date",
      sorts: [{ columnKey: "priority", direction: "asc" }, { columnKey: "date", direction: "desc" }],
      textMode: "wrap",
      focusColumnKey: "status",
    });
    expect(parsed).toMatchObject({ kind: "calendar", groupBy: "status", calendarFieldKey: "date" });
    expect(parsed.filters).toMatchObject({ q: "서울", sortKey: "date", sortDir: "desc", columnLimit: 0, visibleColumnKeys: null });
    expect(parsed.layout.g1).toEqual(["name", "status"]);
    expect(parsed.hiddenColumns).toEqual(["secret"]);
    expect(parsed.sorts).toEqual([{ columnKey: "priority", direction: "asc" }, { columnKey: "date", direction: "desc" }]);
    expect(parsed).toMatchObject({ textMode: "wrap", focusColumnKey: "status" });
  });

  it("신규리드 saved-view는 physical alias를 한 번만 표시하고 저장 때 양쪽 sibling을 복원한다", () => {
    const physical = parseSavedBoardViewConfig({
      kind: "table",
      filters: {
        q: "1,234",
        byColumn: {
          credit_score_ncb: ["812"],
          credit_score_kcb: ["745"],
          revenue_band: ["10억~30억"],
        },
        sortKey: "credit_score_ncb",
        sortDir: "asc",
        visibleColumnKeys: ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"],
      },
      layout: { g1: ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"] },
      hiddenColumns: ["credit_score_ncb", "credit_score_kcb"],
      columnOrder: ["credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million"],
      sorts: [
        { columnKey: "credit_score_ncb", direction: "asc" },
        { columnKey: "credit_score_kcb", direction: "desc" },
        { columnKey: "revenue_3y_million", direction: "desc" },
      ],
      focusColumnKey: "credit_score_kcb",
    });
    const presented = presentNewLeadSavedViewConfig(physical);
    expect(presented.filters.visibleColumnKeys).toEqual(["credit_scores", "revenue_3y_million"]);
    expect(presented.filters.byColumn).toEqual({
      credit_score_ncb: ["812"],
      credit_score_kcb: ["745"],
      revenue_band: ["10억~30억"],
    });
    expect(presented.layout.g1).toEqual(["credit_scores", "revenue_3y_million"]);
    expect(presented.hiddenColumns).toEqual(["credit_scores"]);
    expect(presented.columnOrder).toEqual(["credit_scores", "revenue_3y_million"]);
    expect(presented.sorts).toEqual([
      { columnKey: "credit_scores", direction: "asc" },
      { columnKey: "revenue_3y_million", direction: "desc" },
    ]);
    expect(presented.focusColumnKey).toBe("credit_scores");

    const durable = durableNewLeadSavedViewConfig(presented);
    expect(durable.filters.visibleColumnKeys).toEqual([
      "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million",
    ]);
    expect(durable.filters.byColumn).toEqual(physical.filters.byColumn);
    expect(durable.layout.g1).toEqual([
      "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million",
    ]);
    expect(durable.hiddenColumns).toEqual(["credit_score_ncb", "credit_score_kcb"]);
    expect(durable.sorts.map((sort) => sort.columnKey)).toEqual([
      "credit_score_ncb", "credit_score_kcb", "revenue_band", "revenue_3y_million",
    ]);
    expect(presentNewLeadSavedViewConfig(durable)).toEqual(presented);
  });

  it("keeps physical finance facets as independent AND predicates in flat and kanban", () => {
    const columns = [
      { id: "credit", org_id: "o1", board_id: "b1", key: "credit_scores", label: "신용점수", type: "text", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null },
      { id: "revenue", org_id: "o1", board_id: "b1", key: "revenue_3y_million", label: "매출", type: "number", source: "in", rightPinned: false, options_jsonb: null, sort_order: 1, width: null },
    ] as const;
    const item = (id: string, ncb: number, kcb: number, band: string): ItemWithValues => ({
      id, org_id: "o1", board_id: "b1", group_id: "g1", title: id,
      assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "",
      values: { credit_score_ncb: ncb, credit_score_kcb: kcb, revenue_band: band, revenue_3y_million: null },
    });
    const rows = [
      item("match", 812, 745, "10억~30억"),
      item("ncb-only", 812, 700, "10억~30억"),
      item("kcb-only", 700, 745, "10억~30억"),
      item("wrong-band", 812, 745, "30억 이상"),
    ];
    const physicalFilters = {
      q: "", assignees: [], columnLimit: 0, sortKey: "", sortDir: "asc" as const,
      byColumn: { credit_score_ncb: ["812"], credit_score_kcb: ["745"], revenue_band: ["10억~30억"] },
    };
    const filters = presentNewLeadSavedViewConfig(parseSavedBoardViewConfig({ filters: physicalFilters })).filters;
    expect(filters.byColumn).toEqual(physicalFilters.byColumn);
    expect(applyFilters(rows, [...columns], filters, NEW_LEAD_SAVED_FILTER_PROJECTION).map((row) => row.id))
      .toEqual(["match"]);
    expect(applySavedKanbanView([{ id: "lane", items: rows }], rows, [...columns], filters, NEW_LEAD_SAVED_FILTER_PROJECTION)[0].items.map((row) => row.id))
      .toEqual(["match"]);
  });

  it("dedupes opposite-direction physical sort aliases by presentation key with deterministic first-wins reload", () => {
    const physical = parseSavedBoardViewConfig({
      sorts: [
        { columnKey: "credit_score_ncb", direction: "desc" },
        { columnKey: "credit_score_kcb", direction: "asc" },
      ],
    });
    const presented = presentNewLeadSavedViewConfig(physical);
    expect(presented.filters.sorts).toEqual([{ columnKey: "credit_scores", direction: "desc" }]);
    expect(presented.sorts).toEqual([{ columnKey: "credit_scores", direction: "desc" }]);
    const reloaded = presentNewLeadSavedViewConfig(durableNewLeadSavedViewConfig(presented));
    expect(reloaded).toEqual(presented);
  });

  it("restores filters, sort, layout, hidden and order without touching the shared view row", () => {
    const url = savedViewUrl({
      id: "shared-1", name: "공용", visibility: "shared", ownerId: "other-user",
      isDefault: false, lastUsedAt: null,
      config: { kind: "calendar", filters: { q: "kim", assignees: [], byColumn: { status: ["done"] }, sortKey: "date", sortDir: "desc", columnLimit: 3 }, groupBy: "status", layout: { g1: ["date"] }, hiddenColumns: ["secret"], columnOrder: ["date"], calendarFieldKey: "date", sorts: [{ columnKey: "status", direction: "asc" }, { columnKey: "date", direction: "desc" }], textMode: "wrap", focusColumnKey: "status" },
    }, "https://example.test/boards/b1?view=table");
    expect(url).toContain("savedView=shared-1");
    expect(url).toContain("view=calendar");
    expect(url).toContain("group=status");
    const parsedUrl = new URL(url);
    expect(decodeBoardFilters(parsedUrl.searchParams.get("mwFilters"))).toMatchObject({ q: "kim", sorts: [{ columnKey: "status", direction: "asc" }, { columnKey: "date", direction: "desc" }] });
    expect(JSON.parse(parsedUrl.searchParams.get("mwHidden") ?? "[]")).toEqual(["secret"]);
    expect(JSON.parse(parsedUrl.searchParams.get("mwOrder") ?? "[]")).toEqual(["date"]);
    expect(parsedUrl.searchParams.get("mwText")).toBe("wrap");
    expect(parsedUrl.searchParams.get("mwFocus")).toBe("status");
  });

  it("maps deletion fallback rows through the public SavedBoardView contract", () => {
    expect(savedBoardViewFromRow({ id: "v2", name: "fallback", visibility: "shared", owner_id: "u2", config_jsonb: { kind: "table" }, is_default: true, last_used_at: "2026-08-16T00:00:00Z" })).toMatchObject({
      id: "v2", name: "fallback", visibility: "shared", ownerId: "u2", isDefault: true,
      config: { kind: "table" }, lastUsedAt: "2026-08-16T00:00:00Z",
    });
  });

  it("clears every saved-view parameter when returning to a system view", () => {
    const url = new URL(systemViewUrl("board", "https://example.test/boards/b1?savedView=v1&mwFilters=x&mwLayout=x&mwHidden=x&mwOrder=x&mwSort=x&mwText=wrap&mwFocus=status&group=status&sort=date&calendarField=due"));
    expect(url.searchParams.get("view")).toBe("kanban");
    expect([...url.searchParams.keys()]).toEqual(["view"]);
  });

  it.each(["table", "kanban", "calendar"] as const)("preserves the unified saved-view codec when switching to %s", (kind) => {
    const current = "https://example.test/boards/b1?as=admin&savedView=v1&mwFilters=filters&mwLayout=layout&mwHidden=hidden&mwOrder=order&mwSort=sorts&mwText=wrap&mwFocus=owner&group=status&calendarField=due";
    const url = new URL(boardViewSwitchUrl(kind, current), "https://example.test");
    expect(url.pathname).toBe("/boards/b1");
    expect(url.searchParams.get("view")).toBe(kind);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      as: "admin", savedView: "v1", mwFilters: "filters", mwLayout: "layout",
      mwHidden: "hidden", mwOrder: "order", mwSort: "sorts", mwText: "wrap",
      mwFocus: "owner", group: "status", calendarField: "due",
    });
  });

  it("changes kanban grouping without dropping saved-view or person-scope identity", () => {
    const current = "https://example.test/boards/b1?savedView=team-view&mwFilters=filters&group=status";
    const grouped = new URL(boardViewSwitchUrl("kanban", current, "owner"), "https://example.test");
    expect(grouped.searchParams.get("savedView")).toBe("team-view");
    expect(grouped.searchParams.get("mwFilters")).toBe("filters");
    expect(grouped.searchParams.get("group")).toBe("owner");
    const ungrouped = new URL(boardViewSwitchUrl("kanban", grouped.toString(), ""), "https://example.test");
    expect(ungrouped.searchParams.get("savedView")).toBe("team-view");
    expect(ungrouped.searchParams.has("group")).toBe(false);
  });

  it("applies saved filters and sort to actual kanban card ids, count and order", () => {
    const columns = [
      { id: "c1", org_id: "o1", board_id: "b1", key: "stage", label: "단계", type: "text", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null },
      { id: "c2", org_id: "o1", board_id: "b1", key: "score", label: "점수", type: "number", source: "in", rightPinned: false, options_jsonb: null, sort_order: 1, width: null },
    ] as const;
    const item = (id: string, stage: string, score: number) => ({ id, org_id: "o1", board_id: "b1", group_id: "g1", title: id, assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { stage, score } });
    const rows = [item("b-low", "B", 1), item("a-low", "A", 1), item("a-high", "A", 9)];
    const result = applySavedKanbanView([{ id: "lane", items: rows }], rows, [...columns], { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", sorts: [{ columnKey: "stage", direction: "asc" }, { columnKey: "score", direction: "desc" }], columnLimit: 0 });
    expect(result[0].items.map((row) => row.id)).toEqual(["a-high", "a-low", "b-low"]);
    expect(result[0].items).toHaveLength(3);
  });

  it("saved kanban도 flat과 같은 신규리드 finance projection으로 검색·정렬한다", () => {
    const columns = [
      { id: "credit", org_id: "o1", board_id: "b1", key: "credit_scores", label: "신용점수", type: "text", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null },
      { id: "revenue", org_id: "o1", board_id: "b1", key: "revenue_3y_million", label: "매출", type: "number", source: "in", rightPinned: false, options_jsonb: null, sort_order: 1, width: null },
    ] as const;
    const item = (id: string, revenue: number | null, band = ""): ItemWithValues => ({
      id, org_id: "o1", board_id: "b1", group_id: "g1", title: id,
      assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "",
      values: revenue === null ? { revenue_band: band } : { revenue_3y_million: revenue },
    });
    const rows = [item("ten", 10), item("two", 2), item("grouped", 1234), item("legacy", null, "10억~30억")];
    const filters = { q: "", assignees: [], byColumn: {}, sortKey: "revenue_3y_million", sortDir: "asc" as const, columnLimit: 0 };
    const sorted = applySavedKanbanView([{ id: "lane", items: rows }], rows, [...columns], filters, NEW_LEAD_SAVED_FILTER_PROJECTION);
    expect(sorted[0].items.map((row) => row.id)).toEqual(["two", "ten", "grouped", "legacy"]);
    const searched = applySavedKanbanView(
      [{ id: "lane", items: rows }], rows, [...columns], { ...filters, q: "1,234", sortKey: "" }, NEW_LEAD_SAVED_FILTER_PROJECTION,
    );
    expect(searched[0].items.map((row) => row.id)).toEqual(["grouped"]);
  });

  it("applies viewer, team and fixed person scopes to the actual rendered row set", () => {
    const item = (id: string, owner: string | string[] | null) => ({
      id, org_id: "o1", board_id: "b1", group_id: "g1", title: id,
      assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { owner },
    });
    const rows = [item("mine", "u1"), item("team", ["u2", "u3"]), item("other", "u4")];
    expect(applySavedPersonScope(rows, { personScope: "viewer", personScopeUserId: null }, "u1", "owner", ["u1"]).map((row) => row.id)).toEqual(["mine"]);
    expect(applySavedPersonScope(rows, { personScope: "team", personScopeUserId: null }, "u1", "owner", ["u1", "u2"]).map((row) => row.id)).toEqual(["mine", "team"]);
    expect(applySavedPersonScope(rows, { personScope: "fixed", personScopeUserId: "u4" }, "u1", "owner", ["u4"]).map((row) => row.id)).toEqual(["other"]);
  });

  it.each([
    ["viewer", null, ["u1"], ["mine"]],
    ["team", null, ["u1", "u2"], ["mine", "team"]],
    ["fixed", "u4", ["u4"], ["other"]],
  ] as const)("keeps table, calendar and kanban ids/counts equal for %s scope", (personScope, personScopeUserId, memberIds, expected) => {
    const item = (id: string, owner: string | string[]) => ({ id, org_id: "o1", board_id: "b1", group_id: "g1", title: id, assigned_to: null, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { owner } });
    const rows = [item("mine", "u1"), item("team", ["u2"]), item("other", "u4")];
    const scoped = applySavedPersonScope(rows, { personScope, personScopeUserId }, "u1", "owner", memberIds);
    const kanban = applySavedKanbanView([{ id: "lane", items: rows }], scoped, [], { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", columnLimit: 0 });
    expect(scoped.map((row) => row.id)).toEqual(expected);
    expect(kanban[0].items.map((row) => row.id)).toEqual(expected);
    expect(kanban[0].items).toHaveLength(scoped.length);
  });

  it("uses canonical assigned_to without a person column and fails closed for an unverified fixed member", () => {
    const rows = [{ id: "mine", org_id: "o1", board_id: "b1", group_id: "g1", title: "mine", assigned_to: "u1", deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { owner: "u1" } }];
    expect(applySavedPersonScope(rows, { personScope: "viewer", personScopeUserId: null }, "u1", null, ["u1"])).toEqual(rows);
    expect(applySavedPersonScope(rows, { personScope: "fixed", personScopeUserId: null }, "u1", "owner")).toEqual([]);
  });

  it("rejects malformed values without widening the contract", () => {
    expect(parseSavedBoardViewConfig({ filters: { assignees: "u1", columnLimit: -5 } })).toEqual({
      kind: "board",
      filters: { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc", sorts: [], columnLimit: 0, visibleColumnKeys: null },
      groupBy: "",
      layout: {},
      hiddenColumns: [],
      columnOrder: [],
      calendarFieldKey: null,
      sorts: [],
      textMode: "single",
      focusColumnKey: null,
    });
  });
});
