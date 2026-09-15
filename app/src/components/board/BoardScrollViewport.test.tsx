// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BoardScrollViewport } from "./BoardScrollViewport";

it("keeps the available height stable when resizing after scrolling the page, and releases observers", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let top = 200;
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ top } as DOMRect));
  const disconnect = vi.fn();
  let resize: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("scrollY", 0);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BoardScrollViewport><table /><table /></BoardScrollViewport>));
    const viewport = host.querySelector<HTMLElement>("[data-board-scroll]")!;
    expect(viewport.style.getPropertyValue("--board-available-height")).toBe("684px");
    top = 100;
    vi.stubGlobal("scrollY", 100);
    window.dispatchEvent(new Event("resize"));
    expect(viewport.style.getPropertyValue("--board-available-height")).toBe("684px");
    top = 300; // expanded content above the groups
    resize();
    expect(viewport.style.getPropertyValue("--board-available-height")).toBe("484px");
    expect(viewport.querySelectorAll("table")).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    host.remove(); bounds.mockRestore(); vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
