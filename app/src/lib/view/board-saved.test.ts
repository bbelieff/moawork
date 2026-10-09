import { describe, expect, it } from "vitest";
import { applyFilters, decodeBoardFilters } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";
import { emptyOtherInfoValue, otherInfoFacetFilterKey, updateOtherInfoEntry } from "@/lib/boards/structured-field";
import {
  applySavedKanbanView,
  applySavedPersonScope,
  boardViewSwitchUrl,
  canOverwriteSavedView,
  durableNewLeadSavedViewConfig,
  modeForSavedKind,
  NEW_LEAD_SAVED_FILTER_PROJECTION,
  parsePersonScopeInput,
  parseSavedBoardViewConfig,
  presentNewLeadSavedViewConfig,
  savedBoardViewFromRow,
  savedKindForMode,
  savedViewUrl,
  systemViewUrl,
  tabViewDbKind,
  viewerScopedAssignees,
  type SavedBoardView,
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

  it("private/shared saved facets canonicalize and drive identical flat+kanban other-info rows", () => {
    const exportFacet = otherInfoFacetFilterKey("other_info", "export");
    const certificationFacet = otherInfoFacetFilterKey("other_info", "certifications");
    const config = parseSavedBoardViewConfig({
      filters: {
        byColumn: {
          [exportFacet]: ["true", "missing", "true"],
          [certificationFacet]: ["true"],
        },
      },
    });
    expect(config.filters.byColumn).toEqual({
      [certificationFacet]: ["true"],
      [exportFacet]: ["missing", "true"],
    });
    let matching = updateOtherInfoEntry(emptyOtherInfoValue(), "export", { checked: true });
    matching = updateOtherInfoEntry(matching, "certifications", { checked: true });
    const nonMatching = updateOtherInfoEntry(emptyOtherInfoValue(), "export", { checked: true });
    const rows = [matching, nonMatching].map((other_info, index): ItemWithValues => ({
      id: `row-${index}`, org_id: "o1", board_id: "b1", group_id: "g1", title: `row-${index}`,
      assigned_to: null, deal_id: null, sort_order: index, created_at: "", updated_at: "", values: { other_info },
    }));
    const columns: BoardColumn[] = [{
      id: "other_info", org_id: "o1", board_id: "b1", key: "other_info", label: "기타정보",
      type: "other_info", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
    }];
    expect(applyFilters(rows, columns, config.filters).map((row) => row.id)).toEqual(["row-0"]);
    expect(applySavedKanbanView([{ id: "lane", items: rows }], rows, columns, config.filters)[0].items.map((row) => row.id))
      .toEqual(["row-0"]);
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

  it("keeps canonical duplicates in the viewer scope using actual ownership, never missing or stale EAV", () => {
    const item = (id: string, assigned_to: string | null, owner?: string): ItemWithValues => ({
      id, org_id: "o1", board_id: "b1", group_id: "g1", title: id,
      assigned_to, deal_id: "deal-" + id, sort_order: 0, created_at: "", updated_at: "",
      values: owner === undefined ? {} : { owner },
    });
    const rows = [item("duplicate", "u1"), item("stale-mine", "u1", "u2"),
      item("other", "u2", "u1"), item("unassigned", null, "u1")];
    const view = { personScope: "viewer" as const, personScopeUserId: null };
    expect(applySavedPersonScope(rows, view, "u1", "owner", ["u1", "u2"], true).map((row) => row.id))
      .toEqual(["duplicate", "stale-mine"]);
    expect(applySavedPersonScope(rows, view, "u2", "owner", ["u1", "u2"], true).map((row) => row.id))
      .toEqual(["other"]);
    expect(applySavedPersonScope(rows, view, "u1", "owner", ["u2"], true)).toEqual([]);
    // Ordinary board ownership retains its existing person-column semantics.
    expect(applySavedPersonScope(rows, view, "u1", "owner", ["u1", "u2"]).map((row) => row.id))
      .toEqual(["other", "unassigned"]);
    const custom = [{ ...rows[0], values: { reviewer: "u2" } }];
    expect(applySavedPersonScope(custom, view, "u1", "reviewer", ["u1", "u2"], true)).toEqual([]);
    expect(applySavedPersonScope(custom, view, "u2", "reviewer", ["u1", "u2"], true)).toEqual(custom);
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

describe("#845 6단계 — 보기 방식·메인 테이블·덮어쓰기 권한", () => {
  const view = (kind: string) => ({
    id: "v1", name: "뷰", visibility: "shared" as const, ownerId: "u2", isDefault: false, lastUsedAt: null,
    config: parseSavedBoardViewConfig({ kind, layout: { g1: ["memo", "status"] } }),
  });

  it("표(grouped)·칸반·목록·캘린더가 주소의 view 와 서로 바뀐다 — 예전 table=목록, board=칸반은 그대로 읽는다", () => {
    for (const mode of ["table", "kanban", "flat", "calendar"] as const) {
      expect(modeForSavedKind(savedKindForMode(mode))).toBe(mode);
    }
    expect(parseSavedBoardViewConfig({ kind: "grouped" }).kind).toBe("grouped");
    expect(new URL(savedViewUrl(view("grouped"), "https://app.test/boards/b")).searchParams.get("view")).toBe("table");
    expect(new URL(savedViewUrl(view("table"), "https://app.test/boards/b")).searchParams.get("view")).toBe("flat");
    expect(new URL(savedViewUrl(view("board"), "https://app.test/boards/b")).searchParams.get("view")).toBe("kanban");
    // DB 의 정규화 열은 세 값만 받는다(072 check) — 표는 'board' 로 둔다. 읽을 때는 config_jsonb 가 정본이다.
    expect(tabViewDbKind("grouped")).toBe("board");
    expect(tabViewDbKind("table")).toBe("flat");
    expect(tabViewDbKind("calendar")).toBe("cal");
  });

  it("칸 순서는 보드 전체의 것 — 저장된 뷰를 열어도 예전 layout 으로 보드 순서를 덮지 않는다", () => {
    const url = new URL(savedViewUrl(view("grouped"), "https://app.test/boards/b?mwLayout=%7B%7D"));
    expect(url.searchParams.has("mwLayout")).toBe(false);
  });

  it("「메인 테이블」 은 묶인 메인 표(?view=table)를 연다 — 묶지 않은 목록이 아니다", () => {
    const url = new URL(systemViewUrl("table", "https://app.test/boards/b?savedView=v1&view=flat&mwFilters=x&group=status"));
    expect(url.searchParams.get("view")).toBe("table");
    expect([...url.searchParams.keys()]).toEqual(["view"]);
  });

  it("뷰를 덮어쓰거나 지우는 것은 만든 사람과 워크스페이스 소유자·관리자만", () => {
    expect(canOverwriteSavedView({ ownerId: "u1" }, { userId: "u1", role: "member" })).toBe(true);
    expect(canOverwriteSavedView({ ownerId: "u2" }, { userId: "u1", role: "member" })).toBe(false);
    expect(canOverwriteSavedView({ ownerId: "u2" }, { userId: "u1", role: "team_lead" })).toBe(false);
    expect(canOverwriteSavedView({ ownerId: "u2" }, { userId: "u1", role: "admin" })).toBe(true);
    expect(canOverwriteSavedView({ ownerId: "u2" }, { userId: "u1", role: "owner" })).toBe(true);
    expect(canOverwriteSavedView({ ownerId: null }, { userId: "u1", role: "member" })).toBe(false);
  });
});

describe("#845 7단계 — 나눠 보기는 뷰 설정의 groupBy 그대로", () => {
  it("저장된 표 뷰의 groupBy(사람·목록 칸)가 주소 group 으로 열리고, 신규리드 durable/present 변환을 지나도 같은 칸이다", () => {
    const config = parseSavedBoardViewConfig({ kind: "grouped", groupBy: "collaborators" });
    expect(config.groupBy).toBe("collaborators");
    const view = { id: "v1", name: "뷰", visibility: "private" as const, ownerId: "u1", isDefault: false, lastUsedAt: null, config };
    expect(new URL(savedViewUrl(view, "https://app.test/boards/b")).searchParams.get("group")).toBe("collaborators");
    expect(presentNewLeadSavedViewConfig(config).groupBy).toBe("collaborators");
    expect(durableNewLeadSavedViewConfig(presentNewLeadSavedViewConfig(config)).groupBy).toBe("collaborators");
    // 보드별(빈 값)은 주소에서 group 을 지운다.
    const plain = { ...view, config: parseSavedBoardViewConfig({ kind: "grouped" }) };
    expect(new URL(savedViewUrl(plain, "https://app.test/boards/b?group=owner")).searchParams.has("group")).toBe(false);
  });
});

describe("저장된 뷰 주소 — 캘린더 날짜 칸 · 보는 사람 기준 담당", () => {
  const view = (id: string, config: Record<string, unknown>, over: Partial<SavedBoardView> = {}): SavedBoardView => ({
    id, name: id, visibility: "shared", ownerId: "u1", isDefault: false, lastUsedAt: null,
    config: parseSavedBoardViewConfig(config), ...over,
  });

  it("뷰의 캘린더 날짜 칸을 주소에 싣고, 날짜 칸이 없는 뷰로 옮기면 앞 뷰의 칸을 지운다", () => {
    const contract = new URL(savedViewUrl(view("a", { kind: "calendar", calendarFieldKey: "contract_date" }), "https://app.test/boards/b?view=table"));
    expect(contract.searchParams.get("calendarField")).toBe("contract_date");
    const next = new URL(savedViewUrl(view("b", { kind: "calendar" }), contract.toString()));
    expect(next.searchParams.has("calendarField")).toBe(false);
  });

  it("보는 사람 기준(viewer) 뷰는 담당을 여는 사람으로 채우고, 사람 id 를 박은 뷰·다른 범위는 그대로 둔다", () => {
    const viewer = view("me", { kind: "grouped" }, { personScope: "viewer", personScopeUserId: null });
    const filters = (url: string) => decodeBoardFilters(new URL(url).searchParams.get("mwFilters"));
    expect(filters(savedViewUrl(viewer, "https://app.test/boards/b", "u2")).assignees).toEqual(["u2"]);
    expect(filters(savedViewUrl(viewer, "https://app.test/boards/b")).assignees).toEqual([]);
    expect(viewerScopedAssignees({ ...viewer, personScope: "team" }, "u2")).toEqual([]);
    expect(viewerScopedAssignees(view("x", { filters: { assignees: ["u3"] } }, { personScope: "viewer" }), "u2")).toEqual(["u3"]);
  });

  it("칸반 사람 칸 「이름순」 은 이름표로 줄 세운다(계정 id 순이 아니다)", () => {
    const owner = { id: "c-owner", org_id: "o1", board_id: "b1", key: "owner", label: "담당자", type: "person", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null } as BoardColumn;
    const card = (id: string, ownerId: string): ItemWithValues => ({ id, org_id: "o1", board_id: "b1", group_id: "g1", title: id, assigned_to: ownerId, deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { owner: ownerId } });
    const rows = [card("sky", "u-1"), card("garam", "u-2")];
    const filters = { q: "", assignees: [], byColumn: {}, sortKey: "", sortDir: "asc" as const, sorts: [{ columnKey: "owner", direction: "asc" as const }], columnLimit: 0 };
    const labels = { "u-1": "하늘", "u-2": "가람" };
    expect(applySavedKanbanView([{ id: "lane", items: rows }], rows, [owner], filters)[0].items.map((row) => row.id)).toEqual(["sky", "garam"]);
    expect(applySavedKanbanView([{ id: "lane", items: rows }], rows, [owner], filters, undefined, labels)[0].items.map((row) => row.id)).toEqual(["garam", "sky"]);
  });
});
