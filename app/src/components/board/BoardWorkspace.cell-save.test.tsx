// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellSaveResult } from "@/lib/boards/cell-save-result";

const saveMocks = vi.hoisted(() => ({ saveCellValueAction: vi.fn() }));
vi.mock("@/app/(app)/boards/cell-save-actions", () => ({ saveCellValueAction: saveMocks.saveCellValueAction }));
const routerMocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/board-1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: routerMocks.refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

import { BoardWorkspace } from "./BoardWorkspace";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  saveMocks.saveCellValueAction.mockReset();
  routerMocks.refresh.mockReset();
  vi.useRealTimers();
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const group = { id: "group-1", org_id: "org-1", board_id: "board-1", name: "대기", color: null, sort_order: 0 };
const column = {
  id: "col-stage", org_id: "org-1", board_id: "board-1", key: "stage", label: "단계", type: "select", source: "in",
  rightPinned: false, sort_order: 0, width: null, is_readonly: false,
  options_jsonb: { options: [{ id: "a", label: "접수", order: 0 }, { id: "b", label: "진행", order: 1 }] },
};
const row = {
  id: "item-1", org_id: "org-1", board_id: "board-1", group_id: "group-1", title: "합성 회사", assigned_to: null,
  deal_id: null, sort_order: 0, created_at: "", updated_at: "", values: { stage: "a" },
};
const board = { id: "board-1", org_id: "org-1", name: "보드", icon: null, description: null, source: "user", is_system: false, sort_order: 0, row_order_version: 0 };

function workspace() {
  return (
    <BoardWorkspace board={board as never} columns={[column as never]} groups={[group as never]} rows={[row as never]}
      columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems />
  );
}

function stageInput(host: HTMLElement) {
  return host.querySelector<HTMLInputElement>('input[role="combobox"][aria-label="단계"]')!;
}

async function pick(host: HTMLElement, label: string) {
  const input = stageInput(host);
  await act(async () => {
    input.blur();
    input.focus();
  });
  const option = [...host.querySelectorAll<HTMLButtonElement>('[role="option"] button')].find((button) => button.textContent?.includes(label))!;
  await act(async () => option.click());
}

describe("Issue 857 — 칸 저장은 그 행만 고친다", () => {
  it("고른 값이 바로 보이고, 서버가 돌려준 행으로 그대로 남는다", async () => {
    let finish!: (result: CellSaveResult) => void;
    saveMocks.saveCellValueAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(workspace()));
    expect(stageInput(host).placeholder).toBe("접수");

    await pick(host, "진행");
    expect(stageInput(host).placeholder).toBe("진행");
    const sent = saveMocks.saveCellValueAction.mock.calls[0][0] as FormData;
    expect(sent.get("columnKey")).toBe("stage");
    expect(sent.get("value")).toBe("b");

    await act(async () => finish({ ok: true, item: { ...row, values: { stage: "b" } } as never, errors: [], notices: [] }));
    expect(stageInput(host).placeholder).toBe("진행");
    expect(stageInput(host).hasAttribute("data-saving")).toBe(false);
  });

  it("서버가 거절하면 원래 값으로 돌아가고 칸 아래에 사유가 보인다", async () => {
    saveMocks.saveCellValueAction.mockResolvedValueOnce({
      ok: false, errors: [{ key: "stage", label: "단계", message: "이 업무를 실행할 권한이 없어요." }],
    } satisfies CellSaveResult);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(workspace()));

    await pick(host, "진행");
    expect(stageInput(host).placeholder).toBe("접수");
    expect(host.textContent).toContain("이 업무를 실행할 권한이 없어요.");
  });

  it("서버가 화면을 새로 보내면 그 값이 이긴다", async () => {
    saveMocks.saveCellValueAction.mockResolvedValueOnce({
      ok: true, item: { ...row, values: { stage: "b" } } as never, errors: [], notices: [],
    } satisfies CellSaveResult);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(workspace()));
    await pick(host, "진행");
    expect(stageInput(host).placeholder).toBe("진행");

    // 다른 사람이 바꾼 값(접수)이 새 화면으로 오면 이 화면에서 얹은 값은 버린다.
    await act(async () => root?.render(
      <BoardWorkspace board={board as never} columns={[column as never]} groups={[group as never]}
        rows={[{ ...row, values: { stage: "a" } } as never]} columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems />,
    ));
    expect(stageInput(host).placeholder).toBe("접수");
  });

  it("Issue 857 검토 — 저장이 멈추면 화면 데이터를 조용히 한 번 새로 받는다(실패는 받지 않는다)", async () => {
    vi.useFakeTimers();
    saveMocks.saveCellValueAction
      .mockResolvedValueOnce({ ok: false, errors: [{ key: "stage", label: "단계", message: "실패" }] } satisfies CellSaveResult)
      .mockResolvedValueOnce({ ok: true, item: { ...row, values: { stage: "b" } } as never, errors: [], notices: [] } satisfies CellSaveResult);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(workspace()));

    await pick(host, "진행");
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(routerMocks.refresh).not.toHaveBeenCalled();

    await pick(host, "진행");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(routerMocks.refresh).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(routerMocks.refresh).toHaveBeenCalledTimes(1);
  });
});
