// @vitest-environment jsdom
/**
 * #845 6단계(2026-10-08 대표 결정) — 보기 줄 하나(뷰 탭 · 보기 조건 칩 · 저장 · 찾기)를 «그려진 결과와 행동» 으로 잰다.
 *   · 찾기는 바뀜이 아니다 · 조건을 바꾸면 탭에 점 + 「바뀐 조건 N개」, 되돌리기·저장 ▾
 *   · 「이 뷰에 저장」 은 만든 사람·관리자에게만(서버 거절은 route.test 가 잰다)
 *   · 새 뷰로 저장: 이름 · 조건 칩 · 나만/팀 — 검색어는 빼고 저장
 *   · 예전 뷰의 검색어는 찾기 칸에 들어가지만 바뀜으로 세지 않는다
 *   · 「메인 테이블」 은 묶인 메인 표(?view=table)를 연다 · 많은 탭은 「더보기」
 */
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ navigateTo: vi.fn(), push: vi.fn() }));
vi.mock("@/components/view/use-saved-views", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/view/use-saved-views")>()),
  navigateTo: nav.navigateTo,
}));
// 보기 방식·칸반 나눠 보기는 다시 읽지 않는 이동(router.push)이다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));

import { BoardViewBar } from "./BoardViewBar";
import { applyFilters, decodeBoardFilters, EMPTY_FILTERS, type BoardFilterState } from "./filters";
import { applySavedPersonScope, parseSavedBoardViewConfig, savedViewUrl, type SavedBoardView } from "@/lib/view/board-saved";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const columns = [
  {
    id: "c-status", org_id: "o", board_id: "b", key: "status", label: "상태", type: "select", source: "in",
    rightPinned: false, sort_order: 0, width: null, move_rule_jsonb: null,
    options_jsonb: { options: [{ id: "new", label: "신규", order: 0 }, { id: "done", label: "완료", order: 1 }] },
  },
  {
    id: "c-memo", org_id: "o", board_id: "b", key: "memo", label: "메모", type: "text", source: "in",
    rightPinned: false, sort_order: 1, width: null, move_rule_jsonb: null, options_jsonb: null,
  },
] as BoardColumn[];
const row = (id: string, assigned: string | null, status: string): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: "g", title: `회사 ${id}`, assigned_to: assigned, deal_id: null,
  sort_order: 0, created_at: "", updated_at: "", values: { status, memo: "" },
});
const rows = [row("1", "me", "new"), row("2", "u2", "done"), row("3", null, "new")];
const people = [{ value: "me", label: "나담당" }, { value: "u2", label: "가담당" }];

function view(id: string, over: Partial<SavedBoardView> = {}, config: Record<string, unknown> = {}): SavedBoardView {
  return {
    id, name: `뷰 ${id}`, visibility: "shared", ownerId: "other", isDefault: false, lastUsedAt: null, canEdit: false,
    config: parseSavedBoardViewConfig({ kind: "grouped", ...config }),
    ...over,
  };
}

type FetchCall = { url: string; method: string; body: unknown };
let calls: FetchCall[] = [];
let listed: SavedBoardView[] = [];

beforeEach(() => {
  calls = [];
  listed = [];
  window.history.replaceState(null, "", "/boards/b?view=table");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    let data: unknown = null;
    if (method === "GET") data = listed;
    else if (method === "POST") data = { ...view("new-1", { name: body.name, visibility: body.visibility, ownerId: "me", canEdit: true, personScope: body.personScope, personScopeUserId: body.personScopeUserId }), config: parseSavedBoardViewConfig(body.config) };
    else if (method === "PATCH") {
      const target = listed.find((candidate) => url.endsWith(candidate.id));
      data = { ...target, config: body.config ? parseSavedBoardViewConfig(body.config) : target?.config };
    } else if (method === "DELETE") data = { deleted: true, fallback: listed.find((candidate) => !url.endsWith(candidate.id)) ?? null };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  nav.navigateTo.mockReset();
  nav.push.mockReset();
});

type BarProps = ComponentProps<typeof BoardViewBar>;

function Harness({ initial = EMPTY_FILTERS, ...rest }: Partial<BarProps> & { initial?: BoardFilterState }) {
  const [filters, setFilters] = useState(initial);
  return (
    <BoardViewBar
      boardId="b"
      currentUserId="me"
      mode="table"
      filters={filters}
      onChange={setFilters}
      columns={columns}
      rows={rows}
      people={people}
      matched={applyFilters(rows, columns, filters).length}
      total={rows.length}
      loadSavedViews
      {...rest}
    />
  );
}

async function mount(props: Partial<BarProps> & { initial?: BoardFilterState } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness {...props} />));
  // 저장된 뷰 목록을 받는다.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return host;
}

const click = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
  await act(async () => { await Promise.resolve(); });
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const chip = (host: ParentNode, id: string) => host.querySelector<HTMLButtonElement>(`[data-view-chip="${id}"]`);
const search = (host: ParentNode) => host.querySelector<HTMLInputElement>('[data-board-toolbar] input[aria-label="찾기"]')!;
const menuLabels = () => [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((item) => item.textContent);
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find((item) => item.textContent === label);
const dirtyDot = (host: ParentNode) => host.querySelector("[data-view-dirty-dot]");

describe("메인 테이블 — 조건 없음이 기준", () => {
  it("찾기를 써도 바뀜이 아니다 — 점·되돌리기·저장이 없고 건수만 줄어든다", async () => {
    const host = await mount();
    expect(host.querySelector('[data-view-tab="main"]')!.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("3건");
    await type(search(host), "회사 1");
    expect(dirtyDot(host)).toBeNull();
    expect(host.querySelector("[data-view-dirty-actions]")).toBeNull();
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("찾기 “회사 1” · 3건 중 1건");
  });

  it("담당 · 나 를 고르면 「내 담당 · 3건 중 1건」, 탭에 점과 「바뀐 조건 1개」, 되돌리면 깨끗하다", async () => {
    const host = await mount();
    await click(chip(host, "assignee"));
    const panel = host.querySelector("#board-filter-panel")!;
    expect(panel.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("담당");
    await click([...panel.querySelectorAll("[role=tabpanel] button")].find((button) => button.textContent?.replace("✓", "") === "나"));
    expect(chip(host, "assignee")!.textContent).toBe("담당 · 나");
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("내 담당 · 3건 중 1건");
    expect(dirtyDot(host)).not.toBeNull();
    expect(host.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");

    // 메인 테이블은 덮어쓸 수 없다 — 「새 뷰로 저장…」 과 「되돌리기」 뿐이다.
    await click(host.querySelector("[data-view-save]"));
    expect(menuLabels()).toEqual(["새 뷰로 저장…", "되돌리기"]);
    await click(menuItem("되돌리기"));
    expect(dirtyDot(host)).toBeNull();
    expect(chip(host, "assignee")!.textContent).toBe("담당 · 전체");
  });

  it("「표 ▾」 에서 칸반을 고르면 같은 조건으로 칸반을 연다 — 다시 읽지 않는 이동(router.push)", async () => {
    window.history.replaceState(null, "", "/w/acme/boards/b?view=table&mwFilters=%7B%22assignees%22%3A%5B%22me%22%5D%7D");
    const host = await mount();
    await click(chip(host, "mode"));
    expect(menuLabels()).toEqual(["표", "칸반"]);
    await click(menuItem("칸반"));
    expect(nav.navigateTo).not.toHaveBeenCalled();
    const next = new URL(nav.push.mock.calls[0][0], "https://app.test");
    expect(next.pathname).toBe("/w/acme/boards/b");
    expect(next.searchParams.get("view")).toBe("kanban");
    expect(decodeBoardFilters(next.searchParams.get("mwFilters")).assignees).toEqual(["me"]);
  });

  it("「표 ▾」 는 날짜 칸이 있을 때만 캘린더를 준다", async () => {
    const host = await mount({ calendarAvailable: true });
    await click(chip(host, "mode"));
    expect(menuLabels()).toEqual(["표", "칸반", "캘린더"]);
    await click(menuItem("캘린더"));
    expect(new URL(nav.push.mock.calls[0][0], "https://app.test").searchParams.get("view")).toBe("calendar");
  });
});

describe("저장된 뷰 — 덮어쓰기 권한", () => {
  it("남이 만든 팀 뷰는 「이 뷰에 저장」 이 없고 「새 뷰로 저장」 만 있다", async () => {
    listed = [view("team", { canEdit: false })];
    const host = await mount({ activeViewId: "team" });
    const tab = host.querySelector('[data-view-tab="team"]')!;
    expect(tab.getAttribute("aria-current")).toBe("page");
    expect(tab.textContent).toContain("팀");
    // 남의 뷰에는 ▾(이름 바꾸기·지우기)가 없다.
    expect(host.querySelector('[aria-label="뷰 team 뷰 메뉴"]')).toBeNull();
    await click(chip(host, "sort"));
    await click(host.querySelector('#board-filter-panel [aria-label="상태 가나다순"]'));
    expect(chip(host, "sort")!.textContent).toBe("정렬1");
    await click(host.querySelector("[data-view-save]"));
    expect(menuLabels()).toEqual(["새 뷰로 저장…", "되돌리기"]);
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([]);
  });

  it("만든 사람은 「이 뷰에 저장」 으로 덮어쓴다 — 찾기 글자는 빼고 보기 방식은 «표» 로", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true, visibility: "private" })];
    const host = await mount({ activeViewId: "mine" });
    expect(host.querySelector('[data-view-tab="mine"]')!.textContent).toContain("나만");
    await type(search(host), "찾던 말");
    await click(chip(host, "columns"));
    await click([...host.querySelectorAll("#board-filter-panel label")].find((label) => label.textContent === "메모")?.querySelector("input"));
    expect(chip(host, "columns")!.textContent).toBe("칸 숨기기1");
    await click(host.querySelector("[data-view-save]"));
    expect(menuLabels()).toEqual(["이 뷰에 저장", "새 뷰로 저장…", "되돌리기"]);
    await click(menuItem("이 뷰에 저장"));
    const saved = calls.find((call) => call.method === "PATCH")!;
    expect(saved.url).toBe("/api/tab-views/mine");
    const config = (saved.body as { config: { kind: string; filters: BoardFilterState } }).config;
    expect(config.kind).toBe("grouped");
    expect(config.filters.q).toBe("");
    expect(config.filters.visibleColumnKeys).toEqual(["status"]);
    // 저장한 조건이 새 기준이 된다 — 점이 사라진다. 찾기 글자는 그대로 남는다.
    expect(dirtyDot(host)).toBeNull();
    expect(search(host).value).toBe("찾던 말");
  });
});

describe("새 뷰로 저장", () => {
  it("이름 · 담을 조건 칩 · 나만/팀 — 팀으로 저장하면 공유로 만들고, 검색어는 빼고 저장하되 새 뷰 주소에 남긴다", async () => {
    const host = await mount();
    await type(search(host), "서울");
    await click(chip(host, "assignee"));
    await click([...host.querySelectorAll("#board-filter-panel label")].find((label) => label.textContent?.startsWith("가담당"))?.querySelector("input"));
    await click(host.querySelector('[data-view-tab-create]'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 뷰로 저장"]')!;
    expect(dialog).not.toBeNull();
    expect([...dialog.querySelectorAll('[aria-label="담을 조건"] li')].map((item) => item.textContent)).toEqual(["표", "담당 · 가담당"]);
    // 풀이 글 없이 짧게 — 이름 칸 · 칩 · 나만/팀 · 저장.
    expect(dialog.querySelectorAll("p")).toHaveLength(0);
    const radios = [...dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(radios.map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([["나만", "true"], ["팀", "false"]]);
    await type(dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!, "가담당 업체");
    await click(radios[1]);
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const created = calls.find((call) => call.method === "POST")!;
    expect(created.body).toMatchObject({ boardId: "b", name: "가담당 업체", visibility: "shared", personScope: "none" });
    const config = (created.body as { config: { kind: string; filters: BoardFilterState } }).config;
    expect(config.kind).toBe("grouped");
    expect(config.filters.q).toBe("");
    expect(config.filters.assignees).toEqual(["u2"]);

    const next = new URL(nav.navigateTo.mock.calls[0][0]);
    expect(next.searchParams.get("savedView")).toBe("new-1");
    expect(next.searchParams.get("view")).toBe("table");
    expect(decodeBoardFilters(next.searchParams.get("mwFilters"))).toMatchObject({ q: "서울", assignees: ["u2"] });
  });

  it("나만으로 저장하면 private", async () => {
    const host = await mount();
    await click(host.querySelector('[data-view-tab-create]'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 뷰로 저장"]')!;
    await type(dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!, "내 것");
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(calls.find((call) => call.method === "POST")!.body).toMatchObject({ name: "내 것", visibility: "private" });
  });
});

describe("예전 뷰 · 탭", () => {
  it("예전 뷰에 저장된 검색어는 찾기 칸에 들어가지만 바뀜으로 세지 않는다", async () => {
    const legacy = view("legacy", {}, { kind: "board", filters: { q: "kim", byColumn: { status: ["new"] }, sortKey: "memo", sortDir: "desc" }, layout: { g: ["memo"] } });
    listed = [legacy];
    const url = new URL(savedViewUrl(legacy, "https://app.test/boards/b"));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    const host = await mount({ activeViewId: "legacy", mode: "kanban", initial: decodeBoardFilters(url.searchParams.get("mwFilters")) });
    expect(search(host).value).toBe("kim");
    expect(chip(host, "mode")!.textContent).toBe("칸반");
    expect(chip(host, "filter")!.textContent).toBe("필터1");
    expect(dirtyDot(host)).toBeNull();
    expect(host.querySelector("[data-view-dirty-actions]")).toBeNull();
  });

  it("「메인 테이블」 탭은 묶인 메인 표(?view=table)를 연다", async () => {
    listed = [view("team")];
    window.history.replaceState(null, "", "/boards/b?view=flat&savedView=team");
    const host = await mount({ activeViewId: "team", mode: "flat" });
    await click(host.querySelector('[data-view-tab="main"]'));
    const next = new URL(nav.navigateTo.mock.calls[0][0]);
    expect(next.searchParams.get("view")).toBe("table");
    expect(next.searchParams.has("savedView")).toBe(false);
  });

  it("뷰가 많으면 앞 3개만 서고 나머지는 「더보기」 — 지금 뷰는 늘 줄에 선다", async () => {
    listed = ["a", "b", "c", "d", "e"].map((id) => view(id));
    const host = await mount({ activeViewId: "e" });
    const tabs = [...host.querySelectorAll("[data-view-tab]")].map((tab) => tab.getAttribute("data-view-tab"));
    expect(tabs).toEqual(["main", "a", "b", "e"]);
    await click(host.querySelector("[data-view-tab-more]"));
    expect(menuLabels()).toEqual(["뷰 c · 팀", "뷰 d · 팀"]);
  });
});

describe("휴대폰(640px 아래) — [뷰 이름 •▾] [보기 조건 N] [찾기]", () => {
  it("보기 조건은 바닥 시트로 열고, 필터는 팝오버 없이 그 자리에서 펼친다 · 바뀌면 시트 아래 저장이 선다", async () => {
    const host = await mount();
    const mobile = host.querySelector("[data-board-view-bar-mobile]")!;
    const [viewsButton, conditionsButton, searchButton] = [...mobile.querySelectorAll("button")];
    expect(viewsButton.textContent).toContain("메인 테이블");
    expect(conditionsButton.textContent).toBe("보기 조건");
    expect(searchButton.getAttribute("aria-label")).toBe("찾기");

    await click(conditionsButton);
    const sheet = document.querySelector<HTMLElement>("[data-view-bar-sheet]")!;
    expect(sheet).not.toBeNull();
    expect([...sheet.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["필터", "담당", "정렬", "나눠 보기", "칸 숨기기"]);
    // 시트 안에서는 칩 팝오버를 띄우지 않는다.
    expect(sheet.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    await click([...sheet.querySelectorAll("button[aria-expanded]")].find((button) => button.textContent?.includes("상태")));
    await click([...sheet.querySelectorAll("label")].find((label) => label.textContent?.startsWith("신규"))?.querySelector("input"));
    expect(conditionsButton.textContent).toBe("보기 조건1");
    expect([...sheet.querySelectorAll("button")].map((button) => button.textContent)).toEqual(expect.arrayContaining(["되돌리기", "새 뷰로 저장…"]));
    expect(viewsButton.getAttribute("aria-label")).toBe("뷰 목록 · 메인 테이블 · 바뀐 조건 1개");
  });
});

describe("나눠 보기(#845 7단계) — 메인 표는 화면 안에서 바꾸고 «저장» 이 뷰에 담는다", () => {
  function GroupHarness(props: Partial<BarProps> & { initialGroup?: string }) {
    const [groupBy, setGroupBy] = useState(props.initialGroup ?? "");
    return (
      <Harness
        groupBy={groupBy}
        groupByOptions={[{ key: "status", label: "상태" }]}
        onGroupByChange={setGroupBy}
        {...props}
      />
    );
  }
  async function mountGroup(props: Partial<BarProps> & { initialGroup?: string } = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<GroupHarness {...props} />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return host;
  }

  it("고르면 다시 읽지 않고 칩이 바뀌며 바뀐 조건 1개 — 새 뷰에 groupBy 로 담고 주소에도 남긴다", async () => {
    const host = await mountGroup();
    await click(chip(host, "group"));
    const options = [...host.querySelectorAll<HTMLButtonElement>("#board-filter-panel [role=tabpanel] button")];
    expect(options.map((button) => button.textContent?.replace("✓", ""))).toEqual(["보드별로 나눠 보기", "상태별로 나눠 보기"]);
    await click(options[1]);
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(chip(host, "group")!.textContent).toBe("나눠 보기 · 상태별");
    expect(host.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");

    await click(host.querySelector("[data-view-tab-create]"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 뷰로 저장"]')!;
    expect([...dialog.querySelectorAll('[aria-label="담을 조건"] li')].map((item) => item.textContent)).toEqual(["표", "상태별"]);
    await type(dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!, "상태별 보기");
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const created = calls.find((call) => call.method === "POST")!;
    expect((created.body as { config: { kind: string; groupBy: string } }).config).toMatchObject({ kind: "grouped", groupBy: "status" });
    expect(new URL(nav.navigateTo.mock.calls[0][0]).searchParams.get("group")).toBe("status");
  });

  it("뷰에 저장된 나눠 보기는 기준이다 — 보드별로 바꾸면 바뀜, 되돌리면 그 뷰의 묶음으로 화면 안에서 돌아간다", async () => {
    listed = [view("grouped", { ownerId: "me", canEdit: true }, { groupBy: "status" })];
    const host = await mountGroup({ activeViewId: "grouped", initialGroup: "status" });
    expect(dirtyDot(host)).toBeNull();
    await click(chip(host, "group"));
    await click(host.querySelectorAll<HTMLButtonElement>("#board-filter-panel [role=tabpanel] button")[0]);
    expect(chip(host, "group")!.textContent).toBe("나눠 보기 · 보드별");
    expect(dirtyDot(host)).not.toBeNull();
    await click([...host.querySelectorAll<HTMLButtonElement>("[data-view-dirty-actions] button")].find((button) => button.textContent === "되돌리기"));
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(chip(host, "group")!.textContent).toBe("나눠 보기 · 상태별");
    expect(dirtyDot(host)).toBeNull();
  });
});

describe("뷰 관리 — 만든 사람·관리자만 ▾(이름 바꾸기·지우기)", () => {
  const submit = async (dialog: Element) => {
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };

  it("만든 사람에게는 지금 뷰 ▾ 가 있고, 이름 바꾸기는 그 뷰에 새 이름을 보낸다", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true, visibility: "private" }), view("other")];
    const host = await mount({ activeViewId: "mine" });
    // 지금 뷰가 아닌 탭에는 ▾ 가 없다.
    expect(host.querySelector('[aria-label="뷰 other 뷰 메뉴"]')).toBeNull();
    await click(host.querySelector('[aria-label="뷰 mine 뷰 메뉴"]'));
    expect(menuLabels()).toEqual(["이름 바꾸기", "지우기"]);
    await click(menuItem("이름 바꾸기"));
    const dialog = document.querySelector('[role="dialog"][aria-label="이름 바꾸기"]')!;
    const input = dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!;
    expect(input.value).toBe("뷰 mine");
    await type(input, "내 업체");
    await submit(dialog);
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([
      { url: "/api/tab-views/mine", method: "PATCH", body: { name: "내 업체" } },
    ]);
    expect(host.querySelector('[data-view-tab="mine"]')!.textContent).toContain("내 업체");
    expect(document.querySelector('[role="dialog"][aria-label="이름 바꾸기"]')).toBeNull();
  });

  it("지우기는 확인 뒤 그 뷰에 DELETE 를 보내고 서버가 고른 다음 뷰로 옮긴다", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true }), view("rest")];
    const host = await mount({ activeViewId: "mine" });
    await click(host.querySelector('[aria-label="뷰 mine 뷰 메뉴"]'));
    await click(menuItem("지우기"));
    const confirm = document.querySelector('[role="dialog"][aria-label="뷰 지우기"]')!;
    expect(confirm.textContent).toContain("「뷰 mine」 뷰를 지울까요?");
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
    await click([...confirm.querySelectorAll("button")].find((button) => button.textContent === "지우기"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual(["/api/tab-views/mine"]);
    const next = new URL(nav.navigateTo.mock.calls[0][0]);
    expect(next.searchParams.get("savedView")).toBe("rest");
  });

  it("남은 뷰가 없으면 메인 테이블로 간다", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true })];
    const host = await mount({ activeViewId: "mine" });
    await click(host.querySelector('[aria-label="뷰 mine 뷰 메뉴"]'));
    await click(menuItem("지우기"));
    await click([...document.querySelectorAll('[role="dialog"][aria-label="뷰 지우기"] button')].find((button) => button.textContent === "지우기"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const next = new URL(nav.navigateTo.mock.calls[0][0]);
    expect(next.searchParams.has("savedView")).toBe(false);
    expect(next.searchParams.get("view")).toBe("table");
  });
});

describe("D26 — 「담당 · 나」 는 보는 사람 기준으로 저장한다", () => {
  const pickMe = async (host: ParentNode) => {
    await click(chip(host, "assignee"));
    await click([...host.querySelectorAll("#board-filter-panel [role=tabpanel] button")].find((button) => button.textContent?.replace("✓", "") === "나"));
  };

  it("A 가 「나」 로 저장한 팀 뷰를 B 가 열면 B 의 행이 보이고 담당 칩은 「나」, 연 그대로는 바뀜이 아니다", async () => {
    // A(me) — 담당 · 나 로 팀 뷰를 만든다. 뷰에는 A 의 id 가 박히지 않는다.
    const host = await mount();
    await pickMe(host);
    await click(host.querySelector("[data-view-tab-create]"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 뷰로 저장"]')!;
    await type(dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!, "내 담당");
    await click([...dialog.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((radio) => radio.textContent === "팀"));
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const created = calls.find((call) => call.method === "POST")!.body as { personScope: string; personScopeUserId: string | null; config: unknown };
    expect(created).toMatchObject({ personScope: "viewer", personScopeUserId: null });
    const config = parseSavedBoardViewConfig(created.config);
    expect(config.filters.assignees).toEqual([]);
    // A 가 새 뷰로 옮겨 가도 담당은 A 자신(나)이다.
    expect(decodeBoardFilters(new URL(nav.navigateTo.mock.calls[0][0]).searchParams.get("mwFilters")).assignees).toEqual(["me"]);

    // B(u2) — 같은 뷰를 연다. 서버가 거는 사람 범위도, 화면의 담당 조건도 B 다.
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    calls = [];
    const team = view("team-mine", { ownerId: "me", canEdit: false, personScope: "viewer", personScopeUserId: null }, { kind: "grouped", filters: config.filters });
    listed = [team];
    const url = new URL(savedViewUrl(team, "https://app.test/boards/b", "u2"));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    expect(applySavedPersonScope(rows, team, "u2", null, ["u2"]).map((candidate) => candidate.id)).toEqual(["2"]);
    const viewer = await mount({
      activeViewId: "team-mine",
      currentUserId: "u2",
      initial: decodeBoardFilters(url.searchParams.get("mwFilters")),
    });
    expect(chip(viewer, "assignee")!.textContent).toBe("담당 · 나");
    expect(viewer.querySelector("[data-view-count]")!.textContent).toBe("내 담당 · 3건 중 1건");
    expect(dirtyDot(viewer)).toBeNull();
    expect(viewer.querySelector("[data-view-dirty-actions]")).toBeNull();
  });

  it("「이 뷰에 저장」 도 「나」 를 보는 사람 기준으로 바꿔 담고, 저장 뒤에는 바뀜이 없다", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true, personScope: "none", personScopeUserId: null })];
    const host = await mount({ activeViewId: "mine" });
    await pickMe(host);
    expect(dirtyDot(host)).not.toBeNull();
    await click(host.querySelector("[data-view-save]"));
    await click(menuItem("이 뷰에 저장"));
    const patch = calls.find((call) => call.method === "PATCH")!.body as { personScope: string; personScopeUserId: null; config: { filters: BoardFilterState } };
    expect(patch).toMatchObject({ personScope: "viewer", personScopeUserId: null });
    expect(patch.config.filters.assignees).toEqual([]);
    expect(chip(host, "assignee")!.textContent).toBe("담당 · 나");
    expect(dirtyDot(host)).toBeNull();
  });

  it("보는 사람 기준 뷰에서 담당을 바꿔 저장하면 viewer 를 풀고, 팀 범위는 「나」 가 아니면 그대로 둔다", async () => {
    listed = [view("mine", { ownerId: "me", canEdit: true, personScope: "viewer", personScopeUserId: null })];
    const url = new URL(savedViewUrl(listed[0], "https://app.test/boards/b", "me"));
    const host = await mount({ activeViewId: "mine", initial: decodeBoardFilters(url.searchParams.get("mwFilters")) });
    expect(chip(host, "assignee")!.textContent).toBe("담당 · 나");
    expect(dirtyDot(host)).toBeNull();
    await click(chip(host, "assignee"));
    await click([...host.querySelectorAll("#board-filter-panel label")].find((label) => label.textContent?.startsWith("가담당"))?.querySelector("input"));
    await click(host.querySelector("[data-view-save]"));
    await click(menuItem("이 뷰에 저장"));
    const patch = calls.find((call) => call.method === "PATCH")!.body as { personScope: string; config: { filters: BoardFilterState } };
    expect(patch.personScope).toBe("none");
    expect(patch.config.filters.assignees).toEqual(["me", "u2"]);

    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    calls = [];
    listed = [view("team", { ownerId: "me", canEdit: true, personScope: "team", personScopeUserId: null })];
    const teamHost = await mount({ activeViewId: "team" });
    await click(chip(teamHost, "sort"));
    await click(teamHost.querySelector('#board-filter-panel [aria-label="상태 가나다순"]'));
    await click(teamHost.querySelector("[data-view-save]"));
    await click(menuItem("이 뷰에 저장"));
    expect(calls.find((call) => call.method === "PATCH")!.body).not.toHaveProperty("personScope");
  });
});

describe("나눠 보기 — 이 화면이 걸 수 없는 저장값은 바뀜이 아니다", () => {
  it("목록 보기로 연 예전 뷰의 groupBy 는 바뀜으로 세지 않고, 되돌리기는 제자리에서 끝난다(다시 읽기 고리 없음)", async () => {
    listed = [view("legacy", { ownerId: "me", canEdit: true }, { kind: "table", groupBy: "status" })];
    window.history.replaceState(null, "", "/boards/b?view=flat&savedView=legacy&group=status");
    const host = await mount({ activeViewId: "legacy", mode: "flat" });
    expect(dirtyDot(host)).toBeNull();
    await click(chip(host, "sort"));
    await click(host.querySelector('#board-filter-panel [aria-label="상태 가나다순"]'));
    expect(host.querySelector('[data-view-tab="legacy"]')!.getAttribute("title")).toBe("바뀐 조건 1개");
    await click([...host.querySelectorAll<HTMLButtonElement>("[data-view-dirty-actions] button")].find((button) => button.textContent === "되돌리기"));
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(dirtyDot(host)).toBeNull();
  });

  it("지워진(또는 종류가 바뀐) 나눠 보기 칸도 보드별로 본다", async () => {
    listed = [view("gone", {}, { kind: "grouped", groupBy: "deleted_column" })];
    const host = await mount({ activeViewId: "gone", groupByOptions: [{ key: "status", label: "상태" }] });
    expect(dirtyDot(host)).toBeNull();
    expect(chip(host, "group")!.textContent).toBe("나눠 보기 · 보드별");
  });

  it("신규리드 칸반: 저장값 physical key(export_status)가 화면 key 와 맞으면 바뀜이 아니고, 새로 저장해도 그 칸 그대로다", async () => {
    listed = [view("leads", { ownerId: "me", canEdit: true }, { kind: "board", groupBy: "export_status" })];
    const options = [{ key: "closed_business", label: "폐업여부" }, { key: "export_status", label: "수출여부" }];
    const host = await mount({ activeViewId: "leads", mode: "kanban", canonicalNewLead: true, groupBy: "export_status", groupByOptions: options });
    expect(dirtyDot(host)).toBeNull();
    expect(chip(host, "group")!.textContent).toBe("나눠 보기 · 수출여부별");

    await click(host.querySelector("[data-view-tab-create]"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="새 뷰로 저장"]')!;
    await type(dialog.querySelector<HTMLInputElement>('input[aria-label="뷰 이름"]')!, "수출별");
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const created = calls.find((call) => call.method === "POST")!.body as { config: { kind: string; groupBy: string } };
    expect(created.config).toMatchObject({ kind: "board", groupBy: "export_status" });
    expect(new URL(nav.navigateTo.mock.calls[0][0]).searchParams.get("group")).toBe("export_status");
  });

  it("칸반에서 나눠 보기를 고르면 그 칸으로 레인을 다시 그린다(router.push)", async () => {
    window.history.replaceState(null, "", "/boards/b?view=kanban");
    const host = await mount({ mode: "kanban", groupByOptions: [{ key: "status", label: "상태" }] });
    await click(chip(host, "group"));
    await click([...host.querySelectorAll<HTMLButtonElement>("#board-filter-panel [role=tabpanel] button")].find((button) => button.textContent?.replace("✓", "") === "상태별로 나눠 보기"));
    expect(nav.navigateTo).not.toHaveBeenCalled();
    const next = new URL(nav.push.mock.calls[0][0], "https://app.test");
    expect(next.searchParams.get("view")).toBe("kanban");
    expect(next.searchParams.get("group")).toBe("status");
  });
});

describe("휴대폰(640px 아래) — 칸 메뉴 「필터…」 와 뷰 목록", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: query === "(max-width: 639px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  it("「필터…」 가 오면 보기 조건 시트를 필터 탭으로 열고 그 칸을 펼친다", async () => {
    function FocusHarness() {
      const [focus, setFocus] = useState<{ columnKey: string; seq: number } | null>(null);
      return (
        <>
          <button type="button" data-test-focus onClick={() => setFocus({ columnKey: "status", seq: (focus?.seq ?? 0) + 1 })}>필터…</button>
          <Harness focusFilter={focus} />
        </>
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<FocusHarness />));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await click(host.querySelector("[data-test-focus]"));
    const sheet = document.querySelector<HTMLElement>("[data-view-bar-sheet]")!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("필터");
    const facet = [...sheet.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) => button.textContent?.includes("상태"))!;
    expect(facet.getAttribute("aria-expanded")).toBe("true");
    expect([...sheet.querySelectorAll("label")].map((label) => label.textContent)).toEqual(expect.arrayContaining(["신규 (2)", "완료 (1)"]));
    // 숨은 펼침 칸이 팝오버를 띄우지 않는다.
    expect(document.querySelector('[role="dialog"][aria-label="상태 필터"]')).toBeNull();
  });

  it("뷰 시트는 목록(ul > li > 단추)이고 지금 뷰에 aria-current 가 있다", async () => {
    listed = [view("a"), view("b")];
    const host = await mount({ activeViewId: "b" });
    await click(host.querySelector("[data-board-view-bar-mobile] button"));
    const list = document.querySelector<HTMLElement>('[data-view-bar-sheet] ul[aria-label="뷰 목록"]')!;
    expect(list).not.toBeNull();
    const items = [...list.children];
    expect(items.map((item) => item.tagName)).toEqual(["LI", "LI", "LI"]);
    expect(items.map((item) => item.querySelector("button")!.getAttribute("aria-current"))).toEqual([null, null, "page"]);
    expect(list.querySelector('[role="listitem"]')).toBeNull();
  });
});
