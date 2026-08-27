// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnExpandedPanel } from "./ColumnExpandedPanel";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Issue #604 ColumnExpandedPanel", () => {
  it("renders a fixed non-modal body portal without changing its table host", async () => {
    const host = document.createElement("div");
    host.dataset.tableOverflow = "true";
    host.scrollLeft = 31;
    host.scrollTop = 12;
    document.body.append(host);
    const anchorRef = createRef<HTMLButtonElement>();
    const close = vi.fn();
    root = createRoot(host);
    await act(async () => root?.render(<><button ref={anchorRef}>메뉴</button><ColumnExpandedPanel open anchorRef={anchorRef} label="지원 금액" onClose={close}><p>유형과 출처</p></ColumnExpandedPanel></>));
    const panel = document.querySelector<HTMLElement>("[data-column-expanded-panel]")!;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.closest("[data-table-overflow]")).toBeNull();
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(panel.className).toContain("fixed");
    expect(host.scrollLeft).toBe(31);
    expect(host.scrollTop).toBe(12);
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledWith(true);
  });
});
