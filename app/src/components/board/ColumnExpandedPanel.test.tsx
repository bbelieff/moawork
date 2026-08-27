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
    Object.defineProperties(host, {
      scrollWidth: { configurable: true, value: 1280 },
      clientWidth: { configurable: true, value: 720 },
    });
    host.scrollLeft = 31;
    host.scrollTop = 12;
    Object.defineProperties(document.documentElement, {
      scrollWidth: { configurable: true, value: 1440 },
      clientWidth: { configurable: true, value: 375 },
    });
    document.documentElement.scrollLeft = 7;
    document.documentElement.scrollTop = 13;
    const tableGeometry = { scrollWidth: host.scrollWidth, clientWidth: host.clientWidth, scrollLeft: host.scrollLeft, scrollTop: host.scrollTop };
    const pageGeometry = { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollLeft: document.documentElement.scrollLeft, scrollTop: document.documentElement.scrollTop };
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
    expect({ scrollWidth: host.scrollWidth, clientWidth: host.clientWidth, scrollLeft: host.scrollLeft, scrollTop: host.scrollTop }).toEqual(tableGeometry);
    expect({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollLeft: document.documentElement.scrollLeft, scrollTop: document.documentElement.scrollTop }).toEqual(pageGeometry);
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(close).toHaveBeenCalledWith(true);
  });
});
