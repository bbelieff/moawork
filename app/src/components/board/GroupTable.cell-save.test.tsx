// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardCell } from "./GroupTable";
import { CellSaveContext, type CellSaveApi } from "./cell-save-context";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

// GroupTable이 쓰는 서버 액션은 비워 둔다 — 셀 저장은 컨텍스트가 맡는다.
vi.mock("@/app/(app)/boards/actions", () => ({
  renameItemAction: vi.fn(async () => {}),
  setCellAction: vi.fn(async () => {}),
  setColumnWidthAction: vi.fn(async () => {}),
}));
vi.mock("@/app/(app)/boards/title-actions", () => ({
  renameColumnTitleAction: vi.fn(async () => {}),
}));
vi.mock("@/app/(app)/boards/new-lead-actions", () => ({
  updateNewLeadFieldAction: vi.fn(async () => {}),
  updateNewLeadMetaAction: vi.fn(async () => {}),
  updateNewLeadTitleAction: vi.fn(async () => {}),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

// 편집 가능한 메모 칸 — GroupTable.test.tsx의 합성 방식을 따른다.
function memoColumn(): BoardColumn {
  return {
    id: "c1",
    org_id: "org-1",
    board_id: "b1",
    key: "memo",
    label: "메모",
    type: "text",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
  };
}

function memoRow(): ItemWithValues {
  return {
    id: "i1",
    org_id: "org-1",
    board_id: "b1",
    group_id: null,
    title: "행",
    assigned_to: null,
    deal_id: null,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    values: { memo: "이전" },
  };
}

function api(over: Partial<CellSaveApi> = {}): CellSaveApi {
  return {
    save: vi.fn(async (_formData: FormData) => {}),
    messageFor: () => undefined,
    ...over,
  };
}

function mount(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return host;
}

async function renderCell(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root?.render(node);
  });
}

function submitCellForm(host: HTMLElement): void {
  const form = host.querySelector("form") as HTMLFormElement | null;
  form?.requestSubmit();
}

describe("BoardCell 셀 저장", () => {
  it("셀 폼 제출이 컨텍스트 저장으로 간다", async () => {
    const host = mount();
    const save = vi.fn(async (_formData: FormData) => {});
    await renderCell(
      <CellSaveContext.Provider value={{ save, messageFor: () => undefined }}>
        <BoardCell boardId="b1" row={memoRow()} column={memoColumn()} readOnly={false} />
      </CellSaveContext.Provider>,
    );
    const input = host.querySelector('input[aria-label="메모"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (input) input.value = "새 값";
    await act(async () => {
      submitCellForm(host);
    });
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0]?.[0];
    expect(sent?.get("columnKey")).toBe("memo");
    expect(sent?.get("value")).toBe("새 값");
    expect(sent?.get("itemId")).toBe("i1");
  });

  it("컨텍스트 문구가 있으면 서버 플래시 대신 그 문구가 보인다", async () => {
    const host = mount();
    await renderCell(
      <CellSaveContext.Provider value={api({ messageFor: () => "칸 문구" })}>
        <BoardCell boardId="b1" row={memoRow()} column={memoColumn()} readOnly={false} error="플래시 오류" />
      </CellSaveContext.Provider>,
    );
    expect(host.textContent).toContain("칸 문구");
    expect(host.textContent).not.toContain("플래시 오류");
  });

  it("문구가 null이면 서버 플래시도 안 보인다", async () => {
    const host = mount();
    await renderCell(
      <CellSaveContext.Provider value={api({ messageFor: () => null })}>
        <BoardCell boardId="b1" row={memoRow()} column={memoColumn()} readOnly={false} error="플래시 오류" />
      </CellSaveContext.Provider>,
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain("플래시 오류");
  });

  it("cellAction이 있으면 컨텍스트 대신 그 액션이 불린다", async () => {
    const host = mount();
    const save = vi.fn(async (_formData: FormData) => {});
    const cellAction = vi.fn(async (_formData: FormData) => {});
    await renderCell(
      <CellSaveContext.Provider value={{ save, messageFor: () => undefined }}>
        <BoardCell boardId="b1" row={memoRow()} column={memoColumn()} readOnly={false} cellAction={cellAction} />
      </CellSaveContext.Provider>,
    );
    await act(async () => {
      submitCellForm(host);
    });
    expect(cellAction).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});
