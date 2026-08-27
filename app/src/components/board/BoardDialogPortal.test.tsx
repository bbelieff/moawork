// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BoardDialogPortal, BoardModalLayer } from "./BoardDialogPortal";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #549 board dialog portal", () => {
  it("sticky 표 안에서 호출돼도 dialog를 body 바로 아래에 둔다", async () => {
    const tableHost = document.createElement("div");
    tableHost.dataset.stickyTable = "true";
    document.body.append(tableHost);
    root = createRoot(tableHost);
    await act(async () => {
      root?.render(<BoardDialogPortal><div role="dialog">원장</div></BoardDialogPortal>);
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.closest("[data-sticky-table]"), "표 stacking context 안에 남으면 안 된다").toBeNull();
  });

  it("공통 모달은 scrim 70과 dialog 80을 별도 body 레이어로 두고 닫기를 제공한다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    let closed = false;
    await act(async () => {
      root?.render(<BoardModalLayer label="검증" onClose={() => { closed = true; }}>내용</BoardModalLayer>);
    });
    const scrim = document.querySelector<HTMLElement>("[data-board-modal-scrim]")!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="검증"]')!;
    expect(scrim.parentElement).toBe(document.body);
    expect(dialog.parentElement).toBe(document.body);
    expect(scrim.classList).toContain("mw-layer-scrim");
    expect(scrim.classList).not.toContain("mw-layer-dialog");
    expect(dialog.classList).toContain("mw-layer-dialog");
    expect(dialog.classList).not.toContain("mw-layer-scrim");
    expect(scrim.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.dataset.boardModalLayer).toBe("true");
    expect(dialog.className).toContain("fixed inset-0");
    await act(async () => scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(closed).toBe(true);
    closed = false;
    await act(async () => dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(closed).toBe(true);
    closed = false;
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closed).toBe(true);
  });

  it("pending 모달은 scrim과 Escape 닫기를 모두 잠근다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    let closeCount = 0;
    await act(async () => {
      root?.render(<BoardModalLayer label="저장 중" dismissible={false} onClose={() => { closeCount += 1; }}><button>저장 중…</button></BoardModalLayer>);
    });
    const scrim = document.querySelector<HTMLElement>("[data-board-modal-scrim]")!;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="저장 중"]')!;
    await act(async () => scrim.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    await act(async () => dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closeCount).toBe(0);
  });

  it("모달은 포커스를 가두고 닫힐 때 호출자에게 돌려준다", async () => {
    const opener = document.createElement("button");
    opener.textContent = "열기";
    document.body.append(opener);
    opener.focus();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<BoardModalLayer label="포커스" onClose={() => {}} returnFocusRef={{ current: opener }}><button>첫째</button><button>둘째</button></BoardModalLayer>);
    });
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1].focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => root?.unmount());
    root = null;
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(opener);
  });
});
