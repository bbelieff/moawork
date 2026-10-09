import { describe, expect, it } from "vitest";
import { decodeBoardFilters, EMPTY_FILTERS, type BoardFilterState } from "@/components/board/filters";
import {
  parseSavedBoardViewConfig,
  savedViewUrl,
  type SavedBoardViewConfig,
} from "./board-saved";
import {
  applicableGroupBy,
  assigneeChipValue,
  changedConditions,
  conditionsFromFilters,
  conditionsFromSavedConfig,
  conditionsFromSavedView,
  draftPersonScope,
  draftViewConfig,
  filtersForConditions,
  MAIN_TABLE_CONDITIONS,
  viewCountText,
  withSearchText,
} from "./view-conditions";

const ALL = ["status", "owner", "amount", "memo"];
const people = [{ value: "me", label: "나담당" }, { value: "u2", label: "가담당" }];

function config(over: Partial<SavedBoardViewConfig> = {}): SavedBoardViewConfig {
  return parseSavedBoardViewConfig({ kind: "grouped", ...over });
}

describe("#845 6단계 — 바뀐 조건 세기", () => {
  it("메인 테이블 기준은 «조건 없음» 표다 — 아무것도 안 걸면 바뀐 것이 없다", () => {
    expect(changedConditions(conditionsFromFilters(EMPTY_FILTERS, "table", "", ALL), MAIN_TABLE_CONDITIONS)).toEqual([]);
    // 칸반으로 바꾸면 보기 방식 하나가 바뀐다.
    expect(changedConditions(conditionsFromFilters(EMPTY_FILTERS, "kanban", "", ALL), MAIN_TABLE_CONDITIONS)).toEqual(["mode"]);
  });

  it("찾기(검색어)는 저장하지 않고 바뀜으로 세지 않는다", () => {
    const current = conditionsFromFilters({ ...EMPTY_FILTERS, q: "서울" }, "table", "", ALL);
    expect(changedConditions(current, MAIN_TABLE_CONDITIONS)).toEqual([]);
  });

  it("칸 순서(layout·columnOrder)는 보드 전체의 것이라 비교하지 않는다", () => {
    const saved = config({ layout: { g1: ["memo", "status"] }, columnOrder: ["memo", "status"] });
    const other = config({ layout: { g1: ["status", "memo"] }, columnOrder: ["status", "memo"] });
    expect(changedConditions(conditionsFromSavedConfig(other, ALL), conditionsFromSavedConfig(saved, ALL))).toEqual([]);
  });

  it("필터는 칸마다 하나, 담당·정렬·보이는 칸은 하나씩 센다", () => {
    const current = conditionsFromFilters({
      ...EMPTY_FILTERS,
      assignees: ["me"],
      byColumn: { status: ["new"], owner: ["u2"] },
      sorts: [{ columnKey: "amount", direction: "desc" }],
      visibleColumnKeys: ["status", "owner"],
    }, "table", "", ALL);
    expect(changedConditions(current, MAIN_TABLE_CONDITIONS)).toEqual([
      "assignees", "filter:owner", "filter:status", "sorts", "columns",
    ]);
  });

  it("같은 조건을 다른 모양으로 들고 있어도 같다고 본다(값 순서·예전 sortKey·모든 칸 체크)", () => {
    const saved = config({
      filters: { ...EMPTY_FILTERS, byColumn: { status: ["b", "a"] }, sortKey: "amount", sortDir: "desc" },
    });
    const current = conditionsFromFilters({
      ...EMPTY_FILTERS,
      byColumn: { status: ["a", "b"] },
      sorts: [{ columnKey: "amount", direction: "desc" }],
      // 모든 칸을 하나씩 체크한 것은 «모두 보기» 와 같다.
      visibleColumnKeys: [...ALL].reverse(),
    }, "table", "", ALL);
    expect(changedConditions(current, conditionsFromSavedConfig(saved, ALL))).toEqual([]);
  });

  it("정렬 우선순위가 바뀌면 바뀐 것이다", () => {
    const saved = config({ sorts: [{ columnKey: "amount", direction: "desc" }, { columnKey: "status", direction: "asc" }] });
    const current = conditionsFromFilters({
      ...EMPTY_FILTERS,
      sorts: [{ columnKey: "status", direction: "asc" }, { columnKey: "amount", direction: "desc" }],
    }, "table", "", ALL);
    expect(changedConditions(current, conditionsFromSavedConfig(saved, ALL))).toEqual(["sorts"]);
  });

  it("되돌리기는 기준 조건으로 돌리되 지금 검색어는 둔다", () => {
    const baseline = conditionsFromSavedConfig(config({ filters: { ...EMPTY_FILTERS, assignees: ["u2"] } }), ALL);
    const reverted = filtersForConditions(baseline, { ...EMPTY_FILTERS, q: "찾던 말", byColumn: { status: ["x"] } });
    expect(reverted).toMatchObject({ q: "찾던 말", assignees: ["u2"], byColumn: {}, sorts: [], visibleColumnKeys: null });
    expect(changedConditions(conditionsFromFilters(reverted, "table", "", ALL), baseline)).toEqual([]);
  });
});

describe("#845 6단계 — 예전 저장값을 그대로 읽는다", () => {
  const legacy = {
    kind: "board",
    filters: { q: "kim", assignees: [], byColumn: { status: ["done"] }, sortKey: "amount", sortDir: "desc", columnLimit: 3 },
    groupBy: "status",
    layout: { g1: ["memo"] },
    hiddenColumns: ["memo"],
    textMode: "wrap",
    focusColumnKey: "status",
  };

  it("q·sortKey·hiddenColumns·layout·groupBy·textMode·focusColumnKey 를 읽고, 저장된 검색어는 찾기 칸에 넣되 바뀜으로 세지 않는다", () => {
    const parsed = parseSavedBoardViewConfig(legacy);
    expect(parsed).toMatchObject({
      kind: "board", groupBy: "status", hiddenColumns: ["memo"], layout: { g1: ["memo"] },
      textMode: "wrap", focusColumnKey: "status", sorts: [{ columnKey: "amount", direction: "desc" }],
    });
    const url = new URL(savedViewUrl({
      id: "legacy", name: "예전 뷰", visibility: "shared", ownerId: "u2", config: parsed, isDefault: false, lastUsedAt: null,
    }, "https://app.test/boards/b?view=table"));
    // 예전 «보드» 뷰는 칸반으로 연다(구분할 수 없으니 그대로).
    expect(url.searchParams.get("view")).toBe("kanban");
    const fromUrl = decodeBoardFilters(url.searchParams.get("mwFilters"));
    expect(fromUrl.q).toBe("kim");
    const current = conditionsFromFilters(fromUrl, "kanban", url.searchParams.get("group") ?? "", ALL);
    expect(changedConditions(current, conditionsFromSavedConfig(parsed, ALL))).toEqual([]);
  });
});

describe("#845 6단계 — 저장할 설정", () => {
  const params = new URLSearchParams("mwHidden=%5B%22memo%22%5D&mwOrder=%5B%22status%22%2C%22amount%22%5D&mwText=wrap");
  const filters: BoardFilterState = {
    ...EMPTY_FILTERS,
    q: "찾기만",
    byColumn: { status: ["new"] },
    sortKey: "amount",
    sortDir: "desc",
  };

  it("표에서 저장하면 보기 방식이 «표»(grouped)다 — 칸반으로 저장되던 버그", () => {
    const draft = draftViewConfig({ mode: "table", filters, groupBy: "", params: new URLSearchParams(), active: null });
    expect(draft.kind).toBe("grouped");
    expect(new URL(savedViewUrl({
      id: "v", name: "표", visibility: "private", ownerId: "me", config: draft, isDefault: false, lastUsedAt: null,
    }, "https://app.test/boards/b")).searchParams.get("view")).toBe("table");
    expect(draftViewConfig({ mode: "kanban", filters, groupBy: "", params, active: null }).kind).toBe("board");
  });

  it("검색어는 빼고 저장한다 · 정렬은 sorts 로 · 칸 배치(layout)는 담지 않는다", () => {
    const draft = draftViewConfig({ mode: "table", filters, groupBy: "", params, active: null });
    expect(draft.filters.q).toBe("");
    expect(draft.filters.sortKey).toBe("");
    expect(draft.sorts).toEqual([{ columnKey: "amount", direction: "desc" }]);
    expect(draft.filters.byColumn).toEqual({ status: ["new"] });
    expect(draft.layout).toEqual({});
    expect(draft.hiddenColumns).toEqual(["memo"]);
    expect(draft.columnOrder).toEqual(["status", "amount"]);
    expect(draft.textMode).toBe("wrap");
  });

  it("주소에 없는 표시값은 지금 뷰의 것을 잇는다", () => {
    const active = config({ hiddenColumns: ["owner"], columnOrder: ["owner"], textMode: "wrap", focusColumnKey: "amount", calendarFieldKey: "due" });
    const draft = draftViewConfig({ mode: "calendar", filters, groupBy: "", params: new URLSearchParams(), active });
    expect(draft).toMatchObject({ kind: "calendar", hiddenColumns: ["owner"], columnOrder: ["owner"], textMode: "wrap", focusColumnKey: "amount", calendarFieldKey: "due" });
  });

  it("뷰를 바꿔도 찾던 글자는 주소에 남긴다", () => {
    const url = withSearchText("https://app.test/boards/b?savedView=v&mwFilters=%7B%7D", "서울");
    expect(decodeBoardFilters(new URL(url).searchParams.get("mwFilters")).q).toBe("서울");
    expect(withSearchText("https://app.test/boards/b", "  ")).toBe("https://app.test/boards/b");
  });
});

describe("#845 6단계 — 칩·건수 글자", () => {
  it("담당 칩: 전체 · 나 · 이름 · N명", () => {
    expect(assigneeChipValue([], people, "me")).toBe("전체");
    expect(assigneeChipValue(["me"], people, "me")).toBe("나");
    expect(assigneeChipValue(["u2"], people, "me")).toBe("가담당");
    expect(assigneeChipValue(["me", "u2"], people, "me")).toBe("2명");
  });

  it("「내 담당 · 40건 중 6건」 — 줄어든 행이 조용히 사라지지 않는다", () => {
    expect(viewCountText({ filters: { ...EMPTY_FILTERS, assignees: ["me"] }, people, currentUserId: "me", matched: 6, total: 40 }))
      .toBe("내 담당 · 40건 중 6건");
    expect(viewCountText({ filters: EMPTY_FILTERS, people, currentUserId: "me", matched: 40, total: 40 })).toBe("40건");
    expect(viewCountText({
      filters: { ...EMPTY_FILTERS, assignees: ["u2"], byColumn: { status: ["a"], memo: [] }, q: "서울" },
      people, currentUserId: "me", matched: 2, total: 40,
    })).toBe("가담당 담당 · 필터 1 · 찾기 “서울” · 40건 중 2건");
  });
});

describe("나눠 보기 기준 — 이 화면이 걸 수 있는 값만 견준다", () => {
  const saved = (groupBy: string, kind = "grouped") => ({ config: config({ kind, groupBy } as Partial<SavedBoardViewConfig>), personScope: "none" as const });

  it("목록·캘린더(나눠 보기 없음)와 지워진·종류가 바뀐 칸은 보드별로 본다 — 손대지 않은 예전 뷰는 바뀜이 아니다", () => {
    const flat = conditionsFromSavedView(saved("status", "table"), { allColumnKeys: ALL, groupByKeys: [] });
    expect(flat.groupBy).toBe("");
    expect(changedConditions(conditionsFromFilters(EMPTY_FILTERS, "flat", "", ALL), flat)).toEqual([]);
    expect(conditionsFromSavedView(saved("gone"), { allColumnKeys: ALL, groupByKeys: ["status", "owner"] }).groupBy).toBe("");
    expect(conditionsFromSavedView(saved("owner"), { allColumnKeys: ALL, groupByKeys: ["status", "owner"] }).groupBy).toBe("owner");
  });

  it("신규리드 칸반: 화면에 보이는 합성 key(other_info)가 아니라 저장값 physical key 로 맞춘다", () => {
    const presented = conditionsFromSavedView(saved("other_info", "board"), {
      allColumnKeys: ALL, groupByKeys: ["closed_business", "export_status"], groupByAliases: ["export_status"],
    });
    expect(presented.groupBy).toBe("export_status");
    expect(applicableGroupBy(["revenue_3y_million", "revenue_band"], ["revenue_band"])).toBe("revenue_band");
    expect(applicableGroupBy([null, undefined, ""], [""])).toBe("");
  });

  it("되돌리기는 같은 자리로 돌아오고 다시 바뀜이 되지 않는다", () => {
    const baseline = conditionsFromSavedView(saved("status", "table"), { allColumnKeys: ALL, groupByKeys: [] });
    const changed = { ...EMPTY_FILTERS, sorts: [{ columnKey: "memo", direction: "asc" as const }] };
    const reverted = filtersForConditions(baseline, changed);
    expect(changedConditions(conditionsFromFilters(reverted, "flat", "", ALL), baseline)).toEqual([]);
  });
});

describe("D26 — 담당 · 나 는 보는 사람 기준", () => {
  const viewer = { personScope: "viewer" as const, personScopeUserId: null, config: config() };

  it("보는 사람 기준 뷰의 담당 기준은 «지금 보는 사람» 이다 — 주소의 담당과 같으면 바뀜이 아니다", () => {
    const forB = conditionsFromSavedView(viewer, { allColumnKeys: ALL, groupByKeys: [], currentUserId: "u2" });
    expect(forB.assignees).toEqual(["u2"]);
    const url = new URL(savedViewUrl({ id: "v", name: "내 담당", visibility: "shared", ownerId: "me", isDefault: false, lastUsedAt: null, ...viewer }, "https://app.test/boards/b", "u2"));
    const opened = decodeBoardFilters(url.searchParams.get("mwFilters"));
    expect(opened.assignees).toEqual(["u2"]);
    expect(assigneeChipValue(opened.assignees, people, "u2")).toBe("나");
    expect(changedConditions(conditionsFromFilters(opened, "table", "", ALL), forB)).toEqual([]);
    // 담당이 박힌 뷰·사람 범위가 없는 뷰는 그대로다.
    expect(conditionsFromSavedView({ ...viewer, config: config({ filters: { ...EMPTY_FILTERS, assignees: ["u2"] } }) }, { groupByKeys: [], currentUserId: "me" }).assignees).toEqual(["u2"]);
    expect(conditionsFromSavedView({ ...viewer, personScope: "none" }, { groupByKeys: [], currentUserId: "me" }).assignees).toEqual([]);
  });

  it("「나」 하나만 걸린 조건은 viewer 로 담고 id 를 뺀다 · 풀면 viewer 도 푼다 · 팀·고정은 잇는다", () => {
    const mine = config({ filters: { ...EMPTY_FILTERS, assignees: ["me"] } });
    expect(draftPersonScope(mine, null, "me")).toMatchObject({ personScope: "viewer", personScopeUserId: null, config: { filters: { assignees: [] } } });
    // 다른 사람이 들어 있으면 그대로 담는다(사람을 고른 것이다).
    const two = config({ filters: { ...EMPTY_FILTERS, assignees: ["me", "u2"] } });
    expect(draftPersonScope(two, null, "me")).toMatchObject({ personScope: "none", config: { filters: { assignees: ["me", "u2"] } } });
    expect(draftPersonScope(config(), viewer, "me")).toMatchObject({ personScope: "none" });
    expect(draftPersonScope(config(), { ...viewer, personScope: "team" }, "me")).toMatchObject({ personScope: "team", personScopeUserId: null });
    expect(draftPersonScope(config(), { ...viewer, personScope: "fixed", personScopeUserId: "u2" }, "me")).toMatchObject({ personScope: "fixed", personScopeUserId: "u2" });
    // 담당이 박힌 예전 viewer 뷰는 손대지 않으면 viewer 그대로다.
    const legacy = { ...viewer, config: config({ filters: { ...EMPTY_FILTERS, assignees: ["u2"] } }) };
    expect(draftPersonScope(legacy.config, legacy, "me")).toMatchObject({ personScope: "viewer" });
  });
});
