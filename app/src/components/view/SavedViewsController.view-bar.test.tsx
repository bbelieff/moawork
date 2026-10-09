// @vitest-environment jsdom
/**
 * #845 6단계 — 목록(묶지 않은 표)·캘린더 보기도 표와 같은 보기 줄을 쓴다.
 *   · 보기 조건은 화면이 들고 주소(mwFilters)에 남긴다 — 저장된 뷰가 «덮어쓰지» 않는다.
 *   · 저장된 뷰가 없을 때 옮긴 칸 순서를 잃지 않는다(mwOrder 를 JSON 으로 — 예전에는 쉼표로 남겨 다시 못 읽었다).
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  moveRowAction: vi.fn(),
  reorderGroupsAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/title-actions", () => ({ renameColumnTitleAction: vi.fn() }));
// 보기 줄은 보기 방식을 router.push 로 바꾼다 — 앱 라우터 밖에서 그리므로 바꿔 끼운다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import { SavedViewsController } from "./SavedViewsController";
import { decodeBoardFilters, EMPTY_FILTERS } from "@/components/board/filters";
import { parseSavedBoardViewConfig, parseSavedStringList, savedViewUrl, type SavedBoardView } from "@/lib/view/board-saved";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const column = (key: string, label: string, sort: number) => ({
  id: `c-${key}`, org_id: "o", board_id: "b", key, label, type: "text", source: "in", rightPinned: false,
  options_jsonb: null, sort_order: sort, width: null, move_rule_jsonb: null,
}) as BoardColumn;
const columns = [column("first", "첫째", 0), column("second", "둘째", 1)];
const rows = ["가나", "다라"].map((title, index) => ({
  id: `i-${index}`, org_id: "o", board_id: "b", group_id: "g", title, assigned_to: null, deal_id: null,
  sort_order: index, created_at: "", updated_at: "", values: { first: `${title}-1`, second: `${title}-2` },
})) as ItemWithValues[];

let root: Root | null = null;
beforeEach(() => window.history.replaceState(null, "", "/boards/b?view=flat"));
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount(search = "view=flat", initialFilters = EMPTY_FILTERS) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <SavedViewsController boardId="b" currentUserId="me" columns={columns} rows={rows} renderMode="flat"
      canEditItems canManageColumns initialSearch={search} initialFilters={initialFilters} />,
  ));
  return host;
}
const headers = (host: ParentNode) => [...host.querySelectorAll("thead th")].map((th) => th.getAttribute("data-column-key")).filter((key) => key && !key.startsWith("__"));

describe("#845 6단계 — 목록 보기의 보기 줄", () => {
  it("표와 같은 보기 줄(뷰 탭·칩·찾기)을 그리고, 보기 방식 칩은 「목록」 이다", async () => {
    const host = await mount();
    const bar = host.querySelector("[data-board-toolbar]")!;
    expect(bar.querySelector('[data-view-tab="main"]')).not.toBeNull();
    expect(bar.querySelector('[data-view-chip="mode"]')!.textContent).toBe("목록");
    expect(bar.querySelector('input[aria-label="찾기"]')).not.toBeNull();
    // 메인 테이블(표)과 보기 방식이 다르다 — 바뀐 조건 1개.
    expect(bar.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");
  });

  it("찾기는 화면에서 바로 행을 줄이고 주소에 남긴다", async () => {
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>('[data-board-toolbar] input[aria-label="찾기"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "다라");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("tbody")!.textContent).toContain("다라");
    expect(host.querySelector("tbody")!.textContent).not.toContain("가나");
    expect(decodeBoardFilters(new URL(window.location.href).searchParams.get("mwFilters")).q).toBe("다라");
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("찾기 “다라” · 2건 중 1건");
  });

  it("저장된 뷰가 없어도 옮긴 칸 순서를 주소에 JSON 으로 남기고, 다시 열면 그대로다", async () => {
    const host = await mount();
    expect(headers(host)).toEqual(["first", "second"]);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="첫째 오른쪽으로 이동"]')!.click());
    expect(headers(host)).toEqual(["second", "first"]);
    const order = new URL(window.location.href).searchParams.get("mwOrder");
    expect(parseSavedStringList(order ?? undefined)).toEqual(["second", "first"]);

    // 새로고침 — 서버가 주소를 그대로 넘긴다.
    await act(async () => root!.unmount());
    root = null;
    document.body.replaceChildren();
    const reloaded = await mount(new URL(window.location.href).searchParams.toString());
    expect(headers(reloaded)).toEqual(["second", "first"]);
  });

  it("주소의 보기 조건으로 첫 화면을 그린다(저장된 뷰 설정이 덮지 않는다)", async () => {
    const host = await mount("view=flat", { ...EMPTY_FILTERS, visibleColumnKeys: ["second"] });
    expect(headers(host)).toEqual(["second"]);
    expect(host.querySelector('[data-view-chip="columns"]')!.textContent).toBe("칸 숨기기1");
  });
});

describe("저장된 뷰로 연 목록·캘린더", () => {
  const savedView = (over: Partial<SavedBoardView>, config: Record<string, unknown>): SavedBoardView => ({
    id: "v", name: "뷰", visibility: "shared", ownerId: "other", isDefault: false, lastUsedAt: null, canEdit: false,
    config: parseSavedBoardViewConfig(config),
    ...over,
  });
  const serve = (views: SavedBoardView[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ data: views }), { status: 200, headers: { "content-type": "application/json" } },
  )));
  afterEach(() => vi.unstubAllGlobals());
  const titles = (host: ParentNode) => [...host.querySelectorAll('tbody td[data-column-key="__title"]')].map((cell) => cell.textContent);

  async function render(element: ReactElement) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(element));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    return host;
  }

  it("계약일로 저장한 캘린더 뷰는 주소에 날짜 칸이 없어도 계약일로 연다", async () => {
    const date = (key: string, label: string, sort: number) => ({ ...column(key, label, sort), type: "date" }) as BoardColumn;
    serve([savedView({ id: "cal" }, { kind: "calendar", calendarFieldKey: "contract_date" })]);
    window.history.replaceState(null, "", "/boards/b?view=calendar&savedView=cal");
    const host = await render(
      <SavedViewsController boardId="b" currentUserId="me" columns={[date("start_date", "시작일", 0), date("contract_date", "계약일", 1)]}
        rows={rows} renderMode="calendar" initialSearch="view=calendar&savedView=cal" savedViewId="cal" loadSavedViews />,
    );
    expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("contract_date");
  });

  it("목록의 사람 칸 「이름순」 은 계정 id 가 아니라 이름으로 줄 세운다", async () => {
    const owner = { ...column("owner", "담당자", 0), type: "person" } as BoardColumn;
    const people = [
      { ...rows[0], id: "p-1", title: "하늘 담당 건", values: { owner: "u-1" } },
      { ...rows[1], id: "p-2", title: "가람 담당 건", values: { owner: "u-2" } },
    ];
    const host = await render(
      <SavedViewsController boardId="b" currentUserId="me" columns={[owner]} rows={people} renderMode="flat"
        memberOptions={[{ id: "u-1", label: "하늘" }, { id: "u-2", label: "가람" }]}
        initialFilters={{ ...EMPTY_FILTERS, sorts: [{ columnKey: "owner", direction: "asc" }] }} />,
    );
    expect(titles(host)).toEqual(["가람 담당 건", "하늘 담당 건"]);
  });

  it("D26 — A 가 「나」 로 저장한 팀 뷰를 B 가 열면 B 의 행만, 담당 칩은 「나」, 바뀜 없음", async () => {
    const team = savedView({ id: "team", ownerId: "u-a", personScope: "viewer", personScopeUserId: null }, { kind: "table" });
    serve([team]);
    const mine = [
      { ...rows[0], id: "a-row", title: "A 의 건", assigned_to: "u-a" },
      { ...rows[1], id: "b-row", title: "B 의 건", assigned_to: "u-b" },
    ];
    const url = new URL(savedViewUrl(team, "https://app.test/boards/b?view=flat", "u-b"));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    const host = await render(
      <SavedViewsController boardId="b" currentUserId="u-b" teamMemberIds={["u-b"]} columns={columns} rows={mine} renderMode="flat"
        memberOptions={[{ id: "u-a", label: "에이" }, { id: "u-b", label: "비" }]}
        initialSearch={url.searchParams.toString()} initialFilters={decodeBoardFilters(url.searchParams.get("mwFilters"))}
        savedViewId="team" loadSavedViews />,
    );
    expect(titles(host)).toEqual(["B 의 건"]);
    expect(host.querySelector('[data-view-chip="assignee"]')!.textContent).toBe("담당 · 나");
    expect(host.querySelector("[data-view-dirty-dot]")).toBeNull();
  });
});
