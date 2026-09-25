// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/(app)/boards/bulk-actions", () => ({
  bulkApplyCellsAction: vi.fn(),
  bulkAssignAction: vi.fn(),
  bulkMoveGroupAction: vi.fn(),
}));

import { BulkActionBar } from "./BulkActionBar";

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const TARGETS = [
  { id: "item-a", title: "대한정밀" },
  { id: "item-b", title: "한빛상사" },
];

const STATUS = {
  key: "consult_status",
  label: "진행현황",
  options: [
    { id: "대기", label: "대기" },
    { id: "진행중", label: "진행중" },
  ],
};

async function mountDialog(onClose: () => void) {
  const host = document.createElement("div");
  document.body.append(host);
  const showModal = vi.fn(function (this: HTMLDialogElement) {
    Object.defineProperty(this, "open", { value: true, configurable: true });
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    Object.defineProperty(this, "open", { value: false, configurable: true });
  });
  HTMLDialogElement.prototype.showModal = showModal as never;
  HTMLDialogElement.prototype.close = close as never;
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <BulkActionBar
        boardId="board-a"
        workflowKind={null}
        totalSelected={2}
        targets={TARGETS}
        targetValues={{}}
        canEdit
        canMove
        statusColumn={STATUS}
        fieldColumns={[]}
        dateColumns={[]}
        members={[]}
        groups={[]}
        exportCsv=""
        exportFilename="board-a-selection.csv"
        dialog={{ op: "status" }}
        notice={null}
        onOpenDialog={() => {}}
        onCloseDialog={onClose}
        onClear={() => {}}
        onApplied={() => {}}
        onNotice={() => {}}
      />,
    );
  });
  const dialog = host.querySelector("dialog") as HTMLDialogElement | null;
  return { host, dialog, showModal, close };
}

describe("BulkActionBar DialogShell 모달 행위", () => {
  it("open 속성 없이 showModal 로 열고 backdrop 클릭으로 닫는다", async () => {
    const onClose = vi.fn();
    const { dialog, showModal } = await mountDialog(onClose);
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("open")).toBeNull();
    expect(showModal).toHaveBeenCalled();

    await act(async () => {
      dialog!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape(cancel)은 onClose 로 연결되고 포커스를 되돌린다", async () => {
    const outside = document.createElement("button");
    outside.textContent = "밖";
    document.body.append(outside);
    outside.focus();
    const onClose = vi.fn();
    const { dialog } = await mountDialog(onClose);
    expect(dialog).not.toBeNull();
    await act(async () => {
      dialog!.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => {
      root?.unmount();
      root = null;
    });
    expect(document.activeElement).toBe(outside);
  });
});
