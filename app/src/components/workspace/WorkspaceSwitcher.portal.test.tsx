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

/*
 * #671 — 「워크스페이스 드롭다운 눌러서 test로 이동하려고 하니 계속 멈추게됨」
 *
 * 전에는 busy 를 켜 두고 «이동이 일어나 이 컴포넌트가 사라지는 것» 에만 기댔다.
 * 성공 경로에서 busy 를 푸는 코드가 아예 없어서, 이동이 안 되면 트리거가
 * disabled 인 채로 영원히 남았다 — 그게 「계속 멈춘다」의 정체다.
 */
describe("#671 워크스페이스를 골랐는데 이동이 «안 일어났을 때»", () => {
  it("★ 트리거가 영원히 잠기지 않는다 — 시한이 지나면 풀리고 이유를 말한다", async () => {
    vi.useFakeTimers();
    try {
      const { host } = await mountSwitcher();
      const other = [
        ...document.querySelectorAll<HTMLButtonElement>("[data-workspace-switcher-dialog] button"),
      ].find((button) => button.textContent?.includes("샘플 B"))!;

      await act(async () => other.click());

      const opener = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
      expect(opener.disabled).toBe(true); // 누른 직후에는 잠긴다 — 두 번 눌리지 않게

      await act(async () => {
        vi.advanceTimersByTime(4000);
        await Promise.resolve();
      });

      expect(opener.disabled).toBe(false); // ★ 다시 누를 수 있다
      expect(document.body.textContent).toContain("이동이 시작되지 않았어요");
    } finally {
      vi.useRealTimers();
    }
  });
});
