// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardAnchoredMenu } from "./BoardAnchoredMenu";

let root: Root | null = null;
let originalRect: typeof HTMLElement.prototype.getBoundingClientRect;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
  originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    if (this.dataset.anchor) return { x: 330, y: 450, left: 330, right: 370, top: 450, bottom: 478, width: 40, height: 28, toJSON() {} } as DOMRect;
    if (this.dataset.boardAnchoredMenu !== undefined) return { x: 0, y: 0, left: 0, right: 232, top: 0, bottom: 240, width: 232, height: 240, toJSON() {} } as DOMRect;
    return originalRect.call(this);
  };
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function fixture(onClose = vi.fn()) {
  const host = document.createElement("div");
  host.dataset.tableOverflow = "true";
  host.scrollLeft = 47;
  host.scrollTop = 19;
  document.body.append(host);
  const anchorRef = createRef<HTMLButtonElement>();
  const menuRef = createRef<HTMLDivElement>();
  root = createRoot(host);
  await act(async () => {
    root?.render(<><button ref={anchorRef} data-anchor>열기</button><BoardAnchoredMenu id="menu-a" open anchorRef={anchorRef} menuRef={menuRef} label="컬럼 메뉴" onClose={onClose}>
      <button role="menuitem">하나</button><button role="menuitem">둘</button><button role="menuitem">셋</button>
    </BoardAnchoredMenu></>);
  });
  await act(async () => window.dispatchEvent(new Event("resize")));
  await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
  const removeAnchor = async () => {
    await act(async () => {
      root?.render(<BoardAnchoredMenu id="menu-a" open anchorRef={anchorRef} menuRef={menuRef} label="컬럼 메뉴" onClose={onClose}>
        <button role="menuitem">하나</button>
      </BoardAnchoredMenu>);
    });
  };
  return { host, anchorRef, menuRef, onClose, removeAnchor };
}

describe("Issue #604 BoardAnchoredMenu", () => {
  it("portals outside table overflow, flips above, shifts into viewport, and preserves scroll", async () => {
    const { host, menuRef } = await fixture();
    expect(menuRef.current?.parentElement).toBe(document.body);
    expect(menuRef.current?.closest("[data-table-overflow]")).toBeNull();
    expect(menuRef.current?.dataset.placement).toBe("top");
    expect(Number.parseFloat(menuRef.current?.style.left ?? "999")).toBeLessThanOrEqual(135);
    expect(Number.parseFloat(menuRef.current?.style.maxHeight ?? "999")).toBeLessThanOrEqual(360);
    expect(host.scrollLeft).toBe(47);
    expect(host.scrollTop).toBe(19);
  });

  it("supports Arrow/Home/End, activation, Escape, and non-trapping Tab", async () => {
    const { menuRef, onClose } = await fixture();
    const items = menuRef.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect(document.activeElement).toBe(items[0]);
    await act(async () => menuRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(items[2]);
    await act(async () => menuRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(items[0]);
    await act(async () => menuRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(document.activeElement).toBe(items[2]);
    await act(async () => menuRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledWith(true);
    await act(async () => menuRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("closes safely when the anchor is removed", async () => {
    const { onClose, removeAnchor } = await fixture();
    await removeAnchor();
    await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
