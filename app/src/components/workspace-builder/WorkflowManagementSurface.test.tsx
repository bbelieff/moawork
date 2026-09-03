// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { moveAt, WorkflowManagementSurface, type WorkflowManagementTab } from "./WorkflowManagementSurface";

const tabs: WorkflowManagementTab[] = [
  { key: "new-lead", order: 1, name: "신규리드 관리", description: "신규", href: "/newcust", boardId: "new", groups: [{ id: "a", name: "신규고객", color: "#fc0" }], transition: "리드컨택 관리로 넘기기", transitionKind: "move" },
  { key: "contact", order: 2, name: "리드컨택 관리", description: "컨택", href: "/contract", boardId: "contact", groups: [{ id: "b", name: "미배정", color: "#09f" }], transition: "계약업체 실무로 넘기기", transitionKind: "move" },
  { key: "work", order: 3, name: "계약업체 실무", description: "실무", href: "/work", boardId: "work", groups: [{ id: "c", name: "진행중", color: "#0c8" }], transition: "업체관리 현황에 자동 반영", transitionKind: "projection" },
  { key: "companies", order: 4, name: "업체관리 현황", description: "현황", href: "/companies", boardId: null, groups: [], transition: "완료", transitionKind: "complete" },
];

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
  await act(async () => root?.render(<WorkflowManagementSurface tabs={tabs} />));
  return host;
}

async function press(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("workflow management", () => {
  it("shows the four-step product workflow and distinguishes moves from projection", () => {
    const html = renderToStaticMarkup(<WorkflowManagementSurface tabs={tabs} />);
    expect(html).toContain("전체 구조");
    expect(html).toContain("단계 편집");
    expect(html).toContain("신규리드 관리");
    expect(html).toContain("업체관리 현황");
    expect(html).toContain("실제 이동");
    expect(html).toContain("자동 반영");
  });

  it("moves one stage without dropping or duplicating another stage", () => {
    expect(moveAt(["신규", "상담", "보류"], 1, -1)).toEqual(["상담", "신규", "보류"]);
    expect(moveAt(["신규", "상담", "보류"], 0, -1)).toEqual(["신규", "상담", "보류"]);
  });

  it("connects stable tabs and panels with one roving tab stop", async () => {
    const host = await renderFixture();
    const viewTabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(viewTabs.map((tab) => [tab.id, tab.getAttribute("aria-controls"), tab.tabIndex])).toEqual([
      ["workflow-view-tab-overview", "workflow-view-panel-overview", 0],
      ["workflow-view-tab-stages", "workflow-view-panel-stages", -1],
    ]);
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(2);
    const activePanel = host.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
    expect(activePanel?.id).toBe("workflow-view-panel-overview");
    expect(activePanel?.getAttribute("aria-labelledby")).toBe("workflow-view-tab-overview");
  });

  it("moves focus and selection with arrows, Home, and End while click stays equivalent", async () => {
    const host = await renderFixture();
    const viewTabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    viewTabs[0].focus();

    await press(viewTabs[0], "ArrowRight");
    expect(document.activeElement).toBe(viewTabs[1]);
    expect(viewTabs[1].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("workflow-view-panel-stages");

    await press(viewTabs[1], "ArrowRight");
    expect(document.activeElement).toBe(viewTabs[0]);
    await press(viewTabs[0], "End");
    expect(document.activeElement).toBe(viewTabs[1]);
    await press(viewTabs[1], "Home");
    expect(document.activeElement).toBe(viewTabs[0]);
    await press(viewTabs[0], "ArrowLeft");
    expect(document.activeElement).toBe(viewTabs[1]);
    expect(viewTabs.filter((tab) => tab.tabIndex === 0)).toEqual([viewTabs[1]]);

    await act(async () => viewTabs[0].click());
    expect(viewTabs[0].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]:not([hidden])')?.id).toBe("workflow-view-panel-overview");
  });
});
