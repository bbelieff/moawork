// @vitest-environment jsdom
/**
 * #845 5단계(2026-10-08) — 칸 메뉴 「보기 · 나만」 이 보드의 보기 상태를 실제로 바꾸는지 «그려진 결과» 로 잰다.
 *   · 정렬 → 행 순서가 바뀌고 보기 줄 「정렬」 칩이 켜진다(주소·«저장» 이 담는 같은 상태 — 뷰가 «바뀜»)
 *   · 숨기기 → 그 칸이 이 뷰에서 빠진다(보이는 칸)
 *   · 필터… → 「보기 조건」 칸이 필터 탭으로 펴지고 그 칸의 칩이 열린다(6단계)
 *   · 사람·목록 칸 정렬은 저장값(id)이 아니라 이름으로
 *   · 칸 순서는 여전히 보드 전체 저장(모두에게) — 보기 상태(필터)를 바꾸지 않는다
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  setGroupColumnOrdersAction: vi.fn(async () => {}),
  runColumnCommandAction: vi.fn<(state: unknown, data: FormData) => Promise<{ ok: boolean; message: string | null; archivedColumnId?: string }>>(),
}));
vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  setGroupColumnOrdersAction: actionMocks.setGroupColumnOrdersAction,
}));
vi.mock("@/app/(app)/boards/column-command-actions", () => ({ runColumnCommandAction: actionMocks.runColumnCommandAction }));
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
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  actionMocks.setGroupColumnOrdersAction.mockClear();
  actionMocks.runColumnCommandAction.mockReset();
});

const groups = [{ id: "g1", org_id: "o", board_id: "b", name: "접수", color: null, sort_order: 0 }] as BoardGroup[];
const column = (id: string, key: string, label: string, sort: number, over: Partial<BoardColumn> = {}) => ({
  id, org_id: "o", board_id: "b", key, label, type: "text", source: "in", rightPinned: false,
  sort_order: sort, width: null, options_jsonb: null, move_rule_jsonb: null, ...over,
}) as BoardColumn;
const columns = [
  column("c-kind", "kind", "구분", 0, {
    type: "select",
    options_jsonb: { options: [{ id: "법인", label: "법인", order: 0 }, { id: "개인", label: "개인", order: 1 }] },
  }),
  column("c-rep", "rep_name", "대표자명", 1),
];
const row = (id: string, title: string, values: ItemWithValues["values"], sort: number): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: "g1", title, assigned_to: null, deal_id: null,
  sort_order: sort, created_at: "", updated_at: "", values,
});
const rows = [
  row("r1", "가나정밀", { kind: "법인", rep_name: "하늘" }, 0),
  row("r2", "다라식품", { kind: "개인", rep_name: "가람" }, 1),
];

async function mount(over: { columns?: BoardColumn[]; rows?: ItemWithValues[]; assigneeLabels?: Record<string, string> } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "보드", source: "user", is_system: false, sort_order: 0 } as Board;
  await act(async () => root!.render(
    <BoardWorkspace
      board={board}
      columns={over.columns ?? columns}
      groups={groups}
      rows={over.rows ?? rows}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={over.assigneeLabels ?? {}}
      canEditItems
      canManageColumns
      canMoveRows
    />,
  ));
  // 주소의 필터를 읽는 첫 타이머를 흘려보낸다.
  await act(async () => new Promise((done) => setTimeout(done, 0)));
  return host;
}

const head = (host: ParentNode) => host.querySelector('[data-board-table-part="head"]')!;
const title = (host: ParentNode, label: string) =>
  [...head(host).querySelectorAll<HTMLElement>("[data-column-title]")].find((node) => node.textContent === label)!;
const rowNames = (host: ParentNode) => [...host.querySelectorAll("tbody [data-row-name]")].map((node) => node.textContent);
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')].find((item) => item.textContent === label);

async function choose(host: ParentNode, columnLabel: string, itemLabel: string) {
  await act(async () => title(host, columnLabel).click());
  const item = menuItem(itemLabel);
  expect(item, itemLabel).toBeDefined();
  await act(async () => item!.click());
}

describe("칸 메뉴 「보기」 → 보드의 보기 상태", () => {
  it("정렬은 행 순서를 바꾸고 보기 줄 「정렬」 칩이 켜지며(뷰가 바뀜), 되돌리면 원래 순서", async () => {
    const host = await mount();
    expect(rowNames(host)).toEqual(["가나정밀", "다라식품"]);
    await choose(host, "대표자명", "가나다순");
    expect(rowNames(host)).toEqual(["다라식품", "가나정밀"]);
    const sortChip = host.querySelector<HTMLElement>('[data-view-chip="sort"]')!;
    expect(sortChip.textContent).toBe("정렬1");
    expect(sortChip.className).toContain("bg-mw-tint-blue");
    // 메인 테이블 기준(조건 없음)과 달라졌다 — 탭에 점, 되돌리기·저장이 선다.
    expect(host.querySelector('[data-view-tab="main"] [data-view-dirty-dot]')).not.toBeNull();
    expect(host.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");
    expect(host.querySelector("[data-view-dirty-actions]")!.textContent).toContain("되돌리기");
    expect(new URL(window.location.href).searchParams.get("mwFilters")).toContain('"sorts":[{"columnKey":"rep_name","direction":"asc"}]');
    await choose(host, "대표자명", "원래 순서로");
    expect(rowNames(host)).toEqual(["가나정밀", "다라식품"]);
  });

  it("숨기기는 그 칸을 이 뷰에서 빼고(보이는 칸) 칸 구조는 건드리지 않는다", async () => {
    const host = await mount();
    await choose(host, "대표자명", "숨기기");
    expect(head(host).querySelector('th[data-column-key="rep_name"]')).toBeNull();
    expect(head(host).querySelector('th[data-column-key="kind"]')).not.toBeNull();
    expect(host.querySelector('[data-view-chip="columns"]')!.textContent).toBe("칸 숨기기1");
    expect(actionMocks.setGroupColumnOrdersAction).not.toHaveBeenCalled();
  });

  it("숨긴 뒤 초점은 옆 칸 이름으로 — 오른쪽이 없으면 왼쪽(<body> 로 떨어지지 않는다)", async () => {
    const host = await mount({
      columns: [...columns, column("c-memo", "memo", "메모", 2)],
    });
    await choose(host, "대표자명", "숨기기");
    expect(document.activeElement).toBe(title(host, "메모"));
    await choose(host, "메모", "숨기기");
    expect(document.activeElement).toBe(title(host, "구분"));
  });

  it("필터…는 보기 조건 칸을 필터 탭으로 펴고 그 칸의 칩을 연다", async () => {
    const host = await mount();
    expect(host.querySelector("#board-filter-panel")).toBeNull();
    await choose(host, "구분", "필터…");
    expect(host.querySelector("#board-filter-panel")).not.toBeNull();
    expect(host.querySelector('#board-filter-panel [role="tab"][aria-selected="true"]')!.textContent).toBe("필터");
    const chip = document.querySelector('[role="dialog"][aria-label="구분 필터"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("법인");
    // 글자 칸은 지금 필터 화면이 다루지 않아 그 항목이 없다.
    await act(async () => title(host, "대표자명").click());
    expect(menuItem("필터…")).toBeUndefined();
  });

  it("목록 칸 「가나다순」 은 선택지 이름으로, 사람 칸 「이름순」 은 이름으로 줄 세운다(저장된 id 순이 아니다)", async () => {
    const named = [
      column("c-stage", "stage", "단계", 0, {
        type: "select",
        options_jsonb: { options: [{ id: "s1", label: "접수", order: 0 }, { id: "s2", label: "계약", order: 1 }] },
      }),
      column("c-owner", "owner_id", "담당", 1, { type: "person" }),
    ];
    const host = await mount({
      columns: named,
      rows: [
        row("r1", "가나정밀", { stage: "s1", owner_id: "u-a" }, 0),
        row("r2", "다라식품", { stage: "s2", owner_id: "u-b" }, 1),
      ],
      assigneeLabels: { "u-a": "하늘", "u-b": "가람" },
    });
    expect(rowNames(host)).toEqual(["가나정밀", "다라식품"]);
    await choose(host, "단계", "가나다순");
    expect(rowNames(host)).toEqual(["다라식품", "가나정밀"]);
    await choose(host, "단계", "원래 순서로");
    expect(rowNames(host)).toEqual(["가나정밀", "다라식품"]);
    await choose(host, "담당", "이름순");
    expect(rowNames(host)).toEqual(["다라식품", "가나정밀"]);
  });

  it("칸 옮기기는 보기 상태가 아니라 보드 전체 저장이다(모두에게)", async () => {
    const host = await mount();
    await choose(host, "대표자명", "왼쪽으로");
    expect(actionMocks.setGroupColumnOrdersAction).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.get("mwFilters")).toBeNull();
  });
});

/*
 * #845 검토(gates-column-undo-string-only) — 칸 메뉴 「지우기」 → 확인 → 칸이 이 화면에서 빠지고
 * 「칸을 휴지통으로 옮겼어요.」 줄의 「되돌리기」 가 같은 칸의 restore 를 보낸다(글자 확인이 아니라 행동으로).
 */
describe("칸 지우기 → 되돌리기", () => {
  it("지운 칸은 빠지고 알림 줄이 뜨며, 되돌리기는 operation=restore 로 그 칸을 보낸다", async () => {
    actionMocks.runColumnCommandAction.mockImplementation(async (_state, data) => (
      data.get("operation") === "archive"
        ? { ok: true, message: null, archivedColumnId: String(data.get("columnId")) }
        : { ok: true, message: null }
    ));
    const host = await mount();
    await choose(host, "대표자명", "지우기");
    const confirm = document.querySelector<HTMLElement>("[data-column-delete-confirm]")!;
    const remove = [...confirm.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "지우기")!;
    await act(async () => remove.click());

    const archive = actionMocks.runColumnCommandAction.mock.calls[0][1];
    expect([archive.get("operation"), archive.get("columnId"), archive.get("boardId")]).toEqual(["archive", "c-rep", "b"]);
    expect(head(host).querySelector('th[data-column-key="rep_name"]')).toBeNull();
    const notice = [...host.querySelectorAll<HTMLElement>('[role="status"]')].find((node) => node.textContent?.includes("칸을 휴지통으로 옮겼어요."));
    expect(notice).toBeDefined();

    const undo = [...notice!.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "되돌리기")!;
    await act(async () => undo.click());
    expect(actionMocks.runColumnCommandAction).toHaveBeenCalledTimes(2);
    const restore = actionMocks.runColumnCommandAction.mock.calls[1][1];
    expect([restore.get("operation"), restore.get("columnId"), restore.get("boardId")]).toEqual(["restore", "c-rep", "b"]);
    expect(head(host).querySelector('th[data-column-key="rep_name"]')).not.toBeNull();
    expect(host.textContent).not.toContain("칸을 휴지통으로 옮겼어요.");
  });
});
