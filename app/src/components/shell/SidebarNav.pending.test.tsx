// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SidebarNav } from "./SidebarNav";

let pathname = "/w/sample-lab/settings/members";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// 실제 이동을 막고 클릭만 부모에 전달한다 — 그래야 jsdom 에서 주소가 바뀌지 않는다.
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  pathname = "/w/sample-lab/settings/members";
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  return host;
}

async function renderNav() {
  await act(async () => {
    root!.render(<SidebarNav lockedFeatures={[]} workspaceBasePath="/w/sample-lab" />);
  });
}

// 켜지지 않은 메뉴를 화면에서 고른다 — 키를 고정하지 않아 메뉴가 바뀌어도 깨지지 않는다.
function inactiveLink(host: HTMLElement) {
  return [...host.querySelectorAll("a[data-nav-key]")].find((link) => !link.hasAttribute("aria-current")) as HTMLAnchorElement;
}

function activeKey(host: HTMLElement) {
  return host.querySelector('a[aria-current="page"]')?.getAttribute("data-nav-key");
}

function click(link: HTMLAnchorElement, init?: MouseEventInit) {
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
}

describe("SidebarNav — 누른 메뉴가 즉시 켜진다", () => {
  it("그냥 클릭하면 그 메뉴가 켜지고 켜진 것은 하나뿐이다", async () => {
    const host = mount();
    await renderNav();
    expect(activeKey(host)).not.toBeNull();
    const target = inactiveLink(host);
    expect(target.getAttribute("aria-current")).toBeNull();
    await act(async () => click(target));
    expect(target.getAttribute("aria-current")).toBe("page");
    expect(host.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  });

  it("ctrl 을 누른 클릭(새 탭)은 켜진 메뉴를 바꾸지 않는다", async () => {
    const host = mount();
    await renderNav();
    const before = activeKey(host);
    expect(before).not.toBeNull();
    const target = inactiveLink(host);
    await act(async () => click(target, { ctrlKey: true }));
    expect(activeKey(host)).toBe(before);
    expect(target.getAttribute("aria-current")).toBeNull();
  });

  it("다른 화면에 갔다가 뒤로 돌아오면 누른 표시가 남지 않는다", async () => {
    const host = mount();
    await renderNav();
    const before = activeKey(host);
    const target = inactiveLink(host);
    await act(async () => click(target));
    expect(activeKey(host)).toBe(target.getAttribute("data-nav-key"));

    pathname = "/w/sample-lab/notifications";
    await renderNav();
    pathname = "/w/sample-lab/settings/members";
    await renderNav();
    expect(activeKey(host)).toBe(before);
  });
});
