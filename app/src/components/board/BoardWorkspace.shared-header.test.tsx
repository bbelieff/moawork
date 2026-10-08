// @vitest-environment jsdom
/**
 * 2026-10-08 대표 결정 두 가지를 «그려진 결과» 로 잰다.
 *   ① 제목행은 보드 맨 위 하나, 내려가도 따라온다 — 보이는 그룹의 열 구성이 같을 때만.
 *      그룹마다 열 구성이 다르면 그 차이를 숨기지 않도록 그룹마다 제목행으로 돌아간다.
 *      맨 위 제목행에서 컬럼을 옮기면 모든 그룹의 배치를 한 번에 저장한다.
 *   ② 계약업체 실무의 「업체 추가」 는 보드마다 늘어놓지 않는다 — 머리말 단추 하나(첫 보드)와
 *      배너 ＋(그 보드)로만 연다. 다른 보드는 지금처럼 그룹마다 추가 줄이 있다.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({ setGroupColumnOrdersAction: vi.fn(async () => {}) }));
vi.mock("@/app/(app)/boards/actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/boards/actions")>()),
  setGroupColumnOrdersAction: actionMocks.setGroupColumnOrdersAction,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/boards/b",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { BoardWorkspace } from "./BoardWorkspace";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import type { GroupColumnOrder } from "./layout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  actionMocks.setGroupColumnOrdersAction.mockClear();
});

const groups = [
  { id: "g-ready", org_id: "o", board_id: "b", name: "준비단계", color: "#00c875", sort_order: 0 },
  { id: "g-review", org_id: "o", board_id: "b", name: "심사 중", color: "#9cd326", sort_order: 1 },
  // 행이 없는 보드 — 계약업체 실무에서는 «빈 보드» 로 접힌다.
  { id: "g-empty", org_id: "o", board_id: "b", name: "승인", color: "#cab641", sort_order: 2 },
] as BoardGroup[];

const column = (id: string, key: string, label: string, sort: number) => ({
  id, org_id: "o", board_id: "b", key, label, type: "text", source: "in", rightPinned: false,
  sort_order: sort, width: null, options_jsonb: null, move_rule_jsonb: null,
}) as unknown as BoardColumn;
const columns = [column("c-kind", "kind", "구분", 0), column("c-rep", "rep_name", "대표자명", 1)];

const row = (id: string, title: string, groupId: string): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: groupId, title, assigned_to: null, deal_id: null,
  sort_order: 0, created_at: "", updated_at: "", values: {},
});
const rows = [row("r1", "가나정밀", "g-ready"), row("r2", "다라식품", "g-review")];

async function mount(source: string, options: { columnOrder?: GroupColumnOrder } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "보드", source, is_system: false, sort_order: 0 } as Board;
  await act(async () => root!.render(
    <BoardWorkspace
      board={board}
      columns={columns}
      groups={groups}
      rows={rows}
      columnOrder={options.columnOrder ?? {}}
      cellFlash={null}
      assigneeLabels={{}}
      canEditItems
      canManageColumns
      canMoveRows
      contractWorkCompanyPicker={{ rows: [], error: null, truncated: false }}
      startCompanyWorkAction={vi.fn(async () => ({ ok: null, message: "" }))}
    />,
  ));
  return host;
}

const sections = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('[data-visual-block="group-table"]')];
const intakePanels = (host: ParentNode) => [...host.querySelectorAll("h3")]
  .filter((heading) => heading.textContent?.startsWith("업체 추가"))
  .map((heading) => heading.closest<HTMLElement>('[data-visual-block="group-table"]')?.querySelector("[data-group-title]")?.textContent);

describe("제목행은 보드 맨 위 하나 (2026-10-08)", () => {
  it("열 구성이 같으면 맨 위 제목행 하나만 보이고, 그룹 표에는 높이 0 의 이름 줄만 남는다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const heads = host.querySelectorAll('[data-board-table-part="head"]');
    expect(heads).toHaveLength(1);
    // 맨 위 제목행은 모든 그룹보다 먼저 그려진다.
    expect(heads[0].compareDocumentPosition(sections(host)[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...heads[0].querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("업체"), expect.stringContaining("구분"), expect.stringContaining("대표자명")]),
    );
    expect(heads[0].querySelector("tbody")).toBeNull();

    const bodies = host.querySelectorAll('[data-board-table-part="body"]');
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const labels = body.querySelector("thead[data-board-head-labels]");
      expect(labels, "그룹 표의 제목은 보조기기용 이름 줄이어야 한다").not.toBeNull();
      // 보이는 컨트롤(끌기·메뉴·폭 조절)은 맨 위에만 있다 — 숨은 줄에 초점이 가면 안 된다.
      expect(labels!.querySelectorAll("button, input, [tabindex]")).toHaveLength(0);
      expect([...labels!.querySelectorAll(".sr-only")].map((node) => node.textContent)).toEqual(["업체", "구분", "대표자명"]);
      // 두 표가 같은 고정 폭 표라 열이 같은 자리에 선다.
      expect(body.querySelector("table")!.style.tableLayout).toBe("fixed");
    }
    expect(heads[0].querySelector("table")!.style.width).toBe(bodies[0].querySelector("table")!.style.width);
  });

  it("그룹 전체 선택은 배너로 온다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const reviewSelect = sections(host)[1].querySelector<HTMLInputElement>('summary input[type="checkbox"][aria-label="심사 중 전체 선택"]');
    expect(reviewSelect).not.toBeNull();
    await act(async () => reviewSelect!.click());
    const rowBoxes = [...host.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
    expect(rowBoxes.filter((box) => box.checked)).toHaveLength(1);
  });

  it("맨 위 제목행에서 컬럼을 옮기면 모든 그룹의 배치를 한 번에 저장한다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const head = host.querySelector('[data-board-table-part="head"]')!;
    // #845 5단계 — 옮기기는 칸 이름을 눌러 여는 칸 메뉴의 「왼쪽으로」 다.
    const repTitle = [...head.querySelectorAll<HTMLElement>("[data-column-title]")].find((node) => node.textContent === "대표자명");
    expect(repTitle).toBeDefined();
    await act(async () => repTitle!.click());
    const moveLeft = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((item) => item.textContent === "왼쪽으로");
    expect(moveLeft).toBeDefined();
    await act(async () => moveLeft!.click());
    expect(actionMocks.setGroupColumnOrdersAction).toHaveBeenCalledTimes(1);
    const form = (actionMocks.setGroupColumnOrdersAction.mock.calls[0] as unknown as [FormData])[0];
    expect(form.get("boardId")).toBe("b");
    // 보이는 묶음만이 아니라 모든 실제 그룹과 «그룹 없음» 까지 같은 순서로 맞춘다.
    expect(JSON.parse(String(form.get("entries")))).toEqual([
      { groupKey: "g-ready", order: ["rep_name", "kind"] },
      { groupKey: "g-review", order: ["rep_name", "kind"] },
      { groupKey: "g-empty", order: ["rep_name", "kind"] },
      { groupKey: "__ungrouped__", order: ["rep_name", "kind"] },
    ]);
  });

  it("어떤 그룹만 열 순서가 다르면 그 차이를 숨기지 않고 그룹마다 제목행을 그린다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, { columnOrder: { "g-review": ["rep_name", "kind"] } });
    expect(host.querySelector('[data-board-table-part="head"]')).toBeNull();
    expect(host.querySelector('[data-board-table-part="body"]')).toBeNull();
    const headers = sections(host).map((section) => [...section.querySelectorAll("thead th")].map((th) => th.getAttribute("data-column-key")).filter(Boolean));
    expect(headers).toEqual([["kind", "rep_name"], ["rep_name", "kind"]]);
  });

  it("행을 끄는 동안 펼쳐지는 빈 보드의 열 순서가 달라도 맨 위 제목행은 그대로고, 그 보드만 자기 제목행을 그린다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const host = await mount(CONTRACT_WORK_TAB_SOURCE, { columnOrder: { "g-empty": ["rep_name", "kind"] } });
      expect(host.querySelectorAll('[data-board-table-part="head"]')).toHaveLength(1);
      const handle = host.querySelector<HTMLElement>("tr[data-board-row] > td:first-child")!;
      const drag = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(drag, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
      await act(async () => handle.dispatchEvent(drag));
      await act(async () => vi.runOnlyPendingTimers());
      expect(sections(host).map((section) => section.querySelector("[data-group-title]")?.textContent)).toEqual(["준비단계", "심사 중", "승인"]);
      expect(host.querySelectorAll('[data-board-table-part="head"]'), "끌기 도중 제목행 방식이 바뀌면 안 된다").toHaveLength(1);
      const revealed = sections(host)[2];
      expect(revealed.querySelector('[data-board-table-part="body"]')).toBeNull();
      expect([...revealed.querySelectorAll("thead th")].map((th) => th.getAttribute("data-column-key")).filter(Boolean)).toEqual(["rep_name", "kind"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("계약업체 실무의 「업체 추가」 는 머리말 단추 + 배너 ＋ (2026-10-08)", () => {
  it("그룹마다 「＋ 업체 추가」 단추를 늘어놓지 않는다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const inGroups = sections(host).flatMap((section) => [...section.querySelectorAll("tbody button")])
      .filter((button) => button.textContent?.includes("업체 추가"));
    expect(inGroups).toHaveLength(0);
    expect(intakePanels(host)).toEqual([]);
  });

  it("머리말 「＋ 업체 추가」 는 첫 보드의 추가 패널을 연다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const headerAdd = [...host.querySelectorAll<HTMLButtonElement>('button[data-mw-cta="primary"]')]
      .find((button) => button.textContent?.includes("업체 추가"));
    expect(headerAdd).toBeDefined();
    await act(async () => headerAdd!.click());
    expect(intakePanels(host)).toEqual(["준비단계"]);
  });

  it("배너 ＋ 는 그 보드의 추가 패널을 연다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const add = sections(host)[1].querySelector<HTMLButtonElement>("[data-group-add]");
    expect(add?.getAttribute("aria-label")).toBe("심사 중에 업체 추가");
    await act(async () => add!.click());
    expect(intakePanels(host)).toEqual(["심사 중"]);
    // 배너 단추를 눌러도 보드가 접히지 않는다.
    expect(sections(host)[1].querySelector("details")!.open).toBe(true);
  });

  it("두 보드의 패널을 열고 하나를 닫으면 포커스는 그 패널을 연 ＋ 로 돌아간다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const [readyAdd, reviewAdd] = sections(host).map((section) => section.querySelector<HTMLButtonElement>("[data-group-add]")!);
    await act(async () => readyAdd.click());
    await act(async () => reviewAdd.click());
    expect(intakePanels(host)).toEqual(["준비단계", "심사 중"]);
    const closeReady = [...sections(host)[0].querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "닫기")!;
    await act(async () => closeReady.click());
    expect(intakePanels(host)).toEqual(["심사 중"]);
    expect(document.activeElement).toBe(readyAdd);
  });

  it("다른 보드는 지금처럼 그룹마다 추가 줄이 있고 배너 ＋ 는 없다", async () => {
    const host = await mount("core.default-tab/contact");
    expect(host.querySelector("[data-group-add]")).toBeNull();
    for (const section of sections(host)) {
      expect(section.querySelector("tbody form, tbody input[name='title']")).not.toBeNull();
    }
  });
});
