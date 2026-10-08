// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08) — 머리말 「탭 설정」·제목 ▾ 「휴지통으로 이동」 배선.
 * 서버 화면은 함수를 넘길 수 없으므로 열림 상태는 TabChromeProvider(BoardWorkspace 안)가 들고
 * 슬롯에 문맥으로 알려 준다. 옛 「⚙ 보드 설정」 펼침(settingsSlot)은 없어졌다.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/b",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { BoardWorkspace } from "./BoardWorkspace";
import { useTabChrome, type TabSettingsSection } from "./tab-chrome";
import type { Board } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const board = { id: "b", org_id: "o", name: "탭", icon: null, description: null, source: "core.default-tab/contact", is_system: false, sort_order: 0 } as unknown as Board;
const ALL: readonly TabSettingsSection[] = ["general", "fields", "stages"];

async function mount(slots: {
  tabSettingsSlot?: ReactNode;
  tabSettingsSections?: readonly TabSettingsSection[];
  tabTrashSlot?: ReactNode;
  board?: Board;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <BoardWorkspace
      board={slots.board ?? board}
      columns={[]}
      groups={[]}
      rows={[]}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
      tabSettingsSlot={slots.tabSettingsSlot}
      tabSettingsSections={slots.tabSettingsSections}
      tabTrashSlot={slots.tabTrashSlot}
    />,
  ));
  return host;
}

function SettingsProbe() {
  const chrome = useTabChrome();
  if (!chrome?.settingsSection) return null;
  return (
    <div role="dialog" aria-label="탭 설정">
      열린칸:{chrome.settingsSection}/{chrome.settingsField ?? "-"}
      <button type="button" onClick={() => chrome.selectSettingsSection("stages")}>단계로</button>
      <button type="button" onClick={chrome.closeSettings}>닫기</button>
    </div>
  );
}

function TrashProbe() {
  const chrome = useTabChrome();
  if (!chrome?.trashOpen) return null;
  return (
    <div role="alertdialog" aria-label="휴지통으로 이동">
      <button type="button" onClick={chrome.closeTrash}>취소</button>
    </div>
  );
}

const settingsButton = (host: ParentNode) => host.querySelector<HTMLButtonElement>("button[data-board-tab-settings]");
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="탭 설정"]');
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const openMenu = async (host: ParentNode) => {
  await act(async () => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!.click());
};

describe("머리말 「탭 설정」 배선", () => {
  it("설정 칸이 하나도 없으면 「탭 설정」 단추·▾ 가 없다 — 옛 보드 설정 펼침도 없다", async () => {
    const host = await mount({ tabSettingsSlot: <SettingsProbe />, tabSettingsSections: [] });
    expect(settingsButton(host)).toBeNull();
    expect(host.querySelector("button[data-board-tab-menu-trigger]")).toBeNull();
    expect(host.querySelector("#board-settings")).toBeNull();
    expect(host.textContent).not.toContain("보드 설정");
  });

  it("시스템 보드에는 설정·휴지통 진입점이 없다", async () => {
    const host = await mount({
      board: { ...board, is_system: true } as Board,
      tabSettingsSlot: <SettingsProbe />,
      tabSettingsSections: ALL,
      tabTrashSlot: <TrashProbe />,
    });
    expect(settingsButton(host)).toBeNull();
    expect(host.querySelector("button[data-board-tab-menu-trigger]")).toBeNull();
  });

  it("단추는 마지막에 본 칸(처음이면 일반)을 열고, ▾ 의 「탭 설정…」 도 같은 길이다", async () => {
    const host = await mount({ tabSettingsSlot: <SettingsProbe />, tabSettingsSections: ALL });
    expect(dialog()).toBeNull();

    await act(async () => settingsButton(host)!.click());
    expect(dialog()?.textContent).toContain("열린칸:general/-");
    await act(async () => [...dialog()!.querySelectorAll("button")].find((node) => node.textContent === "단계로")!.click());
    expect(dialog()?.textContent).toContain("열린칸:stages");
    await act(async () => [...dialog()!.querySelectorAll("button")].find((node) => node.textContent === "닫기")!.click());
    expect(dialog()).toBeNull();

    await openMenu(host);
    await act(async () => menuItems().find((node) => node.textContent === "탭 설정…")!.click());
    expect(dialog()?.textContent).toContain("열린칸:stages");
  });

  it("「아이콘 바꾸기」 는 일반 칸의 아이콘 고르기에 초점을 주라고 알린다", async () => {
    const host = await mount({ tabSettingsSlot: <SettingsProbe />, tabSettingsSections: ALL });
    await openMenu(host);
    expect(menuItems().map((node) => node.textContent)).toEqual(["아이콘 바꾸기", "설명 고치기", "탭 설정…"]);
    await act(async () => menuItems().find((node) => node.textContent === "아이콘 바꾸기")!.click());
    expect(dialog()?.textContent).toContain("열린칸:general/icon");
  });

  it("일반 칸이 없으면(탭 관리 권한 없음) 아이콘·설명 항목을 감추고, 있는 칸부터 연다", async () => {
    const host = await mount({ tabSettingsSlot: <SettingsProbe />, tabSettingsSections: ["fields"] });
    await openMenu(host);
    expect(menuItems().map((node) => node.textContent)).toEqual(["탭 설정…"]);
    await act(async () => menuItems()[0].click());
    expect(dialog()?.textContent).toContain("열린칸:fields");
  });
});

describe("제목 ▾ 「휴지통으로 이동」 배선", () => {
  it("휴지통 슬롯이 있을 때만 메뉴에 보이고, 고르면 슬롯이 열린다", async () => {
    const host = await mount({ tabTrashSlot: <TrashProbe /> });
    await openMenu(host);
    expect(menuItems().map((node) => node.textContent)).toEqual(["휴지통으로 이동"]);
    await act(async () => menuItems()[0].click());
    expect(document.querySelector('[role="alertdialog"][aria-label="휴지통으로 이동"]')).not.toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
