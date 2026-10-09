// @vitest-environment jsdom
/**
 * #845 대표 결정(2026-10-08) — 탭 머리말 개선안을 «그려진 결과와 행동» 으로 잰다.
 *   · 아이콘: 이모지·색 칸 없이 선 아이콘 하나(22px). 옛 이모지 저장값도 같은 그림.
 *   · 제목 ▾ 메뉴: 이름 바꾸기 · 아이콘 바꾸기 · 설명 고치기 · 탭 설정… | 휴지통으로 이동
 *   · 설명은 줄글 대신 ⓘ (올리거나 초점을 주면 보임, Esc 로 닫힘)
 *   · 오른쪽 위 「탭 설정」 단추 (보기 탭·담당자는 #845 6단계부터 보기 줄 BoardViewBar 에 있다)
 */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardHeader } from "./BoardHeader";
import type { BoardGroup } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const groups = [{ id: "g-1", org_id: "o", board_id: "b", name: "첫 단계", color: null, sort_order: 0 }] as unknown as BoardGroup[];

type HeaderProps = ComponentProps<typeof BoardHeader>;

async function mount(overrides: Partial<HeaderProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const props: HeaderProps = {
    boardId: "b",
    icon: "💰",
    source: "core.default-tab/contact",
    name: "탭이름",
    description: "리드를 담당자와 계약 상황에 따라 관리한다",
    groups,
    readOnly: false,
    ...overrides,
  };
  const render = async (next: Partial<HeaderProps> = {}) => {
    await act(async () => root!.render(<BoardHeader {...props} {...next} />));
  };
  await render();
  return { host, render };
}

const nextFrame = () => act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const menuLabels = () => [...(menu()?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].map((item) => item.textContent);
const trigger = (host: ParentNode) => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]");

describe("탭 아이콘 — 선 아이콘 하나, 색 칸 없음", () => {
  it("옛 이모지 저장값도 22px 선 아이콘으로 그리고 이모지 글자는 남기지 않는다", async () => {
    const { host } = await mount({ icon: "💰" });
    const header = host.querySelector('[data-visual-block="board-header"]')!;
    const icon = header.querySelector("h1 svg[data-tab-icon]");
    expect(icon?.getAttribute("data-tab-icon")).toBe("phone");
    expect(icon?.getAttribute("width")).toBe("22");
    expect(icon?.getAttribute("stroke")).toBe("currentColor");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(header.textContent).not.toContain("💰");
    // 예전 색 칸(h1>span[aria-hidden]) 이 없다.
    expect(header.querySelector('h1 > span[aria-hidden="true"]')).toBeNull();
  });

  it("저장값이 없으면 탭 출처로 아이콘을 정한다", async () => {
    const { host } = await mount({ icon: null, source: "core.default-tab/contract-work" });
    expect(host.querySelector("h1 svg[data-tab-icon]")?.getAttribute("data-tab-icon")).toBe("case");
  });
});

describe("제목 ▾ 메뉴", () => {
  it("메뉴를 열면 다섯 항목이 순서대로 있고, 설정 항목은 탭 설정(일반)을 연다 — 닫히면 ▾ 로 초점이 돌아오게 단추를 넘긴다", async () => {
    const onOpenSettings = vi.fn();
    const onRequestTrash = vi.fn();
    const { host } = await mount({ canEditTitle: true, onOpenSettings, onRequestTrash });
    const button = trigger(host)!;
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(menu()?.id);
    expect(menuLabels()).toEqual(["이름 바꾸기", "아이콘 바꾸기", "설명 고치기", "탭 설정…", "휴지통으로 이동"]);
    expect(menu()?.querySelector('[role="separator"]')).not.toBeNull();

    const item = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "아이콘 바꾸기")!;
    await act(async () => item.click());
    expect(onOpenSettings).toHaveBeenLastCalledWith({ section: "general", field: "icon", opener: button });
    expect(menu()).toBeNull();

    await act(async () => button.click());
    const description = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "설명 고치기")!;
    await act(async () => description.click());
    expect(onOpenSettings).toHaveBeenLastCalledWith({ section: "general", field: "description", opener: button });

    // 「탭 설정…」 은 칸을 정하지 않는다 — 마지막에 본 칸(처음이면 일반)을 연다.
    await act(async () => button.click());
    const settings = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "탭 설정…")!;
    await act(async () => settings.click());
    expect(onOpenSettings).toHaveBeenLastCalledWith({ opener: button });

    await act(async () => button.click());
    const trash = [...menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "휴지통으로 이동")!;
    expect(trash.style.color).toBe("var(--mw-error)");
    await act(async () => trash.click());
    expect(onRequestTrash).toHaveBeenCalledTimes(1);
    expect(onRequestTrash).toHaveBeenCalledWith(button);
    expect(menu()).toBeNull();
  });

  it("휴지통·설정 처리기가 없으면 그 항목을 감추고, 할 일이 하나도 없으면 ▾ 자체가 없다", async () => {
    const { host, render } = await mount({ canEditTitle: true });
    await act(async () => trigger(host)!.click());
    expect(menuLabels()).toEqual(["이름 바꾸기"]);
    expect(menu()?.querySelector('[role="separator"]')).toBeNull();

    await render({ canEditTitle: false });
    expect(trigger(host)).toBeNull();
  });

  it("Esc 로 닫고 초점을 ▾ 단추로 돌려준다", async () => {
    const { host } = await mount({ canEditTitle: true, onOpenSettings: vi.fn() });
    const button = trigger(host)!;
    await act(async () => button.click());
    await nextFrame();
    // 열리면 첫 항목에 초점이 간다.
    expect(document.activeElement?.textContent).toBe("이름 바꾸기");
    await act(async () => {
      menu()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu()).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("바깥을 누르면 닫힌다", async () => {
    const { host } = await mount({ onRequestTrash: vi.fn() });
    await act(async () => trigger(host)!.click());
    expect(menu()).not.toBeNull();
    await act(async () => {
      // jsdom 에는 PointerEvent 가 없다 — 닫기 처리는 event.target 만 본다.
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("「이름 바꾸기」 는 제목 편집칸을 연다", async () => {
    const { host } = await mount({ canEditTitle: true });
    await act(async () => trigger(host)!.click());
    const rename = menu()!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    await act(async () => rename.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="보드 이름"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe("탭이름");
    expect(document.activeElement).toBe(input);
  });

  it("▾ 로 시작한 이름 편집을 Enter·Esc 로 끝내면 초점이 ▾ 로, 제목을 눌러 시작했으면 제목으로 돌아온다", async () => {
    const { host } = await mount({ canEditTitle: true });
    const button = trigger(host)!;
    const input = () => host.querySelector<HTMLInputElement>('input[aria-label="보드 이름"]')!;
    const renameFromMenu = async () => {
      await act(async () => button.click());
      await act(async () => menu()!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
      expect(document.activeElement).toBe(input());
    };

    await renameFromMenu();
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await nextFrame();
    expect(document.activeElement).toBe(button);

    // 바꾸지 않은 이름의 Enter 는 저장 없이 닫는다.
    await renameFromMenu();
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await nextFrame();
    expect(document.activeElement).toBe(button);

    const title = () => host.querySelector<HTMLButtonElement>('button[aria-label="보드 이름 편집"]')!;
    await act(async () => title().click());
    expect(document.activeElement).toBe(input());
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    await nextFrame();
    expect(document.activeElement).toBe(title());
  });
});

describe("오른쪽 위 「탭 설정」 과 주 단추", () => {
  it("설정 처리기가 있을 때만 보이고 누르면 탭 설정을 연다 — 주 단추는 하나", async () => {
    const onOpenSettings = vi.fn();
    const { host, render } = await mount({ onOpenSettings });
    const rail = host.querySelector("[data-board-action-rail]")!;
    const settings = rail.querySelector<HTMLButtonElement>("button[data-board-tab-settings]")!;
    expect(settings.textContent).toBe("탭 설정");
    await act(async () => settings.click());
    expect(onOpenSettings).toHaveBeenCalledWith({ opener: settings });
    // 시각 계약의 board-settings 블록은 이 단추를 감싼 칸이다(#845 — 보드 설정 진입점이 오른쪽 위로).
    expect(settings.closest('[data-visual-block="board-settings"]')?.parentElement).toBe(rail);
    expect(settings.getAttribute("aria-haspopup")).toBe("dialog");
    // 채운 단추(주 단추)는 「새 항목」 하나다 — 「탭 설정」 은 테두리만 있는 단추다.
    const filled = [...rail.querySelectorAll('[data-mw-cta="primary"]')].filter((node) => !node.closest("form"));
    expect(filled).toHaveLength(1);
    expect(filled[0].textContent).toContain("새 항목");
    expect(settings.hasAttribute("data-mw-cta")).toBe(false);

    await render({ onOpenSettings: undefined });
    expect(host.querySelector("button[data-board-tab-settings]")).toBeNull();
  });
});

describe("설명은 ⓘ 로", () => {
  it("줄글을 늘어놓지 않고, 초점을 주면 말풍선이 뜨고 Esc 로 닫힌다", async () => {
    const description = "리드를 담당자와 계약 상황에 따라 관리한다";
    const { host } = await mount({ description });
    const info = host.querySelector<HTMLButtonElement>("button[data-board-description]")!;
    expect(info.getAttribute("aria-label")).toBe("탭 설명");
    // 보조기기는 설명을 늘 읽는다.
    const describedBy = document.getElementById(info.getAttribute("aria-describedby")!);
    expect(describedBy?.textContent).toBe(description);
    expect(describedBy?.className).toContain("sr-only");
    expect(document.querySelector("[data-board-description-tip]")).toBeNull();

    await act(async () => info.focus());
    expect(document.querySelector("[data-board-description-tip]")?.textContent).toBe(description);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[data-board-description-tip]")).toBeNull();
  });

  it("터치는 눌러서 열고 닫는다 — 초점을 주지 않는 탭(iOS)도 바깥을 누르면 닫힌다", async () => {
    const { host } = await mount();
    const info = host.querySelector<HTMLButtonElement>("button[data-board-description]")!;
    const tip = () => document.querySelector("[data-board-description-tip]");
    // jsdom 에는 PointerEvent 가 없다 — 처리기는 pointerType 만 본다.
    const pointer = (target: EventTarget, type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      target.dispatchEvent(event);
    };
    // iOS 의 한 번 누르기: 올림·누름·뗌·내림 뒤 click — 초점은 오지 않는다.
    const tap = (target: HTMLElement) => act(async () => {
      for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) pointer(target, type);
      target.click();
    });

    await tap(info);
    expect(tip()).not.toBeNull();
    expect(document.activeElement).not.toBe(info);
    // 손가락이 떠난 뒤에도(누름 끝) 저절로 닫히지 않는다.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(tip()).not.toBeNull();
    // 바깥을 누르면 닫힌다.
    await act(async () => pointer(document.body, "pointerdown"));
    expect(tip()).toBeNull();
    // 다시 누르면 열고, 한 번 더 누르면 닫는다.
    await tap(info);
    expect(tip()).not.toBeNull();
    await tap(info);
    expect(tip()).toBeNull();
  });

  it("설명이 없으면 ⓘ 도 없다", async () => {
    const { host } = await mount({ description: null });
    expect(host.querySelector("button[data-board-description]")).toBeNull();
  });
});

describe("머리말은 한 줄 — 보기 줄은 BoardViewBar 가 맡는다(#845 6단계)", () => {
  it("예전 둘째 줄(테이블·칸반 탭 · 담당자 메뉴)을 그리지 않는다", async () => {
    const { host } = await mount();
    expect(host.querySelector('[data-board-header-row="views"]')).toBeNull();
    expect(host.querySelector("button[data-board-assignee-menu]")).toBeNull();
    expect(host.querySelector('nav[aria-label="보기 전환"]')).toBeNull();
    expect(host.querySelectorAll('[data-visual-block="board-header"]')).toHaveLength(1);
  });
});
