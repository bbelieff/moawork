// @vitest-environment jsdom
/**
 * #845 8단계(2026-10-08) — 5~7단계(칸 메뉴 · 보기 막대 · 나눠 보기) 뒤에도 행 메뉴와 상세 ⋯ 휴지통이
 * 보드 화면 전체(BoardWorkspace)에서 그대로 도는지 «그려진 결과와 행동» 으로 잰다.
 *   · 보드별(기본)과 값 묶음(나눠 보기) 둘 다: 행 우클릭 → 옆에 열기 · 업체명/이름 바꾸기 | 휴지통으로 이동
 *   · 휴지통으로 이동 → 기존 trashItemAction(그 보드 · 그 행), 되돌리기 → 기존 restoreItemAction
 *   · 상세 ⋯ 「휴지통으로 이동」 → 상세를 닫고 같은 액션
 *   · 칸 제목 우클릭은 칸 메뉴 — 행 메뉴와 섞이지 않는다
 *   · 지울 권한이 없으면 두 곳 모두 「휴지통으로 이동」 이 없다
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trash = vi.hoisted(() => ({
  trashItemAction: vi.fn(),
  restoreItemAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/trash-actions", () => trash);
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
  trash.trashItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 휴지통으로 옮겼습니다." });
  trash.restoreItemAction.mockReset().mockResolvedValue({ ok: true, message: "항목을 원래 위치로 복구했습니다." });
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
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
      { id: "kodit", label: "신용보증기금" },
      { id: "kibo", label: "기술보증기금" },
    ] },
  }),
  column("c-memo", "memo", "메모", 1),
];
const row = (id: string, title: string, groupId: string, values: ItemWithValues["values"]): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: groupId, title, assigned_to: null, deal_id: null,
  sort_order: 0, created_at: "", updated_at: "", values,
});
const rows = [
  row("r1", "가회사", "g1", { institution: "kodit" }),
  row("r2", "나회사", "g2", { institution: "kibo" }),
];

async function mount({
  groupBy = "",
  canDeleteItems = true,
  boardRows = rows,
}: { groupBy?: string; canDeleteItems?: boolean; boardRows?: ItemWithValues[] } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "보드", source: "user", is_system: false, sort_order: 0 } as Board;
  await act(async () => root!.render(
    <BoardWorkspace
      board={board}
      columns={columns}
      groups={groups}
      rows={boardRows}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
      groupBy={groupBy}
      canEditItems
      canDeleteItems={canDeleteItems}
      canManageColumns
      canMoveRows
      itemDetailFixture={{ ok: true, events: [], links: [], files: [], members: [] }}
    />,
  ));
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  return host;
}

const titleCell = (host: ParentNode, rowTitle: string) =>
  [...host.querySelectorAll<HTMLElement>("td[data-board-title-cell]")].find((cell) => cell.querySelector("[data-row-name]")?.textContent === rowTitle)!;
const rowOf = (host: ParentNode, rowTitle: string) => titleCell(host, rowTitle).closest("tr")!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const menuLabels = () => [...(menu()?.querySelectorAll('[role^="menuitem"]') ?? [])].map((node) => node.textContent);
const detail = () => document.querySelector<HTMLElement>('[role="dialog"][data-item-detail-backdrop]');

async function rightClick(target: Element) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 140, clientY: 90 });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}
async function clickMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find((node) => node.textContent === label);
  expect(item).toBeDefined();
  await act(async () => { item!.click(); });
}

describe.each([
  ["보드별(기본)", ""],
  ["값 묶음(진행기관별로 나눠 보기)", "institution"],
])("행 우클릭 메뉴 — %s", (_label, groupBy) => {
  it("우클릭하면 행 메뉴가 뜨고 「휴지통으로 이동」 은 기존 휴지통 액션, 되돌리기는 기존 복구 액션", async () => {
    const host = await mount({ groupBy });
    const event = await rightClick(rowOf(host, "나회사").querySelector("td:last-child")!);
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.getAttribute("aria-label")).toBe("나회사 행 메뉴");
    expect(menuLabels()).toEqual(["옆에 열기", "이름 바꾸기", "휴지통으로 이동"]);

    await clickMenuItem("휴지통으로 이동");
    expect(trash.trashItemAction).toHaveBeenCalledTimes(1);
    const sent = trash.trashItemAction.mock.calls[0][1] as FormData;
    expect([sent.get("boardId"), sent.get("itemId")]).toEqual(["b", "r2"]);

    const toast = document.querySelector<HTMLElement>('[data-item-trash-toast="trashed"]');
    expect(toast?.textContent).toContain("「나회사」를 휴지통으로 옮겼어요");
    const undo = [...toast!.querySelectorAll("button")].find((button) => button.textContent === "되돌리기")!;
    await act(async () => { undo.click(); });
    expect(trash.restoreItemAction).toHaveBeenCalledTimes(1);
    expect((trash.restoreItemAction.mock.calls[0][1] as FormData).get("itemId")).toBe("r2");
  });

  it("「옆에 열기」 는 그 행의 상세를 열고, 상세 ⋯ 「휴지통으로 이동」 은 상세를 닫고 같은 액션을 부른다", async () => {
    const host = await mount({ groupBy });
    await rightClick(rowOf(host, "가회사"));
    await clickMenuItem("옆에 열기");
    expect(menu()).toBeNull();
    expect(detail()?.getAttribute("aria-label")).toBe("가회사 상세");

    const trashButton = detail()!.querySelector<HTMLButtonElement>("[data-item-detail-trash]");
    expect(trashButton?.textContent?.trim()).toBe("휴지통으로 이동");
    await act(async () => { trashButton!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(detail()).toBeNull();
    expect(trash.trashItemAction).toHaveBeenCalledTimes(1);
    const sent = trash.trashItemAction.mock.calls[0][1] as FormData;
    expect([sent.get("boardId"), sent.get("itemId")]).toEqual(["b", "r1"]);
  });

  it("지울 권한이 없으면 행 메뉴와 상세 ⋯ 어디에도 「휴지통으로 이동」 이 없다", async () => {
    const host = await mount({ groupBy, canDeleteItems: false });
    await rightClick(rowOf(host, "가회사"));
    expect(menuLabels()).toEqual(["옆에 열기", "이름 바꾸기"]);
    await clickMenuItem("옆에 열기");
    expect(detail()?.querySelector("[data-item-detail-trash]")).toBeNull();
  });
});

describe("휴지통으로 옮긴 뒤 초점", () => {
  const nameOf = (host: ParentNode, rowTitle: string) => titleCell(host, rowTitle).querySelector<HTMLElement>("[data-row-name]")!;

  it("보드 안 다음 행 이름 → 없으면 앞 행 이름(다른 보드 띠여도)", async () => {
    const host = await mount();
    await rightClick(rowOf(host, "나회사"));
    await clickMenuItem("휴지통으로 이동");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(nameOf(host, "가회사"));
  });

  it("남은 행이 없으면 머리말 주 단추(＋ 새 항목)로", async () => {
    const host = await mount({ boardRows: [rows[0]] });
    await rightClick(rowOf(host, "가회사"));
    await clickMenuItem("휴지통으로 이동");
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(host.querySelector('[data-board-action-rail] [data-mw-cta="primary"]'));
    expect(document.activeElement?.textContent).toContain("＋ 새 항목");
  });
});

describe("칸 제목 우클릭은 칸 메뉴", () => {
  it("제목행의 칸 이름을 우클릭하면 행 메뉴가 아니라 칸 메뉴가 뜬다", async () => {
    const host = await mount();
    const title = [...host.querySelectorAll<HTMLElement>('[data-board-table-part="head"] [data-column-title]')]
      .find((node) => node.textContent === "메모")!;
    await rightClick(title);
    expect(menu()).not.toBeNull();
    expect(menu()?.getAttribute("aria-label")).not.toContain("행 메뉴");
    expect(menuLabels()).not.toContain("휴지통으로 이동");
  });
});
