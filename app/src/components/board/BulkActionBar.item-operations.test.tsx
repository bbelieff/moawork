// @vitest-environment jsdom
import { act, Fragment, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/(app)/boards/bulk-actions", () => ({
  bulkApplyCellsAction: vi.fn(),
  bulkAssignAction: vi.fn(),
  bulkMoveGroupAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-trash-actions", () => ({
  bulkTrashAction: vi.fn(),
  bulkRestoreAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-note-actions", () => ({
  bulkAddNoteAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-archive-actions", () => ({
  bulkArchiveAction: vi.fn(),
  bulkRestoreArchivedAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-duplicate-actions", () => ({
  bulkDuplicateAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-link-actions", () => ({
  bulkSetParentAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/bulk-export-actions", () => ({
  authorizeBoardCsvExport: vi.fn(),
}));

import { BulkActionBar, type BulkOpKind } from "./BulkActionBar";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const TARGETS = [
  { id: "item-a", title: "대한정밀", updatedAt: "2026-09-25T00:00:00.000Z" },
  { id: "item-b", title: "한빛상사", updatedAt: "2026-09-25T00:00:00.000Z" },
];

const CANDIDATES = [...TARGETS, { id: "item-c", title: "상위후보" }];

async function mountBar(op: BulkOpKind, over: Record<string, unknown> = {}, queuedNativeClose = false) {
  const host = document.createElement("div");
  document.body.append(host);
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    Object.defineProperty(this, "open", { value: true, configurable: true });
  }) as never;
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    if (!queuedNativeClose || !this.open) return;
    Object.defineProperty(this, "open", { value: false, configurable: true });
    // Browser close() updates .open immediately but queues the close event.
    // StrictMode reopens the same element before this queued task runs.
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  }) as never;
  const Wrapper = queuedNativeClose ? StrictMode : Fragment;
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Wrapper><BulkActionBar
        boardId="board-a"
        workflowKind={null}
        totalSelected={2}
        targets={TARGETS}
        targetValues={{}}
        canEdit
        canMove={false}
        canDelete
        statusColumn={null}
        fieldColumns={[]}
        dateColumns={[]}
        members={[]}
        groups={[]}
        linkCandidates={CANDIDATES}
        exportCsv=""
        exportFilename="board-a-selection.csv"
        dialog={{ op }}
        notice={null}
        onOpenDialog={() => {}}
        onCloseDialog={() => {}}
        onClear={() => {}}
        onApplied={() => {}}
        onNotice={() => {}}
        {...over}
      /></Wrapper>,
    );
  });
  return host;
}

describe("v17 아이템 연산 대화상자 (대상 미리보기·복구 행동)", () => {
  it("보관 대화상자는 대상 목록과 되돌리기 안내를 보여준다", async () => {
    const host = await mountBar("archive");
    const dialog = host.querySelector("dialog");
    expect(dialog?.textContent).toMatch(/선택 항목 보관/);
    expect(dialog?.textContent).toMatch(/대한정밀/);
    expect(dialog?.textContent).toMatch(/한빛상사/);
    expect(dialog?.textContent).toMatch(/휴지통과 별도/);
    expect(host.querySelector("button")?.textContent ?? "").toBeTruthy();
  });

  it("복제 대화상자는 미복사 항목과 되돌리기 불가를 명시한다", async () => {
    const host = await mountBar("duplicate");
    const dialog = host.querySelector("dialog");
    expect(dialog?.textContent).toMatch(/선택 항목 복제/);
    expect(dialog?.textContent).toMatch(/승인·직인·서명/);
    expect(dialog?.textContent).toMatch(/되돌릴 수 없습니다/);
    expect(dialog?.textContent).toMatch(/전화번호·이메일·외부 식별번호/);
    expect(dialog?.textContent).toMatch(/새 행은 내가 담당합니다/);
  });

  it("상하위 대화상자는 후보 목록과 암묵 일괄수정 없음 안내를 보여준다", async () => {
    const host = await mountBar("link");
    const dialog = host.querySelector("dialog");
    expect(dialog?.textContent).toMatch(/상하위 항목 연결/);
    expect(dialog?.textContent).toMatch(/함께 바뀌거나 지워지지 않습니다/);
    const select = dialog?.querySelector("select[aria-label='상위 항목']");
    expect(select?.textContent).toMatch(/상위후보/);
    // 선택 중인 행은 부모 후보에서 빠진다 (자기참조 방지).
    expect(select?.textContent).not.toMatch(/대한정밀/);
  });

  it("바에 보관·복제·상위연결 버튼이 뜬다", async () => {
    const host = await mountBar("status", { dialog: null });
    const buttons = [...host.querySelectorAll("button[data-bulk-op]")].map((button) => button.getAttribute("data-bulk-op"));
    expect(buttons).toContain("archive");
    expect(buttons).toContain("duplicate");
    expect(buttons).toContain("link");
  });

  it("삭제 권한이 없으면 보관 버튼이 뜨지 않는다", async () => {
    const host = await mountBar("status", { dialog: null, canDelete: false });
    const buttons = [...host.querySelectorAll("button[data-bulk-op]")].map((button) => button.getAttribute("data-bulk-op"));
    expect(buttons).not.toContain("archive");
  });
});


describe("bulk dialog queued native close events", () => {
  it("stays open after StrictMode cleanup queues a close event and setup reopens it", async () => {
    vi.useFakeTimers();
    const onCloseDialog = vi.fn();
    const host = await mountBar("status", {
      onCloseDialog,
      statusColumn: { key: "status", label: "상태", columnId: "status-column", options: [{ id: "open", label: "진행" }] },
    }, true);
    const dialog = host.querySelector("dialog")!;
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(true);
    await act(async () => vi.runOnlyPendingTimers());
    expect(onCloseDialog).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("still reports a genuine native close and Escape cancellation", async () => {
    vi.useFakeTimers();
    const onCloseDialog = vi.fn();
    const host = await mountBar("archive", { onCloseDialog }, true);
    const dialog = host.querySelector("dialog")!;
    await act(async () => vi.runOnlyPendingTimers());
    onCloseDialog.mockClear();
    await act(async () => dialog.close());
    expect(dialog.open).toBe(false);
    await act(async () => vi.runOnlyPendingTimers());
    expect(onCloseDialog).toHaveBeenCalledTimes(1);
    dialog.showModal();
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(onCloseDialog).toHaveBeenCalledTimes(2);
  });
});
