// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerScreen } from "./LedgerScreen";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function renderFixture() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<LedgerScreen years={[]} rows={[]} printedOn="2026-09-03" printedBy="가상 사용자" />);
  });
  return host;
}

async function press(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("LedgerScreen tabs", () => {
  it("connects stable mode tabs and panels with one roving tab stop", async () => {
    const host = await renderFixture();
    const tabs = [
      host.querySelector<HTMLButtonElement>("#ledger-mode-tab-yearly")!,
      host.querySelector<HTMLButtonElement>("#ledger-mode-tab-report")!,
    ];
    expect(tabs.map((tab) => [tab.getAttribute("aria-controls"), tab.tabIndex])).toEqual([
      ["ledger-mode-panel-yearly", 0],
      ["ledger-mode-panel-report", -1],
    ]);
    expect(host.querySelectorAll(':scope > [role="tabpanel"]')).toHaveLength(2);
    expect(host.querySelector(':scope > [role="tabpanel"]:not([hidden])')?.getAttribute("aria-labelledby")).toBe("ledger-mode-tab-yearly");
  });

  it("keeps click and ArrowLeft, ArrowRight, Home, and End selection equivalent", async () => {
    const host = await renderFixture();
    const yearly = host.querySelector<HTMLButtonElement>("#ledger-mode-tab-yearly")!;
    const report = host.querySelector<HTMLButtonElement>("#ledger-mode-tab-report")!;
    yearly.focus();

    await press(yearly, "ArrowRight");
    expect(document.activeElement).toBe(report);
    expect(host.querySelector(':scope > [role="tabpanel"]:not([hidden])')?.id).toBe("ledger-mode-panel-report");
    await press(report, "ArrowRight");
    expect(document.activeElement).toBe(yearly);
    await press(yearly, "End");
    expect(document.activeElement).toBe(report);
    await press(report, "Home");
    expect(document.activeElement).toBe(yearly);
    await press(yearly, "ArrowLeft");
    expect(document.activeElement).toBe(report);

    await act(async () => yearly.click());
    expect(yearly.getAttribute("aria-selected")).toBe("true");
    expect([yearly, report].filter((tab) => tab.tabIndex === 0)).toEqual([yearly]);
  });
});
