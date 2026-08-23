// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ItemDetailPanel } from "./ItemDetailPanel";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

const columns: BoardColumn[] = [{
  id: "col-company", org_id: "org-a", board_id: "board-a", key: "company", label: "회사명",
  type: "text", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
}];
const row: ItemWithValues = {
  id: "item-a", org_id: "org-a", board_id: "board-a", group_id: "group-a", title: "대한정밀",
  assigned_to: "user-a", deal_id: null, sort_order: 0, created_at: "2026-08-16T00:00:00Z", updated_at: "2026-08-16T00:00:00Z",
  values: { company: "대한정밀", hidden_legacy: "보존값" },
};

type CloseChannel = "Escape" | "backdrop" | "close button";

let mountedRoot: Root | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
});

async function renderInteractivePanel() {
  const container = document.createElement("div");
  document.body.append(container);
  mountedRoot = createRoot(container);

  await act(async () => {
    mountedRoot?.render(<ItemDetailPanel
      boardId="board-a"
      row={row}
      columns={columns}
      boardLayout={[{ key: "company", source: "column" }]}
      layout={[{ key: "company", source: "column" }]}
      inherited
      canEditItems
      canManageColumns
    />);
  });

  const opener = document.querySelector<HTMLButtonElement>('[aria-label="대한정밀 상세 열기"]');
  expect(opener).not.toBeNull();
  await act(async () => opener?.click());

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="상세 닫기"]');
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(dialog).not.toBeNull();
  expect(closeButton).not.toBeNull();
  expect(document.activeElement).toBe(closeButton);

  return { opener: opener!, dialog: dialog!, closeButton: closeButton! };
}

async function closePanel(channel: CloseChannel, dialog: HTMLElement, closeButton: HTMLButtonElement) {
  await act(async () => {
    if (channel === "Escape") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else if (channel === "backdrop") {
      dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    } else {
      closeButton.click();
    }
  });
}

function renderStaticPanel(element: ReactNode) {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Reflect.deleteProperty(globalThis, "document");
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
  }
}

const sourcePath = resolve(process.cwd(), "src/components/board/ItemDetailPanel.tsx");

describe("BBE-107 실제 상세 패널", () => {
  it("상속 상태와 미배치 값 회수, 1440/375 공통 반응형 패널 계약을 렌더한다", () => {
    const html = renderStaticPanel(<ItemDetailPanel
      boardId="board-a"
      row={row}
      columns={columns}
      boardLayout={[{ key: "company", source: "column" }]}
      layout={[{ key: "company", source: "column" }]}
      inherited
      canEditItems
      canManageColumns
      defaultOpen
    />);
    expect(html).toContain("보드 기본 배치를 상속 중");
    expect(html).toContain("이 화면에 배치되지 않은 항목 1개");
    expect(html).toContain("hidden_legacy");
    expect(html).toContain("배치에 추가");
    expect(html).toContain("w-full max-w-xl");
  });

  it("상세 전용 필드는 표 승격 동작을 제공한다", () => {
    const html = renderStaticPanel(<ItemDetailPanel
      boardId="board-a"
      row={{ ...row, values: { detail_note: "메모" } }}
      columns={columns}
      boardLayout={[]}
      layout={[{ key: "detail_note", source: "detail", label: "상세 메모", type: "text" }]}
      inherited={false}
      canEditItems
      canManageColumns
      defaultOpen
    />);
    expect(html).toContain("상세 전용");
    expect(html).toContain("표에도 보이기");
    expect(html).toContain("기본으로 되돌리기");
  });

  it("상속된 기본 필드가 있으면 빈 배치 안내 없이 편집 입력을 보여준다", () => {
    const html = renderStaticPanel(<ItemDetailPanel
      boardId="board-a"
      row={{ ...row, values: {} }}
      columns={columns}
      boardLayout={[{ key: "company", source: "column", label: "회사명", type: "text" }]}
      layout={[{ key: "company", source: "column", label: "회사명", type: "text" }]}
      inherited
      canEditItems
      canManageColumns={false}
      defaultOpen
    />);
    expect(html).toContain("보드 기본 배치를 상속 중");
    expect(html).toContain('name="value"');
    expect(html).not.toContain("배치된 상세 필드가 없습니다");
    expect(html).toContain("이 화면에 배치되지 않은 항목 0개");
  });

  it("상세 drawer는 전역 portal과 공용 dialog 레이어를 사용한다", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("createPortal(children, document.body)");
    expect(source).toContain('className="mw-layer-dialog fixed inset-0');
    expect(source).not.toContain('className="fixed inset-0 z-50');
  });

  it.each<CloseChannel>(["Escape", "backdrop", "close button"])(
    "%s 닫기는 실제 dialog를 제거하고 같은 opener로 포커스를 돌려준다",
    async (channel) => {
      const { opener, dialog, closeButton } = await renderInteractivePanel();
      const panel = dialog.querySelector<HTMLElement>("section");
      expect(panel).not.toBeNull();

      await act(async () => {
        panel?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.activeElement).toBe(closeButton);

      await closePanel(channel, dialog, closeButton);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
      expect(document.activeElement).toBe(opener);
    },
  );

  it("Escape·pointer·ref가 실행형 helper에 실제로 결속돼 있다", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('window.addEventListener("keydown", closeOnEscape)');
    expect(source).toContain('window.removeEventListener("keydown", closeOnEscape)');
    expect(source).toContain("isDetailPanelBackdrop(event.target, event.currentTarget)");
    expect(source).toContain("focusDetailPanelElement(closeButtonRef.current)");
    expect(source).toContain("ref={triggerRef}");
    expect(source).toContain("restoreDetailPanelOpener(open, wasOpenRef.current, triggerRef.current)");
  });
});
