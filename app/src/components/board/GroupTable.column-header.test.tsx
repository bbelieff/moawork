// @vitest-environment jsdom
/**
 * #845 5단계(2026-10-08) — 표 머리글: 칸 이름이 곧 칸 메뉴 단추이고, 이름을 끌면 칸 순서가 바뀐다.
 *   · 누르면 메뉴, 끌면 순서 바꾸기(누르기와 끌기가 갈린다)
 *   · 「보기 · 나만」 은 권한과 무관하게 보드로 요청을 올리고, 「칸 · 모두」 는 칸 관리 권한 + 구조를 바꿀 수 있는 칸만
 *   · 오른쪽 고정 「진행현황」 머리글은 sticky 그대로, 「보기」 만
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { GroupTable } from "./GroupTable";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { WORKFLOW_PROGRESS_KEY } from "@/lib/workflow/progress";
import type { ColumnViewRequest } from "./column-menu-model";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const column = (key: string, label: string, over: Partial<BoardColumn> = {}): BoardColumn => ({
  id: `col-${key}`, org_id: "org", board_id: "b1", key, label, type: "text", source: "in",
  rightPinned: false, options_jsonb: null, sort_order: 0, width: null, ...over,
});
const progress = column(WORKFLOW_PROGRESS_KEY, "진행현황", {
  type: "status", source: "act", rightPinned: true,
  options_jsonb: { options: [{ id: "심사 중", label: "심사 중", order: 0 }] },
});
const row = (id: string, values: ItemWithValues["values"]): ItemWithValues => ({
  id, org_id: "org", board_id: "b1", group_id: "g", title: id, assigned_to: null, deal_id: null,
  sort_order: 0, created_at: "", updated_at: "", values,
});
const rows = [row("r1", { kind: "가", [WORKFLOW_PROGRESS_KEY]: "심사 중" }), row("r2", { kind: "", [WORKFLOW_PROGRESS_KEY]: "심사 중" })];

type Props = Partial<Parameters<typeof GroupTable>[0]>;

async function mount(props: Props = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const calls = { drop: vi.fn(), move: vi.fn(), view: vi.fn<(request: ColumnViewRequest) => void>() };
  await act(async () => root!.render(
    <GroupTable
      boardId="b1"
      groupId="g"
      tablePart="head"
      columns={[column("kind", "구분"), column("rep", "대표자명"), progress]}
      rows={rows}
      readOnly={false}
      canManageColumns
      rowDragEnabled={false}
      cellFlash={null}
      onColumnDrop={calls.drop}
      onColumnKeyboardMove={calls.move}
      onRequestViewCondition={calls.view}
      canFilterColumn={(candidate) => candidate.type === "status"}
      workflowProgressKind="work"
      dragRowId={null}
      canDropRow={() => false}
      onRowDragStart={() => {}}
      onRowDragEnd={() => {}}
      onRowDrop={() => {}}
      {...props}
    />,
  ));
  return { host, calls };
}

const th = (host: ParentNode, key: string) => host.querySelector<HTMLElement>(`th[data-column-key="${key}"]`)!;
const title = (host: ParentNode, key: string) => th(host, key).querySelector<HTMLElement>("[data-column-title]");
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
const menuItem = (label: string) => menuItems().find((item) => item.textContent === label);

async function dragEvent(target: Element, type: "dragstart" | "dragover" | "drop" | "dragend") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
  await act(async () => target.dispatchEvent(event));
  return event;
}

describe("칸 머리글 — 누르면 메뉴, 끌면 순서", () => {
  it("이름을 누르면 메뉴가 열리고 머리글에는 ⋯ 단추가 없다", async () => {
    const { host } = await mount();
    expect(host.querySelector("thead")!.textContent).not.toContain("⋯");
    expect(th(host, "kind").querySelectorAll("button")).toHaveLength(0);
    await act(async () => title(host, "kind")!.click());
    expect(document.querySelector('[role="menu"]')!.getAttribute("aria-label")).toBe("구분 칸 메뉴");
    expect(title(host, "kind")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("이름에서 끌기 시작해 다른 머리글에 놓으면 칸 순서를 바꾸고 메뉴는 열리지 않는다", async () => {
    const { host, calls } = await mount();
    const start = await dragEvent(title(host, "kind")!, "dragstart");
    expect(start.defaultPrevented).toBe(false);
    expect((await dragEvent(th(host, "rep"), "dragover")).defaultPrevented).toBe(true);
    await dragEvent(th(host, "rep"), "drop");
    expect(calls.drop).toHaveBeenCalledWith("kind", "rep");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // 진행현황(구조 잠금)에는 놓을 수 없다.
    await dragEvent(title(host, "kind")!, "dragstart");
    expect((await dragEvent(th(host, WORKFLOW_PROGRESS_KEY), "dragover")).defaultPrevented).toBe(false);
  });

  it("폭 조절 손잡이는 평소 보이지 않는 2px 선이고 끌기를 시작하지 않는다", async () => {
    const { host } = await mount();
    const handle = th(host, "kind").querySelector<HTMLElement>(".cursor-col-resize")!;
    expect(handle.className).toContain("border-transparent");
    expect(handle.className).toContain("border-r-2");
    expect(handle.getAttribute("data-no-drag")).not.toBeNull();
    expect((await dragEvent(handle, "dragstart")).defaultPrevented).toBe(true);
  });
});

describe("칸 메뉴 — 「보기」 는 보드로, 「칸」 은 권한대로", () => {
  it("줄 세우기·숨기기는 이 칸의 요청을 올리고, 채움 수는 넘어온 행으로 센다", async () => {
    const { host, calls } = await mount();
    await act(async () => title(host, "kind")!.click());
    expect(document.querySelector("[data-column-menu-meta]")!.textContent).toBe("글자 · 1/2 채움");
    await act(async () => menuItem("가나다순")!.click());
    expect(calls.view).toHaveBeenLastCalledWith({ kind: "sort", columnKey: "kind", direction: "asc" });
    await act(async () => title(host, "kind")!.click());
    await act(async () => menuItem("숨기기")!.click());
    expect(calls.view).toHaveBeenLastCalledWith({ kind: "hide", columnKey: "kind" });
  });

  it("지금 걸린 줄 세우기를 메뉴에 표시한다", async () => {
    const { host } = await mount({ activeSorts: [{ columnKey: "rep", direction: "desc" }] });
    await act(async () => title(host, "rep")!.click());
    expect(menuItem("가나다 역순")!.getAttribute("aria-checked")).toBe("true");
    expect(menuItem("원래 순서로")).toBeDefined();
  });

  it("옮기기는 보이는 이웃 기준 — 맨 앞은 왼쪽이, 진행현황 앞은 오른쪽이 막힌다", async () => {
    const { host, calls } = await mount();
    await act(async () => title(host, "kind")!.click());
    expect(menuItem("왼쪽으로")!.getAttribute("aria-disabled")).toBe("true");
    await act(async () => menuItem("오른쪽으로")!.click());
    expect(calls.move).toHaveBeenCalledWith("kind", 1);
    await act(async () => title(host, "rep")!.click());
    expect(menuItem("오른쪽으로")!.getAttribute("aria-disabled")).toBe("true");
    await act(async () => menuItem("왼쪽으로")!.click());
    expect(calls.move).toHaveBeenLastCalledWith("rep", -1);
  });

  it("칸 관리 권한이 없으면 「보기」 만 — 끌기·폭 조절·「칸」 묶음이 없다", async () => {
    const { host } = await mount({ canManageColumns: false, readOnly: true });
    expect(th(host, "kind").getAttribute("draggable")).toBe("false");
    expect(th(host, "kind").querySelector(".cursor-col-resize")).toBeNull();
    await act(async () => title(host, "kind")!.click());
    expect(document.querySelector('[data-column-menu-section="view"]')).not.toBeNull();
    expect(document.querySelector('[data-column-menu-section="manage"]')).toBeNull();
  });

  it("「보기」 요청도 칸 관리 권한도 없으면 이름 글자만 남는다", async () => {
    const { host } = await mount({ canManageColumns: false, readOnly: true, onRequestViewCondition: undefined });
    expect(title(host, "kind")).toBeNull();
    expect(th(host, "kind").textContent).toBe("구분");
    expect(th(host, "kind").querySelector('[role="button"]')).toBeNull();
  });

  it("오른쪽 고정 「진행현황」 머리글은 sticky 그대로이고 「보기」(골라 보기… 포함)만 연다", async () => {
    const { host, calls } = await mount();
    const pinned = th(host, WORKFLOW_PROGRESS_KEY);
    expect(pinned.getAttribute("data-right-pinned")).toBe("true");
    expect(pinned.className).toContain("sticky");
    expect(pinned.className).toContain("right-0");
    expect(pinned.getAttribute("draggable")).toBe("false");
    expect(pinned.hasAttribute("data-column-manage")).toBe(false);
    await act(async () => title(host, WORKFLOW_PROGRESS_KEY)!.click());
    expect(document.querySelector('[data-column-menu-section="manage"]')).toBeNull();
    await act(async () => menuItem("골라 보기…")!.click());
    expect(calls.view).toHaveBeenLastCalledWith({ kind: "filter", columnKey: WORKFLOW_PROGRESS_KEY });
  });
});
