// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function col(over: Partial<BoardColumn> & { key: string }): BoardColumn {
  const { key, ...rest } = over;
  return {
    id: `col-${key}`,
    org_id: "org",
    board_id: "b1",
    key,
    label: key,
    type: "select",
    source: "in",
    rightPinned: false,
    options_jsonb: {
      options: [
        { id: "a", label: "A", color: null, order: 0 },
        { id: "b", label: "B", color: null, order: 1 },
      ],
    } as never,
    sort_order: 0,
    width: null,
    ...rest,
  } as BoardColumn;
}

function row(id: string): ItemWithValues {
  return {
    id,
    org_id: "org",
    board_id: "b1",
    group_id: "g1",
    title: id,
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    values: { priority: "a", state: "a" },
  };
}

describe("GroupTable 일괄 상태 — 실제 컬럼 키 보존", () => {
  it("select 변경이 의도한 컬럼 키를 그대로 전달한다", async () => {
    const seen: { rowId: string; columnKey: string; value: string }[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <GroupTable
          boardId="b1"
          groupId="g1"
          columns={[col({ key: "priority", label: "우선순위" }), col({ key: "state", label: "상태" })]}
          rows={[row("row-1"), row("row-2")]}
          readOnly={false}
          rowDragEnabled={false}
          cellFlash={null}
          onColumnDrop={() => {}}
          dragRowId={null}
          canDropRow={() => false}
          onRowDragStart={() => {}}
          onRowDragEnd={() => {}}
          onRowDrop={() => {}}
          selection={new Set(["row-1", "row-2"])}
          onToggleRow={() => {}}
          onToggleGroup={() => {}}
          onBulkStatusRequest={(rowId, columnKey, presetValue) => {
            seen.push({ rowId, columnKey, value: presetValue });
            return true;
          }}
        />,
      );
    });

    // 2026-09-26 — 낱개 select 가 검색 콤보박스로 바뀌었다. 계약은 같다:
    // 일괄 가로채기가 (rowId, 실제 컬럼 키, 고른 값)으로 불린다.
    const priority = host.querySelector('input[aria-label="우선순위"]') as HTMLInputElement | null;
    expect(priority).not.toBeNull();
    await act(async () => {
      priority!.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(priority!, "B");
      priority!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      priority!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(seen).toEqual([{ rowId: "row-1", columnKey: "priority", value: "b" }]);

    const state = host.querySelectorAll('input[aria-label="상태"]')[0] as HTMLInputElement | null;
    expect(state).not.toBeNull();
  });

  it("핸들러가 false 면 일괄로 넘기지 않고 호출 키를 그대로 남긴다", async () => {
    const seen: { rowId: string; columnKey: string; value: string }[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <GroupTable
          boardId="b1"
          groupId="g1"
          columns={[col({ key: "priority", label: "우선순위" })]}
          rows={[row("row-1"), row("row-2")]}
          readOnly={false}
          rowDragEnabled={false}
          cellFlash={null}
          onColumnDrop={() => {}}
          dragRowId={null}
          canDropRow={() => false}
          onRowDragStart={() => {}}
          onRowDragEnd={() => {}}
          onRowDrop={() => {}}
          selection={new Set(["row-1", "row-2"])}
          onToggleRow={() => {}}
          onToggleGroup={() => {}}
          onBulkStatusRequest={(rowId, columnKey, presetValue) => {
            seen.push({ rowId, columnKey, value: presetValue });
            return false;
          }}
          cellAction={async () => {}}
        />,
      );
    });
    const select = host.querySelector('input[aria-label="우선순위"]') as HTMLInputElement | null;
    expect(select).not.toBeNull();
    await act(async () => {
      select!.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(select!, "B");
      select!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      select!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    // false 여도 호출 자체는 실제 키를 보존한다 — 되돌림/일괄 진입은 BoardWorkspace 판정이 맡는다.
    expect(seen).toEqual([{ rowId: "row-1", columnKey: "priority", value: "b" }]);
  });
});
