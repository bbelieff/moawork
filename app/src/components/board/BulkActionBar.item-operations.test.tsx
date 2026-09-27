// @vitest-environment jsdom
import { act, Fragment, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const transitionHold = vi.hoisted(() => ({ promise: null as Promise<void> | null }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useTransition: () => {
    const [pending, start] = react.useTransition();
    return [pending, (action: () => void | Promise<void>) => start(async () => {
      const hold = transitionHold.promise;
      await action();
      if (hold) await hold;
    })] as const;
  } };
});

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

import { bulkDuplicateAction } from "@/app/(app)/boards/bulk-duplicate-actions";
import { bulkSetParentAction } from "@/app/(app)/boards/bulk-link-actions";
beforeEach(() => { vi.clearAllMocks(); transitionHold.promise = null; });

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
  function Harness() {
    const [dialog, setDialog] = useState<{ op: BulkOpKind } | null>({ op });
    return <BulkActionBar
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
        dialog={dialog}
        notice={null}
        onOpenDialog={(next) => setDialog({ op: next })}
        onCloseDialog={() => setDialog(null)}
        onClear={() => {}}
        onApplied={() => {}}
        onNotice={() => {}}
        {...over}
      />;
  }
  await act(async () => { root?.render(<Wrapper><Harness /></Wrapper>); });
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

function button(host: HTMLElement, text: string) {
  const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text);
  expect(match, text).toBeDefined();
  return match!;
}

it("shows completion even while the router transition waits, and never re-submits successful rows", async () => {
  let release!: () => void;
  transitionHold.promise = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(bulkDuplicateAction).mockResolvedValue({ ok: true, applied: 2, failed: 0,
    results: TARGETS.map((row) => ({ itemId: row.id, ok: true, message: "복제됨", newItemId: row.id + "-copy" })) });
  const host = await mountBar("duplicate");
  await act(async () => { button(host, "2개 복제하기").click(); button(host, "2개 복제하기").click(); });
  expect(vi.mocked(bulkDuplicateAction)).toHaveBeenCalledTimes(1);
  const complete = button(host, "복제 완료");
  expect(complete.disabled).toBe(true);
  expect(host.textContent).not.toContain("복제하는 중");
  await act(async () => { complete.click(); release(); });
  expect(vi.mocked(bulkDuplicateAction)).toHaveBeenCalledTimes(1);
});

it("keeps the same idempotency key after a transport failure", async () => {
  vi.mocked(bulkDuplicateAction).mockRejectedValueOnce(new Error("transport"))
    .mockResolvedValueOnce({ ok: true, applied: 2, failed: 0,
      results: TARGETS.map((row) => ({ itemId: row.id, ok: true, message: "복제됨", newItemId: row.id + "-copy" })) });
  const host = await mountBar("duplicate");
  await act(async () => button(host, "2개 복제하기").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("같은 요청");
  await act(async () => button(host, "2개 복제하기").click());
  expect(vi.mocked(bulkDuplicateAction).mock.calls[1][0]).toEqual(vi.mocked(bulkDuplicateAction).mock.calls[0][0]);
  expect(button(host, "복제 완료").disabled).toBe(true);
});

it("retries only failed rows while retaining earlier duplicate successes", async () => {
  vi.mocked(bulkDuplicateAction).mockResolvedValueOnce({ ok: false, applied: 1, failed: 1, results: [
    { itemId: "item-a", ok: true, message: "복제됨", newItemId: "copy-a" },
    { itemId: "item-b", ok: false, message: "일시 실패", newItemId: null },
  ] }).mockResolvedValueOnce({ ok: true, applied: 1, failed: 0, results: [
    { itemId: "item-b", ok: true, message: "복제됨", newItemId: "copy-b" },
  ] });
  const host = await mountBar("duplicate");
  await act(async () => button(host, "2개 복제하기").click());
  await act(async () => button(host, "1개 복제하기").click());
  expect(vi.mocked(bulkDuplicateAction).mock.calls[1][0].itemIds).toEqual(["item-b"]);
  expect(host.textContent).toContain("2개 복제됨");
});

it("preselects a shared visible parent and shows unlink success in the current relation", async () => {
  const host = await mountBar("link", { targets: TARGETS.map((row) => ({ ...row, parentItemId: "item-c" })) });
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="상위 항목"]')!;
  expect(select.value).toBe("item-c");
  expect(host.querySelector('[aria-label="현재 상위 연결"]')?.textContent).toContain("상위후보");
  vi.mocked(bulkSetParentAction).mockResolvedValue({ ok: true, applied: 2, failed: 0,
    results: TARGETS.map((row) => ({ itemId: row.id, ok: true, message: "해제됨" })) });
  await act(async () => button(host, "연결 해제").click());
  expect(host.querySelector('[aria-label="현재 상위 연결"]')?.textContent).not.toContain("상위후보");
  expect(host.querySelector('[aria-label="현재 상위 연결"]')?.textContent).toContain("연결 없음");
  expect(vi.mocked(bulkSetParentAction).mock.calls[0][0].parentItemId).toBeNull();
});

it("does not pick a parent for mixed relations or expose an unavailable parent's identifier", async () => {
  const host = await mountBar("link", { targets: [
    { ...TARGETS[0], parentItemId: "private-parent-id" }, { ...TARGETS[1], parentItemId: "item-c" },
  ] });
  expect(host.querySelector<HTMLSelectElement>('select[aria-label="상위 항목"]')?.value).toBe("");
  expect(host.textContent).toContain("현재 보기에서 확인할 수 없음");
  expect(host.innerHTML).not.toContain("private-parent-id");
});


it("preserves an uncertain request across reopen, then starts a new intent after confirmed completion", async () => {
  const success = { ok: true, applied: 2, failed: 0,
    results: TARGETS.map((row) => ({ itemId: row.id, ok: true, message: "복제됨", newItemId: row.id + "-copy" })) };
  vi.mocked(bulkDuplicateAction).mockRejectedValueOnce(new Error("lost response")).mockResolvedValue(success);
  const host = await mountBar("duplicate");
  await act(async () => button(host, "2개 복제하기").click());
  await act(async () => button(host, "닫기").click());
  expect(host.querySelector("dialog")).toBeNull();
  await act(async () => button(host, "복제").click());
  await act(async () => button(host, "2개 복제하기").click());
  const calls = vi.mocked(bulkDuplicateAction).mock.calls;
  expect(calls[1][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
  await act(async () => button(host, "닫기").click());
  await act(async () => button(host, "복제").click());
  await act(async () => button(host, "2개 복제하기").click());
  expect(calls[2][0].idempotencyKey).not.toBe(calls[0][0].idempotencyKey);
});

it("keeps the dialog open while the save is in flight, including Escape", async () => {
  let release!: (value: Awaited<ReturnType<typeof bulkDuplicateAction>>) => void;
  vi.mocked(bulkDuplicateAction).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const host = await mountBar("duplicate");
  await act(async () => button(host, "2개 복제하기").click());
  await act(async () => {
    button(host, "닫기").click();
    host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(host.querySelector("dialog")).not.toBeNull();
  expect(bulkDuplicateAction).toHaveBeenCalledTimes(1);
  await act(async () => release({ ok: true, applied: 2, failed: 0,
    results: TARGETS.map((row) => ({ itemId: row.id, ok: true, message: "복제됨", newItemId: row.id + "-copy" })) }));
  await act(async () => button(host, "닫기").click());
  expect(host.querySelector("dialog")).toBeNull();
});


it("retains the original key for unresolved rows when the selection changes after a lost response", async () => {
  vi.mocked(bulkDuplicateAction).mockRejectedValueOnce(new Error("lost response"))
    .mockImplementation(async ({ itemIds }) => ({ ok: true, applied: itemIds.length, failed: 0,
      results: itemIds.map((id) => ({ itemId: id, ok: true, message: "복제됨", newItemId: id + "-copy" })) }));
  const over = { targets: TARGETS };
  const host = await mountBar("duplicate", over);
  await act(async () => button(host, "2개 복제하기").click());
  await act(async () => button(host, "닫기").click());
  over.targets = [TARGETS[0]];
  await act(async () => button(host, "복제").click());
  await act(async () => button(host, "1개 복제하기").click());
  await act(async () => button(host, "닫기").click());
  over.targets = [TARGETS[1]];
  await act(async () => button(host, "복제").click());
  await act(async () => button(host, "1개 복제하기").click());
  const calls = vi.mocked(bulkDuplicateAction).mock.calls;
  expect(calls[1][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
  expect(calls[2][0].idempotencyKey).toBe(calls[0][0].idempotencyKey);
});
