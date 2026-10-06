// @vitest-environment jsdom
/**
 * #845 (대표 요청 2026-10-06) — 업체명(첫 번째·고정) 열 좌우 폭 조절.
 * 사람별·보드별로 이 브라우저에 저장하고, 그룹마다 따로 그려진 표가 같은 폭을 쓴다.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { GroupTable } from "./GroupTable";
import { resetTitleColumnWidthStoreForTest, TITLE_COLUMN_MAX } from "./title-column-width";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

let root: Root | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const column: BoardColumn = {
  id: "col-rep", org_id: "org", board_id: "b1", key: "rep", label: "대표자", type: "text", source: "in",
  rightPinned: false, options_jsonb: null, sort_order: 0, width: null,
};

function row(id: string, groupId: string): ItemWithValues {
  return {
    id, org_id: "org", board_id: "b1", group_id: groupId, title: `업체 ${id}`, assigned_to: null, deal_id: null,
    sort_order: 0, created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", values: {},
  };
}

function table(groupId: string) {
  return (
    <GroupTable
      boardId="b1"
      groupId={groupId}
      columns={[column]}
      rows={[row(`${groupId}-1`, groupId)]}
      readOnly
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={() => {}}
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
    />
  );
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<>{table("g1")}{table("g2")}</>));
  return host;
}

const headers = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("th[data-board-title-column]")];
const firstCells = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("tbody tr td:first-child")];

beforeEach(() => {
  window.localStorage.clear();
  resetTitleColumnWidthStoreForTest();
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const KEY = "mw:board-title-width:b1:anon";
const widthVar = (el: HTMLElement) => el.style.getPropertyValue("--mw-title-width");

describe("업체명 열 폭 (#845)", () => {
  it("관리자 권한 없이도 손잡이가 있고, 키보드로 넓히면 모든 그룹 표가 같은 폭이 되고 저장된다", async () => {
    window.localStorage.setItem(KEY, "300");
    const host = await mount();
    const handles = host.querySelectorAll<HTMLElement>("[data-board-title-resize]");
    expect(handles).toHaveLength(2);
    expect(handles[0].getAttribute("role")).toBe("separator");
    expect(headers(host).map(widthVar)).toEqual(["300px", "300px"]);
    expect(headers(host).map((th) => th.dataset.titleWidth)).toEqual(["300", "300"]);

    await act(async () => handles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(headers(host).map(widthVar)).toEqual(["316px", "316px"]);
    expect(firstCells(host).map(widthVar)).toEqual(["316px", "316px"]);
    expect(window.localStorage.getItem(KEY)).toBe("316");
    // 폭은 CSS 변수로만 — 휴대폰(640px 미만)에서는 globals.css 규칙이 적용되지 않아 고정 열 상한을 지킨다.
    expect(headers(host)[0].style.width).toBe("");
  });

  it("끌어서 조절하면 놓을 때 저장하고, 최대 폭을 넘지 않는다. 누르기만 하면 저장하지 않는다", async () => {
    const host = await mount();
    const handle = host.querySelector<HTMLElement>("[data-board-title-resize]")!;
    await act(async () => handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true })));
    await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(window.localStorage.getItem(KEY)).toBeNull();

    await act(async () => handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true })));
    await act(async () => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 2000 })));
    expect(widthVar(headers(host)[1])).toBe(`${TITLE_COLUMN_MAX}px`);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(window.localStorage.getItem(KEY)).toBe(String(TITLE_COLUMN_MAX));
  });

  it("두 번 누르면 원래 폭(저장 없음)으로 돌아가고, 다른 계정의 폭은 섞이지 않는다", async () => {
    window.localStorage.setItem(KEY, "400");
    window.localStorage.setItem("mw:board-title-width:b1:someone-else", "200");
    const host = await mount();
    expect(headers(host).map(widthVar)).toEqual(["400px", "400px"]);
    const handle = host.querySelector<HTMLElement>("[data-board-title-resize]")!;
    await act(async () => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(headers(host).map(widthVar)).toEqual(["", ""]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem("mw:board-title-width:b1:someone-else")).toBe("200");
  });
});
