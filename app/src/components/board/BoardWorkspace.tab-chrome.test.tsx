// @vitest-environment jsdom
/**
 * #845 개선안(2026-10-08) — 머리말 「탭 설정」·제목 ▾ 「휴지통으로 이동」 배선.
 * 서버 화면은 함수를 넘길 수 없으므로 열림 상태는 BoardWorkspace 가 들고 슬롯에 문맥으로 알려 준다.
 * 탭 설정 대화상자 슬롯이 아직 없으면 「탭 설정」 은 기존 보드 설정 펼침을 열어 준다.
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
import { useTabChrome } from "./tab-chrome";
import type { Board } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const board = { id: "b", org_id: "o", name: "탭", icon: null, description: null, source: "core.default-tab/contact", is_system: false, sort_order: 0 } as unknown as Board;

async function mount(slots: { settingsSlot?: ReactNode; tabSettingsSlot?: ReactNode; tabTrashSlot?: ReactNode }) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <BoardWorkspace
      board={board}
      columns={[]}
      groups={[]}
      rows={[]}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
      {...slots}
    />,
  ));
  return host;
}

function SettingsProbe() {
  const chrome = useTabChrome();
  if (!chrome?.settingsSection) return null;
  return (
    <div role="dialog" aria-label="탭 설정">
      열린칸:{chrome.settingsSection}
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

describe("머리말 「탭 설정」 배선", () => {
  it("설정 진입점이 하나도 없으면 「탭 설정」 단추가 없다", async () => {
    const host = await mount({});
    expect(settingsButton(host)).toBeNull();
    expect(host.querySelector("button[data-board-tab-menu-trigger]")).toBeNull();
  });

  it("탭 설정 대화상자가 아직 없으면 기존 보드 설정 펼침을 연다", async () => {
    const host = await mount({
      settingsSlot: (
        <details id="board-settings">
          <summary>⚙ 보드 설정</summary>
          <p>설정내용</p>
        </details>
      ),
    });
    const details = host.querySelector<HTMLDetailsElement>("#board-settings")!;
    expect(details.open).toBe(false);
    await act(async () => settingsButton(host)!.click());
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(details.querySelector("summary"));
  });

  it("탭 설정 슬롯이 있으면 문맥으로 연 칸을 알리고, 닫으면 사라진다 — ▾ 의 「탭 설정…」 도 같은 길", async () => {
    const host = await mount({ tabSettingsSlot: <SettingsProbe /> });
    expect(document.querySelector('[role="dialog"][aria-label="탭 설정"]')).toBeNull();

    await act(async () => settingsButton(host)!.click());
    expect(document.querySelector('[role="dialog"][aria-label="탭 설정"]')?.textContent).toContain("열린칸:general");
    await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
    expect(document.querySelector('[role="dialog"][aria-label="탭 설정"]')).toBeNull();

    await act(async () => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === "탭 설정…")!;
    await act(async () => item.click());
    expect(document.querySelector('[role="dialog"][aria-label="탭 설정"]')?.textContent).toContain("열린칸:general");
  });
});

describe("제목 ▾ 「휴지통으로 이동」 배선", () => {
  it("휴지통 슬롯이 있을 때만 메뉴에 보이고, 고르면 슬롯이 열린다", async () => {
    const host = await mount({ tabTrashSlot: <TrashProbe /> });
    await act(async () => host.querySelector<HTMLButtonElement>("button[data-board-tab-menu-trigger]")!.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((node) => node.textContent)).toEqual(["휴지통으로 이동"]);
    await act(async () => items[0].click());
    expect(document.querySelector('[role="alertdialog"][aria-label="휴지통으로 이동"]')).not.toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alertdialog"] button')!.click());
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
