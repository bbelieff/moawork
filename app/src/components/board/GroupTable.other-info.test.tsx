// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { emptyOtherInfoValue } from "@/lib/boards/structured-field";
import { GroupTable } from "./GroupTable";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("routes a custom other_info table cell by its actual key without canonical legacy projection", async () => {
  const column: BoardColumn = {
    id: "column-custom",
    org_id: "org-a",
    board_id: "board-a",
    key: "custom_other_info",
    label: "추가 기타정보",
    type: "other_info",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
  };
  const row: ItemWithValues = {
    id: "item-a",
    org_id: "org-a",
    board_id: "board-a",
    group_id: null,
    title: "테스트 업체",
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
    values: { custom_other_info: emptyOtherInfoValue(), export_status: "수출 중" },
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <GroupTable
      boardId="board-a"
      groupId={null}
      columns={[column]}
      rows={[row]}
      readOnly={false}
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />,
  ));

  const trigger = host.querySelector<HTMLButtonElement>('[aria-label="기타정보 0건 편집"]')!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  expect(document.body.querySelector('form input[name="fieldKey"][value="custom_other_info"]')).not.toBeNull();
});
