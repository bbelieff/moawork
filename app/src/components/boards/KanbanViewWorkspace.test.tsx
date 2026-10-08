// @vitest-environment jsdom
/**
 * #845 6단계 — 칸반도 표와 같은 보기 줄을 쓰고, 보기 조건을 화면에서 바로 건다(주소에 남는다).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/actions", () => ({ moveItemAction: vi.fn(), moveRowAction: vi.fn(), reorderGroupsAction: vi.fn() }));

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
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("내 담당 · 골라 보기 1 · 2건 중 1건");
    expect(decodeBoardFilters(new URL(window.location.href).searchParams.get("mwFilters")).assignees).toEqual(["me"]);
  });

  it("나눠 보기 탭은 칸반에서 목록 칸으로 묶기를 고른다", async () => {
    const host = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-view-chip="group"]')!.click());
    const labels = [...host.querySelectorAll("#board-filter-panel [role=tabpanel] button")].map((button) => button.textContent?.replace("✓", ""));
    expect(labels).toEqual(["보드별로 나눠 보기", "상태별로 나눠 보기"]);
  });
});
