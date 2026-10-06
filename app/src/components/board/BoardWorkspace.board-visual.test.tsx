// @vitest-environment jsdom
/**
 * #839 (대표 지시 2026-10-06) — 계약업체 실무 보드의 화면 연결:
 *   · 진행현황 팝오버가 «원본» 단계 컬럼의 이동 규칙으로 «보드 이동 / 상태만 바꾸기» 를 나눈다
 *     (화면용 진행현황 열은 규칙을 비우므로 그 열로는 알 수 없다).
 *   · 같은 제목(회사명) 행이 2건 이상이면 «같은 회사 N건» — 계약업체 실무에서만.
 *   · 그룹 띠 제목은 표시만 이모지를 걷고, 이모지만 다른 중복 이름은 원문을 지킨다.
 */
import { act } from "react";
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
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

const groups = [
  { id: "g-ready", org_id: "o", board_id: "b", name: "준비단계", color: "#00c875", sort_order: 0 },
  { id: "g-review", org_id: "o", board_id: "b", name: "🔂 심사 중", color: "#9cd326", sort_order: 1 },
  { id: "g-dup", org_id: "o", board_id: "b", name: "⏹️ 준비단계", color: null, sort_order: 2 },
] as BoardGroup[];

const columns = [{
  id: "c-progress", org_id: "o", board_id: "b", key: "progress_status", label: "진행상항", type: "status", source: "act",
  rightPinned: false, sort_order: 0, width: 160,
  options_jsonb: { options: [
    { id: "대기중", label: "대기중", color: "#00c875" },
    { id: "심사 중", label: "심사 중", color: "#9cd326" },
    { id: "📂소진공 혁신성장 대기", label: "📂소진공 혁신성장 대기", color: "#ffcb00" },
  ] },
  move_rule_jsonb: { "대기중": "g-ready", "심사 중": "g-review" },
}] as BoardColumn[];

function row(id: string, title: string, groupId: string, stage: string): ItemWithValues {
  return {
    id, org_id: "o", board_id: "b", group_id: groupId, title, assigned_to: null, deal_id: null,
    sort_order: 0, created_at: "", updated_at: "", values: { progress_status: stage },
  };
}

const DEFAULT_ROWS = [
  row("r1", "QA합성회사", "g-review", "심사 중"),
  row("r2", "QA합성회사", "g-review", "📂소진공 혁신성장 대기"),
  row("r3", "단독회사", "g-ready", "대기중"),
];

async function mount(
  source: string,
  options: { rows?: ItemWithValues[]; groups?: BoardGroup[]; canMoveRows?: boolean } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const board = { id: "b", org_id: "o", name: "계약업체 실무", source, is_system: false, sort_order: 0 } as Board;
  const element = (nextGroups: BoardGroup[]) => (
    <BoardWorkspace
      board={board}
      columns={columns}
      groups={nextGroups}
      rows={options.rows ?? DEFAULT_ROWS}
      columnOrder={{}}
      cellFlash={null}
      assigneeLabels={{}}
      canEditItems
      canMoveRows={options.canMoveRows ?? true}
    />
  );
  await act(async () => root!.render(element(options.groups ?? groups)));
  return Object.assign(host, {
    rerenderGroups: async (nextGroups: BoardGroup[]) => act(async () => root!.render(element(nextGroups))),
  });
}

const titles = (host: ParentNode) => [...host.querySelectorAll("[data-group-title]")].map((node) => node.textContent);
const foldToggle = (host: ParentNode) => host.querySelector<HTMLButtonElement>("[data-empty-groups-toggle] button");

/** jsdom 의 dragstart 에는 dataTransfer 가 없다 — 표가 쓰는 만큼만 단다. */
function dragEvent(type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
  return event;
}

describe("BoardWorkspace 계약업체 실무 화면 연결 (#839)", () => {
  it("원본 이동 규칙으로 진행현황 선택지를 «보드 이동 / 상태만 바꾸기» 로 나눈다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"][data-stage-value="📂소진공 혁신성장 대기"]')!;
    expect(trigger.textContent).toBe("소진공 혁신성장 대기");
    await act(async () => trigger.click());
    const picker = document.querySelector<HTMLElement>("[data-stage-picker]")!;
    const option = (id: string) => [...picker.querySelectorAll<HTMLElement>("[data-stage-option]")]
      .find((node) => node.getAttribute("data-stage-option") === id)!;
    expect(option("대기중").closest('[role="group"]')?.textContent).toContain("보드 이동");
    expect(option("대기중").textContent).toContain("→ 준비단계");
    expect(option("심사 중").textContent).toContain("지금 그룹");
    expect(option("📂소진공 혁신성장 대기").closest('[role="group"]')?.textContent).toContain("상태만 바꾸기 (보드 그대로)");
  });

  it("같은 회사 이름이 2건 이상인 행에만 «같은 회사 N건» — 다른 보드에는 없다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    expect(host.querySelectorAll("[data-same-company-count]")).toHaveLength(2);
    expect(host.textContent).toContain("같은 회사 2건");
    await act(async () => root!.unmount());
    root = null;
    document.body.replaceChildren();
    const other = await mount("custom");
    expect(other.querySelectorAll("[data-same-company-count]")).toHaveLength(0);
  });

  it("그룹 띠 제목은 앞머리 이모지를 걷되, 이모지만 다른 중복 이름은 원문을 지킨다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    // 빈 설치 복제(⏹️ 준비단계)는 접혀 있다가 펼치면 제자리에 나온다(#845).
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
    await act(async () => foldToggle(host)!.click());
    expect(titles(host)).toEqual(["준비단계", "심사 중", "⏹️ 준비단계"]);
  });
});

describe("BoardWorkspace 그룹 톤 — 탭 2색 × 깊이 (#845, 대표 지시 2026-10-06)", () => {
  it("그룹 띠·행 줄은 저장된 이관 색이 아니라 그룹 톤 토큰이다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    await act(async () => foldToggle(host)!.click());
    const sections = [...host.querySelectorAll<HTMLElement>("[data-visual-block='group-table']")];
    expect(sections.map((node) => node.dataset.groupTone)).toEqual(["A1", "A4", "A1"]);
    expect(sections.map((node) => node.dataset.groupAccent)).toEqual(["var(--mw-tab-a-1)", "var(--mw-tab-a-4)", "var(--mw-tab-a-1)"]);
    // 저장색(#00c875 · #9cd326)은 띠에 쓰지 않는다 — #839 사용자 선택이 들어오면 override 가 된다.
    expect(sections.some((node) => (node.getAttribute("style") ?? "").includes("#"))).toBe(false);
  });

  it("진행현황 선택지의 점은 옮겨 갈 그룹의 띠와 같은 톤이다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE);
    const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"][data-stage-value="심사 중"]')!;
    expect(trigger.querySelector<HTMLElement>("[data-mw-stage-dot]")!.style.backgroundColor).toBe("var(--mw-tab-a-4)");
    await act(async () => trigger.click());
    const dot = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-stage-option]")]
      .find((node) => node.getAttribute("data-stage-option") === id)!
      .querySelector<HTMLElement>("[data-mw-stage-dot]")!.style.backgroundColor;
    expect(dot("대기중")).toBe("var(--mw-tab-a-1)");
    expect(dot("심사 중")).toBe("var(--mw-tab-a-4)");
  });

  it("행을 옮길 권한이 없으면 다른 그룹으로 옮기는 진행현황 선택지가 비활성이다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, { canMoveRows: false });
    const trigger = host.querySelector<HTMLButtonElement>('button[role="combobox"][data-stage-value="심사 중"]')!;
    await act(async () => trigger.click());
    const option = (id: string) => [...document.querySelectorAll<HTMLElement>("[data-stage-option]")]
      .find((node) => node.getAttribute("data-stage-option") === id)!;
    expect(option("대기중").getAttribute("aria-disabled")).toBe("true");
    expect(option("심사 중").hasAttribute("aria-disabled")).toBe(false);
  });
});

describe("BoardWorkspace 빈 그룹 접기 (#845, 승인 목업 Main.dc)", () => {
  const many = [
    { id: "g-1", org_id: "o", board_id: "b", name: "준비단계", color: null, sort_order: 0 },
    { id: "g-2", org_id: "o", board_id: "b", name: "진행중", color: null, sort_order: 1 },
    { id: "g-3", org_id: "o", board_id: "b", name: "🔂 심사 중", color: null, sort_order: 2 },
    { id: "g-4", org_id: "o", board_id: "b", name: "승인", color: null, sort_order: 3 },
  ] as BoardGroup[];

  it("보이는 행이 0건인 그룹은 끝의 컨트롤 하나로 접히고, 펼치면 제자리 순서로 다시 나온다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, {
      groups: many,
      rows: [row("r1", "단독회사", "g-3", "심사 중")],
    });
    // 첫 그룹(새 행이 들어오는 자리)은 비어도 접지 않는다.
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
    const toggle = foldToggle(host)!;
    expect(toggle.textContent).toBe("빈 보드 2개 보기");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    expect(titles(host)).toEqual(["준비단계", "진행중", "심사 중", "승인"]);
    expect(foldToggle(host)!.textContent).toBe("빈 보드 접기");
    expect(foldToggle(host)!.getAttribute("aria-expanded")).toBe("true");
    // 펼친 빈 그룹도 이름 편집·행 추가 줄이 그대로 있다.
    const approved = [...host.querySelectorAll<HTMLElement>("[data-visual-block='group-table']")][3];
    expect(approved.querySelector("tbody tr:last-child")).not.toBeNull();
    await act(async () => foldToggle(host)!.click());
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
  });

  /*
   * Chromium·WebKit 은 dragstart 직후(같은 작업, 마이크로태스크 뒤) 처음 누른 자리를 다시
   * hit-test 하고, 끌던 행이 거기 없으면 끌기를 취소한다(곧바로 dragend). 그래서 dragstart 와
   * 그 React 갱신이 끝난 시점까지는 끌던 행 위쪽의 배치가 그대로여야 하고, 빈 그룹은 다음
   * 작업(타이머)에서 펼친다. 타이머는 가짜로 돌려 «dragstart 직후» 와 «다음 작업» 을 가른다.
   * 실제 Chrome 154 확인(2026-10-06, CDP Input.setInterceptDrags): dragstart 에서 위쪽 빈 그룹을
   * 펼치면 끌기가 시작되지 않고 곧바로 dragend, 다음 작업으로 미루면 끌기·펼친 그룹에 놓기 성공.
   */
  it("행을 끄는 동안 빈 그룹은 끌기가 시작된 다음 작업에서 펼쳐지고, 끝나면 다시 접힌다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, {
      groups: many,
      rows: [row("r1", "단독회사", "g-3", "심사 중")],
    });
    const handle = host.querySelector<HTMLElement>("tr[data-board-row] > td:first-child")!;
    await act(async () => handle.dispatchEvent(dragEvent("dragstart")));
    // dragstart 의 갱신이 다 반영된 뒤에도 끌던 행 위쪽 배치는 그대로 — 반투명 표시만 바뀐다.
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
    expect(handle.closest("tr")!.className).toContain("opacity-40");
    await act(async () => vi.runOnlyPendingTimers());
    expect(titles(host)).toEqual(["준비단계", "진행중", "심사 중", "승인"]);
    // 펼쳐도 끌던 행은 다시 그려지지 않는다(같은 노드) — dragend 가 그 행에서 온다.
    expect(host.contains(handle)).toBe(true);
    await act(async () => handle.dispatchEvent(dragEvent("dragend")));
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
  });

  it("브라우저가 끌기를 곧바로 취소하면(dragstart 직후 dragend) 빈 그룹을 펼치지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, {
      groups: many,
      rows: [row("r1", "단독회사", "g-3", "심사 중")],
    });
    const handle = host.querySelector<HTMLElement>("tr[data-board-row] > td:first-child")!;
    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart"));
      handle.dispatchEvent(dragEvent("dragend"));
    });
    await act(async () => vi.runOnlyPendingTimers());
    expect(titles(host)).toEqual(["준비단계", "심사 중"]);
    expect(handle.closest("tr")!.className).not.toContain("opacity-40");
  });

  it("이 세션에 새로 만든 그룹은 비어 있어도 접지 않는다 — 만들자마자 사라지지 않는다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, {
      groups: many,
      rows: [row("r1", "단독회사", "g-3", "심사 중")],
    });
    await host.rerenderGroups([
      ...many,
      { id: "g-new", org_id: "o", board_id: "b", name: "새 그룹", color: null, sort_order: 4 } as BoardGroup,
    ]);
    expect(titles(host)).toEqual(["준비단계", "심사 중", "새 그룹"]);
    expect(foldToggle(host)!.textContent).toBe("빈 보드 2개 보기");
  });

  it("접을 빈 그룹이 없으면 컨트롤도 없다", async () => {
    const host = await mount(CONTRACT_WORK_TAB_SOURCE, {
      groups: many.slice(0, 2),
      rows: [row("r1", "a", "g-1", "대기중"), row("r2", "b", "g-2", "대기중")],
    });
    expect(foldToggle(host)).toBeNull();
  });
});
