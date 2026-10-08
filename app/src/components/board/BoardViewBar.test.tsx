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

const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("@/components/view/use-saved-views", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/view/use-saved-views")>()),
  navigateTo: nav.navigateTo,
}));

import { BoardViewBar } from "./BoardViewBar";
import { applyFilters, decodeBoardFilters, EMPTY_FILTERS, type BoardFilterState } from "./filters";
import { parseSavedBoardViewConfig, savedViewUrl, type SavedBoardView } from "@/lib/view/board-saved";
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
    else if (method === "POST") data = { ...view("new-1", { name: body.name, visibility: body.visibility, ownerId: "me", canEdit: true }), config: parseSavedBoardViewConfig(body.config) };
    else if (method === "PATCH") {
      const target = listed.find((candidate) => url.endsWith(candidate.id));
      data = { ...target, config: body.config ? parseSavedBoardViewConfig(body.config) : target?.config };
    }
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

  it("「표 ▾」 에서 칸반을 고르면 같은 조건으로 칸반을 연다", async () => {
    const host = await mount();
    await click(chip(host, "mode"));
    expect(menuLabels()).toEqual(["표", "칸반"]);
    await click(menuItem("칸반"));
    expect(new URL(nav.navigateTo.mock.calls[0][0]).searchParams.get("view")).toBe("kanban");
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
    expect(chip(host, "sort")!.textContent).toBe("줄 세우기1");
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
    expect(chip(host, "columns")!.textContent).toBe("보이는 칸 1/2");
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
    expect(chip(host, "filter")!.textContent).toBe("골라 보기1");
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
  it("보기 조건은 바닥 시트로 열고, 골라 보기는 팝오버 없이 그 자리에서 펼친다 · 바뀌면 시트 아래 저장이 선다", async () => {
    const host = await mount();
    const mobile = host.querySelector("[data-board-view-bar-mobile]")!;
    const [viewsButton, conditionsButton, searchButton] = [...mobile.querySelectorAll("button")];
    expect(viewsButton.textContent).toContain("메인 테이블");
    expect(conditionsButton.textContent).toBe("보기 조건");
    expect(searchButton.getAttribute("aria-label")).toBe("찾기");

    await click(conditionsButton);
    const sheet = document.querySelector<HTMLElement>("[data-view-bar-sheet]")!;
    expect(sheet).not.toBeNull();
    expect([...sheet.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["골라 보기", "담당", "줄 세우기", "나눠 보기", "보이는 칸"]);
    // 시트 안에서는 칩 팝오버를 띄우지 않는다.
    expect(sheet.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    await click([...sheet.querySelectorAll("button[aria-expanded]")].find((button) => button.textContent?.includes("상태")));
    await click([...sheet.querySelectorAll("label")].find((label) => label.textContent?.startsWith("신규"))?.querySelector("input"));
    expect(conditionsButton.textContent).toBe("보기 조건1");
    expect([...sheet.querySelectorAll("button")].map((button) => button.textContent)).toEqual(expect.arrayContaining(["되돌리기", "새 뷰로 저장…"]));
    expect(viewsButton.getAttribute("aria-label")).toBe("뷰 목록 · 메인 테이블 · 바뀐 조건 1개");
  });
});
