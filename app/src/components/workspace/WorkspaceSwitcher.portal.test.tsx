// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mountSwitcher() {
  const host = document.createElement("div");
  const stickySidebar = document.createElement("aside");
  stickySidebar.style.position = "sticky";
  stickySidebar.append(host);
  document.body.append(stickySidebar);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <WorkspaceSwitcher
        currentOrgId="org-a"
        workspaces={[
          { orgId: "org-a", slug: "sample-a", name: "샘플 A", role: "owner", status: "active" },
          { orgId: "org-b", slug: "sample-b", name: "샘플 B", role: "member", status: "active" },
        ]}
        destinations={{ createHref: "/new", joinHref: "/join" }}
        onNavigate={vi.fn(async () => {})}
      />,
    );
  });
  const opener = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  vi.spyOn(opener, "getBoundingClientRect").mockReturnValue({
    x: 12, y: 64, left: 12, top: 64, right: 212, bottom: 112,
    width: 200, height: 48, toJSON: () => ({}),
  });
  await act(async () => opener.click());
  await act(async () => Promise.resolve());
  return { host, stickySidebar, opener };
}

describe("Issue #568 workspace switcher layer", () => {
  it("sticky sidebar를 탈출해 body portal에 렌더하고 trigger 아래에 고정한다", async () => {
    const { stickySidebar } = await mountSwitcher();
    const dialog = document.querySelector<HTMLElement>("[data-workspace-switcher-dialog]")!;
    expect(dialog.parentElement).toBe(document.body);
    expect(stickySidebar.contains(dialog)).toBe(false);
    expect(dialog.style.getPropertyValue("--mw-workspace-switcher-left")).toBe("12px");
    expect(dialog.style.getPropertyValue("--mw-workspace-switcher-top")).toBe("118px");
  });

  it("다른 페이지 팝오버가 열리면 동시에 남지 않는다", async () => {
    await mountSwitcher();
    expect(document.querySelectorAll("[data-workspace-switcher-dialog]")).toHaveLength(1);
    await act(async () => window.dispatchEvent(new CustomEvent("moawork:popover-open", { detail: "board-filter" })));
    expect(document.querySelectorAll("[data-workspace-switcher-dialog]")).toHaveLength(0);
  });

  it("Escape로 닫고 회사 전환 버튼에 포커스를 돌려준다", async () => {
    const { opener } = await mountSwitcher();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => Promise.resolve());
    expect(document.querySelectorAll("[data-workspace-switcher-dialog]")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});
