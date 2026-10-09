// @vitest-environment jsdom
/**
 * #845 6단계 — 칸반도 표와 같은 보기 줄을 쓰고, 보기 조건을 화면에서 바로 건다(주소에 남는다).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/actions", () => ({ moveItemAction: vi.fn(), moveRowAction: vi.fn(), reorderGroupsAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { KanbanViewWorkspace } from "./KanbanViewWorkspace";
import { decodeBoardFilters, EMPTY_FILTERS } from "@/components/board/filters";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const columns = [{
  id: "c-status", org_id: "o", board_id: "b", key: "status", label: "상태", type: "select", source: "in",
  rightPinned: false, sort_order: 0, width: null, move_rule_jsonb: null,
  options_jsonb: { options: [{ id: "new", label: "신규", order: 0 }, { id: "done", label: "완료", order: 1 }] },
}] as BoardColumn[];
const item = (id: string, title: string, status: string, assigned: string | null): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: "g1", title, assigned_to: assigned, deal_id: null, sort_order: 0,
  created_at: "", updated_at: "", values: { status },
});
const items = [item("1", "가나정밀", "new", "me"), item("2", "다라식품", "done", "u2")];
const lanes = [{ key: "g1", label: "접수", color: null, items }];

let root: Root | null = null;
beforeEach(() => window.history.replaceState(null, "", "/boards/b?view=kanban"));
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  router.push.mockReset();
});

async function mount(initialFilters = EMPTY_FILTERS) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <KanbanViewWorkspace boardId="b" currentUserId="me" lanes={lanes} items={items} columns={columns}
      initialFilters={initialFilters} groupBy="" groupByOptions={[{ key: "status", label: "상태" }]}
      assigneeLabels={{ me: "나담당", u2: "가담당" }}
      readOnly rowOrderVersion={0} canMoveRows={false} canManageSections={false} isSystem={false} />,
  ));
  return host;
}
const cards = (host: ParentNode) => [...host.querySelectorAll("section li p.font-medium")].map((node) => node.textContent);

describe("#845 6단계 — 칸반의 보기 줄", () => {
  it("같은 보기 줄을 그리고 「칸반」 칩 · 건수가 보인다", async () => {
    const host = await mount();
    expect(host.querySelector('[data-view-chip="mode"]')!.textContent).toBe("칸반");
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("2건");
    expect(cards(host)).toEqual(["가나정밀", "다라식품"]);
  });

  it("주소의 조건으로 첫 화면부터 거르고, 담당 · 나 를 고르면 카드가 줄고 주소에 남는다", async () => {
    const host = await mount({ ...EMPTY_FILTERS, byColumn: { status: ["new", "done"] } });
    expect(cards(host)).toEqual(["가나정밀", "다라식품"]);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-view-chip="assignee"]')!.click());
    const mine = [...host.querySelectorAll<HTMLButtonElement>("#board-filter-panel [role=tabpanel] button")]
      .find((button) => button.textContent?.replace("✓", "") === "나")!;
    await act(async () => mine.click());
    expect(cards(host)).toEqual(["가나정밀"]);
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("내 담당 · 필터 1 · 2건 중 1건");
    expect(decodeBoardFilters(new URL(window.location.href).searchParams.get("mwFilters")).assignees).toEqual(["me"]);
  });

  it("나눠 보기 탭은 칸반에서 목록 칸으로 묶기를 고른다", async () => {
    const host = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-view-chip="group"]')!.click());
    const labels = [...host.querySelectorAll("#board-filter-panel [role=tabpanel] button")].map((button) => button.textContent?.replace("✓", ""));
    expect(labels).toEqual(["보드별로 나눠 보기", "상태별로 나눠 보기"]);
  });
});

describe("#845 — 칸반 레인 기준은 보기 줄의 「나눠 보기」 하나로", () => {
  it("상태별을 고르면 그 칸으로 레인을 다시 그린다 — 다시 읽지 않는 이동(router.push), 지금 조건은 주소에 남는다", async () => {
    const host = await mount({ ...EMPTY_FILTERS, byColumn: { status: ["new"] } });
    await act(async () => host.querySelector<HTMLButtonElement>('[data-view-chip="group"]')!.click());
    const byStatus = [...host.querySelectorAll<HTMLButtonElement>("#board-filter-panel [role=tabpanel] button")]
      .find((button) => button.textContent?.replace("✓", "") === "상태별로 나눠 보기")!;
    await act(async () => byStatus.click());
    expect(router.push).toHaveBeenCalledTimes(1);
    const next = new URL(router.push.mock.calls[0][0], "https://app.test");
    expect(next.pathname).toBe("/boards/b");
    expect(next.searchParams.get("view")).toBe("kanban");
    expect(next.searchParams.get("group")).toBe("status");
    expect(decodeBoardFilters(next.searchParams.get("mwFilters")).byColumn).toEqual({ status: ["new"] });
  });

  it("사람 칸 「이름순」 은 계정 id 가 아니라 이름으로 카드를 줄 세운다", async () => {
    const owner = {
      id: "c-owner", org_id: "o", board_id: "b", key: "owner", label: "담당자", type: "person", source: "in",
      rightPinned: false, sort_order: 1, width: null, move_rule_jsonb: null, options_jsonb: null,
    } as BoardColumn;
    const people = [
      { ...item("1", "하늘 건", "new", "u-1"), values: { status: "new", owner: "u-1" } },
      { ...item("2", "가람 건", "new", "u-2"), values: { status: "new", owner: "u-2" } },
    ];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(
      <KanbanViewWorkspace boardId="b" currentUserId="me" lanes={[{ key: "g1", label: "접수", color: null, items: people }]}
        items={people} columns={[...columns, owner]}
        initialFilters={{ ...EMPTY_FILTERS, sorts: [{ columnKey: "owner", direction: "asc" }] }}
        groupBy="" groupByOptions={[]} assigneeLabels={{ "u-1": "하늘", "u-2": "가람" }}
        readOnly rowOrderVersion={0} canMoveRows={false} canManageSections={false} isSystem={false} />,
    ));
    expect(cards(host)).toEqual(["가람 건", "하늘 건"]);
  });
});
