// @vitest-environment jsdom
/**
 * #845 6단계 — 목록(묶지 않은 표)·캘린더 보기도 표와 같은 보기 줄을 쓴다.
 *   · 보기 조건은 화면이 들고 주소(mwFilters)에 남긴다 — 저장된 뷰가 «덮어쓰지» 않는다.
 *   · 저장된 뷰가 없을 때 옮긴 칸 순서를 잃지 않는다(mwOrder 를 JSON 으로 — 예전에는 쉼표로 남겨 다시 못 읽었다).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  moveRowAction: vi.fn(),
  reorderGroupsAction: vi.fn(),
}));
vi.mock("@/app/(app)/boards/title-actions", () => ({ renameColumnTitleAction: vi.fn() }));

import { SavedViewsController } from "./SavedViewsController";
import { decodeBoardFilters, EMPTY_FILTERS } from "@/components/board/filters";
import { parseSavedStringList } from "@/lib/view/board-saved";
import type { BoardColumn, ItemWithValues } from "@/lib/boards";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const column = (key: string, label: string, sort: number) => ({
  id: `c-${key}`, org_id: "o", board_id: "b", key, label, type: "text", source: "in", rightPinned: false,
  options_jsonb: null, sort_order: sort, width: null, move_rule_jsonb: null,
}) as BoardColumn;
const columns = [column("first", "첫째", 0), column("second", "둘째", 1)];
const rows = ["가나", "다라"].map((title, index) => ({
  id: `i-${index}`, org_id: "o", board_id: "b", group_id: "g", title, assigned_to: null, deal_id: null,
  sort_order: index, created_at: "", updated_at: "", values: { first: `${title}-1`, second: `${title}-2` },
})) as ItemWithValues[];

let root: Root | null = null;
beforeEach(() => window.history.replaceState(null, "", "/boards/b?view=flat"));
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function mount(search = "view=flat", initialFilters = EMPTY_FILTERS) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <SavedViewsController boardId="b" currentUserId="me" columns={columns} rows={rows} renderMode="flat"
      canEditItems canManageColumns initialSearch={search} initialFilters={initialFilters} />,
  ));
  return host;
}
const headers = (host: ParentNode) => [...host.querySelectorAll("thead th")].map((th) => th.getAttribute("data-column-key")).filter((key) => key && !key.startsWith("__"));

describe("#845 6단계 — 목록 보기의 보기 줄", () => {
  it("표와 같은 보기 줄(뷰 탭·칩·찾기)을 그리고, 보기 방식 칩은 「목록」 이다", async () => {
    const host = await mount();
    const bar = host.querySelector("[data-board-toolbar]")!;
    expect(bar.querySelector('[data-view-tab="main"]')).not.toBeNull();
    expect(bar.querySelector('[data-view-chip="mode"]')!.textContent).toBe("목록");
    expect(bar.querySelector('input[aria-label="찾기"]')).not.toBeNull();
    // 메인 테이블(표)과 보기 방식이 다르다 — 바뀐 조건 1개.
    expect(bar.querySelector('[data-view-tab="main"]')!.getAttribute("title")).toBe("바뀐 조건 1개");
  });

  it("찾기는 화면에서 바로 행을 줄이고 주소에 남긴다", async () => {
    const host = await mount();
    const input = host.querySelector<HTMLInputElement>('[data-board-toolbar] input[aria-label="찾기"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "다라");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("tbody")!.textContent).toContain("다라");
    expect(host.querySelector("tbody")!.textContent).not.toContain("가나");
    expect(decodeBoardFilters(new URL(window.location.href).searchParams.get("mwFilters")).q).toBe("다라");
    expect(host.querySelector("[data-view-count]")!.textContent).toBe("찾기 “다라” · 2건 중 1건");
  });

  it("저장된 뷰가 없어도 옮긴 칸 순서를 주소에 JSON 으로 남기고, 다시 열면 그대로다", async () => {
    const host = await mount();
    expect(headers(host)).toEqual(["first", "second"]);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="첫째 오른쪽으로 이동"]')!.click());
    expect(headers(host)).toEqual(["second", "first"]);
    const order = new URL(window.location.href).searchParams.get("mwOrder");
    expect(parseSavedStringList(order ?? undefined)).toEqual(["second", "first"]);

    // 새로고침 — 서버가 주소를 그대로 넘긴다.
    await act(async () => root!.unmount());
    root = null;
    document.body.replaceChildren();
    const reloaded = await mount(new URL(window.location.href).searchParams.toString());
    expect(headers(reloaded)).toEqual(["second", "first"]);
  });

  it("주소의 보기 조건으로 첫 화면을 그린다(저장된 뷰 설정이 덮지 않는다)", async () => {
    const host = await mount("view=flat", { ...EMPTY_FILTERS, visibleColumnKeys: ["second"] });
    expect(headers(host)).toEqual(["second"]);
    expect(host.querySelector('[data-view-chip="columns"]')!.textContent).toBe("보이는 칸 1/2");
  });
});
