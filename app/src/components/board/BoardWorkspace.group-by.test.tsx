// @vitest-environment jsdom
/**
 * #845 7단계(2026-10-08 대표 결정) — 나눠 보기를 «그려진 결과와 행동» 으로 잰다.
 *   · 보드별(기본)은 그대로 · 칸을 고르면 모든 보드의 행이 값 묶음으로(선택지 순서 · 「(없음)」 맨 끝 · 빈 묶음은 접힘)
 *   · 다른 묶음으로 끌면 그 칸 값을 바꾼다 — 먼저 옮겨 보이고, 서버가 거절하면 제자리 + 까닭
 *   · 같은 묶음 안 순서는 저장하지 않는다 · 수정 권한이 없으면 끌 수 없다
 *   · 묶음의 추가 줄은 첫 보드에 만들고 그 값을 미리 넣는다
 *   · 「나눠 보기」 칩과 칸 메뉴 「{칸}별로 나눠 보기」 가 화면 안에서 바꾸고 주소(group)에 남긴다
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  setGroupValueAction: vi.fn<(form: FormData) => Promise<{ ok: true; notice?: string } | { ok: false; message: string }>>(async () => ({ ok: true })),
}));
const nav = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  setGroupValueAction: actionMocks.setGroupValueAction,
}));
vi.mock("@/components/view/use-saved-views", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/view/use-saved-views")>()),
  navigateTo: nav.navigateTo,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/b",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { BoardWorkspace } from "./BoardWorkspace";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  window.history.replaceState(null, "", "/boards/b?view=table");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  actionMocks.setGroupValueAction.mockReset();
  actionMocks.setGroupValueAction.mockImplementation(async () => ({ ok: true }));
  nav.navigateTo.mockReset();
});

const groups = [
  { id: "g1", org_id: "o", board_id: "b", name: "준비단계", color: null, sort_order: 0 },
  { id: "g2", org_id: "o", board_id: "b", name: "진행중", color: null, sort_order: 1 },
] as BoardGroup[];
const column = (id: string, key: string, label: string, sort: number, over: Partial<BoardColumn> = {}) => ({
  id, org_id: "o", board_id: "b", key, label, type: "text", source: "act", rightPinned: false,
  sort_order: sort, width: null, options_jsonb: null, move_rule_jsonb: null, ...over,
}) as BoardColumn;
const columns = [
  column("c-inst", "institution", "진행기관", 0, {
    type: "select",
    options_jsonb: { options: [
      { id: "kodit", label: "신용보증기금", color: "#579bfc" },
      { id: "kibo", label: "기술보증기금", color: "#00c875" },
      { id: "semas", label: "소진공" },
    ] },
  }),
  column("c-owner", "owner", "담당자", 1, { type: "person" }),
  column("c-memo", "memo", "메모", 2),
];
const row = (id: string, title: string, groupId: string, values: ItemWithValues["values"], sort = 0): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: groupId, title, assigned_to: null, deal_id: null,
  sort_order: sort, created_at: "", updated_at: "", values,
});
const rows = [
  row("r1", "가회사", "g1", { institution: "kodit", owner: "u1" }),
  row("r2", "나회사", "g2", { institution: "kibo" }),
  row("r3", "다회사", "g2", {}, 1),
];

async function mount(over: { groupBy?: string; canEditItems?: boolean } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "보드", source: "user", is_system: false, sort_order: 0 } as Board;
  await act(async () => root!.render(
    <BoardWorkspace
      board={board}
      columns={columns}
      groups={groups}
      rows={rows}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{ u1: "가나" }}
      memberDirectory={[{ id: "u1", label: "가나" }, { id: "u2", label: "다라" }]}
      groupBy={over.groupBy ?? ""}
      canEditItems={over.canEditItems ?? true}
      canManageColumns
      canMoveRows
    />,
  ));
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  return host;
}

const sections = (host: ParentNode) =>
  [...host.querySelectorAll<HTMLElement>('section[data-visual-block="group-table"]')].map((section) => ({
    title: section.querySelector("[data-group-title]")!.textContent,
    rows: [...section.querySelectorAll("[data-row-name]")].map((node) => node.textContent),
    section,
  }));
const sectionOf = (host: ParentNode, title: string) => sections(host).find((entry) => entry.title === title)!.section;
const titleCell = (host: ParentNode, rowTitle: string) =>
  [...host.querySelectorAll<HTMLElement>("td[data-board-title-cell]")].find((cell) => cell.querySelector("[data-row-name]")?.textContent === rowTitle)!;
const rowOf = (host: ParentNode, rowTitle: string) => titleCell(host, rowTitle).closest("tr")!;

async function fire(target: Element, type: "dragstart" | "dragover" | "drop" | "dragend") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { dropEffect: "none", effectAllowed: "all" } });
  await act(async () => target.dispatchEvent(event));
  return event;
}
async function dragRow(host: ParentNode, from: string, onto: Element) {
  await fire(titleCell(host, from), "dragstart");
  const over = await fire(onto, "dragover");
  const dropped = await fire(onto, "drop");
  return { accepted: over.defaultPrevented && dropped.defaultPrevented };
}
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find((item) => item.textContent === label);
const head = (host: ParentNode) => host.querySelector('[data-board-table-part="head"]')!;
const columnTitle = (host: ParentNode, label: string) =>
  [...head(host).querySelectorAll<HTMLElement>("[data-column-title]")].find((node) => node.textContent === label)!;

describe("보드별(기본)은 그대로", () => {
  it("나눠 보기가 없으면 보드 띠 그대로 — 보드 순서와 보드 안 행", async () => {
    const host = await mount();
    expect(sections(host).map(({ title, rows: names }) => [title, names])).toEqual([
      ["준비단계", ["가회사"]],
      ["진행중", ["나회사", "다회사"]],
    ]);
    expect(host.querySelector('[data-view-chip="group"]')!.textContent).toBe("나눠 보기 · 보드별");
  });
});

describe("값 묶음", () => {
  it("선택지 순서로 묶고 「(없음)」 은 맨 끝 · 빈 묶음은 접어 두고 펼칠 수 있다 · 제목행은 하나", async () => {
    const host = await mount({ groupBy: "institution" });
    expect(sections(host).map(({ title, rows: names }) => [title, names])).toEqual([
      ["신용보증기금", ["가회사"]],
      ["기술보증기금", ["나회사"]],
      ["(없음)", ["다회사"]],
    ]);
    // 띠에 «N건» — 같은 띠 부품.
    expect(sectionOf(host, "기술보증기금").querySelector("summary")!.textContent).toContain("1건");
    expect(host.querySelectorAll('[data-board-table-part="head"]')).toHaveLength(1);
    const toggle = host.querySelector<HTMLButtonElement>("[data-empty-groups-toggle] button")!;
    expect(toggle.textContent).toBe("빈 묶음 1개 보기");
    await act(async () => toggle.click());
    expect(sections(host).map(({ title }) => title)).toEqual(["신용보증기금", "기술보증기금", "소진공", "(없음)"]);
    expect(host.querySelector('[data-view-chip="group"]')!.textContent).toBe("나눠 보기 · 진행기관별");
  });

  it("다른 묶음으로 끌면 그 칸 값을 바꾼다 — 먼저 옮겨 보이고 서버 값으로 이어진다", async () => {
    let release!: (value: { ok: true }) => void;
    actionMocks.setGroupValueAction.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const host = await mount({ groupBy: "institution" });
    const { accepted } = await dragRow(host, "가회사", rowOf(host, "나회사"));
    expect(accepted).toBe(true);
    expect(actionMocks.setGroupValueAction).toHaveBeenCalledTimes(1);
    const sent = actionMocks.setGroupValueAction.mock.calls[0][0];
    expect(Object.fromEntries(sent.entries())).toEqual({ boardId: "b", itemId: "r1", columnKey: "institution", value: JSON.stringify("kibo") });
    // 낙관적 — 서버 답 전에 이미 「기술보증기금」 묶음에 있다.
    expect(sections(host).find(({ title }) => title === "기술보증기금")!.rows).toEqual(["가회사", "나회사"]);
    await act(async () => release({ ok: true }));
  });

  it("서버가 거절하면(권한 없음) 제자리로 돌아가고 까닭을 보인다", async () => {
    actionMocks.setGroupValueAction.mockImplementationOnce(async () => ({ ok: false, message: "이 업무를 실행할 권한이 없어요." }));
    const host = await mount({ groupBy: "institution" });
    await dragRow(host, "가회사", rowOf(host, "다회사"));
    await act(async () => { await Promise.resolve(); });
    expect(sections(host).find(({ title }) => title === "신용보증기금")!.rows).toEqual(["가회사"]);
    expect(sections(host).find(({ title }) => title === "(없음)")!.rows).toEqual(["다회사"]);
    expect(host.querySelector("[data-group-value-error]")!.textContent).toBe("이 업무를 실행할 권한이 없어요.");
    expect(JSON.parse(String(actionMocks.setGroupValueAction.mock.calls[0][0].get("value")))).toBeNull();
  });

  it("같은 묶음 안에서는 순서를 저장하지 않는다", async () => {
    const twoInKibo = [row("a", "에이", "g1", { institution: "kibo" }), row("b", "비이", "g2", { institution: "kibo" })];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const board = { id: "b", org_id: "o", name: "보드", source: "user", is_system: false, sort_order: 0 } as Board;
    await act(async () => root!.render(
      <BoardWorkspace board={board} columns={columns} groups={groups} rows={twoInKibo} columnOrder={{}} cellFlash={null}
        assigneeLabels={{}} groupBy="institution" canEditItems canMoveRows />,
    ));
    const { accepted } = await dragRow(host, "비이", rowOf(host, "에이"));
    expect(accepted).toBe(false);
    expect(actionMocks.setGroupValueAction).not.toHaveBeenCalled();
  });

  it("항목 수정 권한이 없으면 끌 수도, 추가할 수도 없다", async () => {
    const host = await mount({ groupBy: "institution", canEditItems: false });
    expect(titleCell(host, "가회사").getAttribute("draggable")).not.toBe("true");
    expect(host.querySelector('input[name="prefillKey"]')).toBeNull();
    expect(host.querySelector("[data-group-add]")).toBeNull();
  });

  it("묶음의 추가 줄은 첫 보드에 만들고 그 묶음 값을 미리 넣는다 · 「(없음)」 은 값 없이", async () => {
    const host = await mount({ groupBy: "institution" });
    const kibo = sectionOf(host, "기술보증기금");
    expect(kibo.querySelector<HTMLInputElement>('input[name="groupId"]')!.value).toBe("g1");
    expect(kibo.querySelector<HTMLInputElement>('input[name="prefillKey"]')!.value).toBe("institution");
    expect(kibo.querySelector<HTMLInputElement>('input[name="prefillValue"]')!.value).toBe(JSON.stringify("kibo"));
    const none = sectionOf(host, "(없음)");
    expect(none.querySelector('input[name="prefillKey"]')).toBeNull();
    // 띠 ＋ 는 그 묶음의 이름 칸으로 데려간다.
    const plus = kibo.querySelector<HTMLButtonElement>("[data-group-add]")!;
    expect(plus.getAttribute("aria-label")).toBe("기술보증기금에 새 항목 추가");
    await act(async () => plus.click());
    expect(document.activeElement).toBe(kibo.querySelector('input[name="title"]'));
  });

  it("사람 칸은 구성원 순서로 묶는다", async () => {
    const host = await mount({ groupBy: "owner" });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-empty-groups-toggle] button")!.click());
    expect(sections(host).map(({ title, rows: names }) => [title, names])).toEqual([
      ["가나", ["가회사"]],
      ["다라", []],
      ["(없음)", ["나회사", "다회사"]],
    ]);
  });
});

describe("고르는 곳 — 「나눠 보기」 칩 · 칸 메뉴", () => {
  it("칩의 보기 조건 칸에서 고르면 화면 안에서 바뀌고(다시 읽지 않는다) 주소에 남는다 · 바뀐 조건 1개", async () => {
    const host = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-view-chip="group"]')!.click());
    const panel = host.querySelector("#board-filter-panel")!;
    const labels = [...panel.querySelectorAll("[role=tabpanel] button")].map((button) => button.textContent?.replace("✓", ""));
    expect(labels).toEqual(["보드별로 나눠 보기", "진행기관별로 나눠 보기", "담당자별로 나눠 보기"]);
    await act(async () => [...panel.querySelectorAll<HTMLButtonElement>("[role=tabpanel] button")][1].click());
    expect(nav.navigateTo).not.toHaveBeenCalled();
    expect(new URL(window.location.href).searchParams.get("group")).toBe("institution");
    expect(sections(host)[0].title).toBe("신용보증기금");
    expect(host.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");
    // 되돌리기 — 보드별로.
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("[data-view-dirty-actions] button")].find((button) => button.textContent === "되돌리기")!.click());
    expect(sections(host).map(({ title }) => title)).toEqual(["준비단계", "진행중"]);
    expect(new URL(window.location.href).searchParams.has("group")).toBe(false);
  });

  it("칸 메뉴 「진행기관별로 나눠 보기」 — 나눌 수 있는 칸에만, 다시 누르면 보드별로", async () => {
    const host = await mount();
    await act(async () => columnTitle(host, "메모").click());
    expect(menuItem("메모별로 나눠 보기")).toBeUndefined();
    await act(async () => columnTitle(host, "메모").click());

    await act(async () => columnTitle(host, "진행기관").click());
    const item = menuItem("진행기관별로 나눠 보기")!;
    expect(item.getAttribute("aria-checked")).toBe("false");
    await act(async () => item.click());
    expect(sections(host).map(({ title }) => title)).toEqual(["신용보증기금", "기술보증기금", "(없음)"]);

    await act(async () => columnTitle(host, "진행기관").click());
    expect(menuItem("진행기관별로 나눠 보기")!.getAttribute("aria-checked")).toBe("true");
    await act(async () => menuItem("진행기관별로 나눠 보기")!.click());
    expect(sections(host).map(({ title }) => title)).toEqual(["준비단계", "진행중"]);
  });
});

describe("계약업체 실무 — 회사부터 고르는 추가", () => {
  it("묶음 ＋ 로 회사를 고르면 첫 보드에 시작하고 그 묶음 값을 넣는다 · 머리말 「＋ 업체 추가」 는 값 없는 「(없음)」 을 연다", async () => {
    const { CONTRACT_WORK_TAB_SOURCE } = await import("@/lib/default-tabs/contract-work");
    const startWork = vi.fn(async () => ({ ok: true, message: "업무를 시작했어요.", itemId: "new-9" }));
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const board = { id: "b", org_id: "o", name: "계약업체 실무", source: CONTRACT_WORK_TAB_SOURCE, is_system: false, sort_order: 0 } as Board;
    const picker = {
      rows: [{ company: { id: "c-1", org_id: "o", name: "가나상사" }, dealCount: 0, liveItemCount: 0 }],
      error: null,
      truncated: false,
    } as never;
    await act(async () => root!.render(
      <BoardWorkspace board={board} columns={[columns[0]]} groups={groups} rows={[rows[0]]} columnOrder={{}} cellFlash={null}
        assigneeLabels={{}} groupBy="institution" canEditItems canMoveRows
        contractWorkCompanyPicker={picker} startCompanyWorkAction={startWork as never} />,
    ));
    await act(async () => new Promise((done) => setTimeout(done, 0)));

    const kodit = sectionOf(host, "신용보증기금");
    const plus = kodit.querySelector<HTMLButtonElement>("[data-group-add]")!;
    expect(plus.getAttribute("aria-label")).toBe("신용보증기금에 업체 추가");
    await act(async () => plus.click());
    const search = kodit.querySelector<HTMLInputElement>('input[aria-label="업체 검색"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "가나");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (kodit.querySelector('input[name="companyId"][value="c-1"]')!.closest("form") as HTMLFormElement).requestSubmit());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(startWork).toHaveBeenCalledTimes(1);
    expect((startWork.mock.calls[0] as unknown as [unknown, FormData])[1].get("groupId")).toBe("g1");
    expect(actionMocks.setGroupValueAction).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(actionMocks.setGroupValueAction.mock.calls[0][0].entries())).toMatchObject({
      itemId: "new-9", columnKey: "institution", value: JSON.stringify("kodit"),
    });

    // 머리말 단추 — 접혀 있던 「(없음)」 을 펼치고 거기서 연다(값을 미리 넣지 않는다).
    expect(sections(host).map(({ title }) => title)).not.toContain("(없음)");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-mw-cta="primary"]')!.click());
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(sectionOf(host, "(없음)").querySelector('input[aria-label="업체 검색"]')).not.toBeNull();
  });
});
