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

  it("공통 모달은 전체 backdrop과 Escape 닫기를 제공한다", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    let closed = false;
    await act(async () => {
      root?.render(<BoardModalLayer label="검증" onClose={() => { closed = true; }}>내용</BoardModalLayer>);
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="검증"]')!;
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.dataset.boardModalLayer).toBe("true");
    expect(dialog.className).toContain("fixed inset-0");
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(closed).toBe(true);
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
